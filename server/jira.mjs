export const JIRA_BASE_URL = 'https://devgateway.atlassian.net'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function validateRange(from, to) {
  const valid = (value) => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!valid(from) || !valid(to)) {
    throw new ApiError(400, 'Enter valid start and end dates.')
  }
  if (from > to) throw new ApiError(400, 'Start date must be on or before end date.')
}

export function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function dateInZone(started, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(started))
  const part = (type) => parts.find((entry) => entry.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function commentText(node) {
  if (typeof node === 'string') return node
  if (!node) return ''
  if (node.type === 'hardBreak') return '\n'
  const text = node.text ?? (node.content ?? []).map(commentText).join('')
  return ['paragraph', 'heading', 'listItem'].includes(node.type) ? `${text}\n` : text
}

export function summarize(entries) {
  const projects = new Map()
  const days = new Map()
  let totalSeconds = 0
  for (const entry of entries) {
    totalSeconds += entry.seconds
    const project = projects.get(entry.project.key) ?? {
      ...entry.project, seconds: 0, entryCount: 0, issues: new Set(),
    }
    project.seconds += entry.seconds
    project.entryCount += 1
    project.issues.add(entry.issueKey)
    projects.set(project.key, project)
    days.set(entry.date, (days.get(entry.date) ?? 0) + entry.seconds)
  }
  return {
    totalSeconds,
    entryCount: entries.length,
    issueCount: new Set(entries.map((entry) => entry.issueKey)).size,
    projects: [...projects.values()].map(({ issues, ...project }) => ({
      ...project, issueCount: issues.size,
    })).sort((first, second) => second.seconds - first.seconds),
    days: [...days].map(([date, seconds]) => ({ date, seconds }))
      .sort((first, second) => first.date.localeCompare(second.date)),
  }
}

export function createJiraClient({ email, token, fetchImpl = fetch }) {
  async function request(path, body) {
    if (!email || !token) {
      throw new ApiError(503, 'Jira is not configured. Add JIRA_EMAIL and JIRA_API_TOKEN to .env, then restart the app.')
    }
    let response
    try {
      response = await fetchImpl(`${JIRA_BASE_URL}/rest/api/3${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      })
    } catch {
      throw new ApiError(502, 'Could not reach Jira. Check your connection and try again.')
    }
    if (!response.ok) {
      const messages = {
        400: 'Jira rejected the query. Check that time tracking is enabled.',
        401: 'Jira authentication failed. Check your email and API token in .env.',
        403: 'Jira denied access. Check your project and worklog permissions.',
        404: 'A Jira issue is no longer accessible. Refresh and try again.',
        429: 'Jira rate limit reached. Try again in a moment.',
      }
      throw new ApiError(response.status === 429 ? 429 : 502,
        messages[response.status] ?? `Jira returned an error (${response.status}). Try again.`)
    }
    return response.json()
  }

  async function myself() {
    const user = await request('/myself')
    return {
      accountId: user.accountId,
      displayName: user.displayName,
      timeZone: user.timeZone || 'UTC',
    }
  }

  async function report(from, to) {
    validateRange(from, to)
    const user = await myself()
    const issues = new Map()
    const seenTokens = new Set()
    let nextPageToken
    do {
      const page = await request('/search/jql', {
        jql: `worklogAuthor = currentUser() AND worklogDate >= "${shiftDate(from, -1)}" AND worklogDate <= "${shiftDate(to, 1)}" ORDER BY key ASC`,
        fields: ['summary', 'project'],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      })
      for (const issue of page.issues) issues.set(issue.id, issue)
      nextPageToken = page.isLast ? undefined : page.nextPageToken
      if (!page.isLast && !nextPageToken) throw new ApiError(502, 'Jira returned incomplete search results. Try again.')
      if (nextPageToken && seenTokens.has(nextPageToken)) throw new ApiError(502, 'Jira search pagination did not advance. Try again.')
      if (nextPageToken) seenTokens.add(nextPageToken)
    } while (nextPageToken)

    const entries = []
    for (const issue of issues.values()) {
      let startAt = 0
      let total = 0
      do {
        const query = new URLSearchParams({
          startAt: String(startAt), maxResults: '100',
          startedAfter: String(Date.parse(`${shiftDate(from, -2)}T00:00:00Z`)),
          startedBefore: String(Date.parse(`${shiftDate(to, 2)}T00:00:00Z`)),
        })
        const page = await request(`/issue/${encodeURIComponent(issue.id)}/worklog?${query}`)
        total = page.total
        if (!page.worklogs.length && startAt < total) throw new ApiError(502, 'Jira returned incomplete worklogs. Try again.')
        for (const worklog of page.worklogs) {
          if (worklog.author?.accountId !== user.accountId) continue
          const date = dateInZone(worklog.started, user.timeZone)
          if (date < from || date > to) continue
          const project = issue.fields.project
          entries.push({
            id: `${issue.id}-${worklog.id}`,
            date,
            started: worklog.started,
            seconds: worklog.timeSpentSeconds,
            comment: commentText(worklog.comment).trim(),
            issueKey: issue.key,
            summary: issue.fields.summary,
            issueUrl: `${JIRA_BASE_URL}/browse/${encodeURIComponent(issue.key)}`,
            project: {
              key: project.key,
              name: project.name,
              url: `${JIRA_BASE_URL}/browse/${encodeURIComponent(project.key)}`,
            },
          })
        }
        startAt += page.worklogs.length
      } while (startAt < total)
    }
    entries.sort((first, second) => second.date.localeCompare(first.date)
      || Date.parse(second.started) - Date.parse(first.started))
    return { from, to, user, entries, ...summarize(entries), fetchedAt: new Date().toISOString() }
  }

  return { myself, report }
}