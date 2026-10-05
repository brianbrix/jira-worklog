export type WorklogEntry = {
  id: string; date: string; started: string; seconds: number; comment: string
  issueKey: string; summary: string; issueUrl: string
  project: { key: string; name: string; url: string }
}

export type WorkItem = Pick<WorklogEntry, 'issueKey' | 'summary' | 'issueUrl' | 'project'> & {
  from: string; to: string; seconds: number; entries: WorklogEntry[]
}

export function groupWorkItems(entries: WorklogEntry[]): WorkItem[] {
  const groups = new Map<string, WorkItem>()
  for (const entry of entries) {
    let item = groups.get(entry.issueKey)
    if (!item) {
      item = { issueKey: entry.issueKey, summary: entry.summary, issueUrl: entry.issueUrl, project: entry.project,
        from: entry.date, to: entry.date, seconds: 0, entries: [] }
      groups.set(entry.issueKey, item)
    }
    item.seconds += entry.seconds
    item.entries.push(entry)
    if (entry.date < item.from) item.from = entry.date
    if (entry.date > item.to) item.to = entry.date
  }
  for (const item of groups.values()) item.entries.sort((first, second) => second.started.localeCompare(first.started) || first.id.localeCompare(second.id))
  return [...groups.values()].sort((first, second) => second.seconds - first.seconds || first.issueKey.localeCompare(second.issueKey))
}

export function worklogCsv(entries: WorklogEntry[], groupByWorkItem = false) {
  const cell = (value: string | number) => {
    let text = String(value)
    if (/^\s*[=+\-@\t\r]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  const rows = groupByWorkItem ? [
    ['From date', 'To date', 'Project', 'Project key', 'Issue', 'Summary', 'Worklogs', 'Comments', 'Seconds', 'Hours', 'Issue URL'],
    ...groupWorkItems(entries).map(item => [item.from, item.to, item.project.name, item.project.key, item.issueKey,
      item.summary, item.entries.length, item.entries.filter(entry => entry.comment).map(entry => `${entry.date}: ${entry.comment}`).join('\n'),
      item.seconds, (item.seconds / 3600).toFixed(4), item.issueUrl]),
  ] : [
    ['Date', 'Project', 'Project key', 'Issue', 'Summary', 'Comment', 'Seconds', 'Hours', 'Issue URL'],
    ...entries.map(entry => [entry.date, entry.project.name, entry.project.key, entry.issueKey,
      entry.summary, entry.comment, entry.seconds, (entry.seconds / 3600).toFixed(4), entry.issueUrl]),
  ]
  return rows.map(row => row.map(cell).join(',')).join('\r\n')
}