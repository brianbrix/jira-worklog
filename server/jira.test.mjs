import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { createApp } from './app.mjs'
import { createJiraClient, validateRange, dateInZone, commentText, summarize } from './jira.mjs'

test('validates calendar dates and inclusive ranges', () => {
  assert.doesNotThrow(() => validateRange('2026-10-05', '2026-10-05'))
  for (const dates of [['2026-02-30', '2026-03-01'], ['2026-10-06', '2026-10-05'], ['', '2026-10-05'], ['bad', 'bad']]) {
    assert.throws(() => validateRange(...dates), { status: 400 })
  }
})

test('uses the authenticated Jira timezone at midnight boundaries', () => {
  assert.equal(dateInZone('2026-10-06T01:00:00.000+0000', 'America/New_York'), '2026-10-05')
  assert.equal(dateInZone('2026-10-05T22:00:00.000+0000', 'Europe/Paris'), '2026-10-06')
})

test('reads Atlassian document comments without losing paragraph boundaries', () => {
  assert.equal(commentText({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Build ' }, { type: 'text', text: 'API' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Review' }] },
  ] }).trim(), 'Build API\nReview')
  assert.equal(commentText('Plain text'), 'Plain text')
})

test('paginates search and worklogs, excludes other authors and dates, and totals projects', async () => {
  const calls = []
  const issue = (id, key) => ({ id, key: `${key}-1`, fields: {
    summary: `Issue ${id}`, project: { key, name: `Project ${key}` },
  } })
  const worklog = (id, seconds, started, author = 'me') => ({
    id, timeSpentSeconds: seconds, started, author: { accountId: author }, comment: 'Work',
  })
  const client = createJiraClient({ email: 'test@example.com', token: 'test-token', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    const path = new URL(url).pathname
    let data
    if (path.endsWith('/myself')) data = { accountId: 'me', displayName: 'Test User', timeZone: 'America/New_York' }
    else if (path.endsWith('/search/jql')) {
      const body = JSON.parse(options.body)
      assert.match(body.jql, /worklogAuthor = currentUser\(\)/)
      assert.match(body.jql, /2026-10-04/)
      data = body.nextPageToken
        ? { issues: [issue('2', 'BETA')], isLast: true }
        : { issues: [issue('1', 'ALPHA')], isLast: false, nextPageToken: 'page-2' }
    } else if (path.includes('/issue/1/')) {
      data = new URL(url).searchParams.get('startAt') === '0'
        ? { total: 4, worklogs: [
          worklog('1', 3600, '2026-10-05T09:00:00.000-0400'),
          worklog('2', 7200, '2026-10-05T09:00:00.000-0400', 'someone-else'),
        ] }
        : { total: 4, worklogs: [
          worklog('3', 1800, '2026-10-06T01:00:00.000+0000'),
          worklog('4', 9000, '2026-10-06T09:00:00.000-0400'),
        ] }
    } else data = { total: 1, worklogs: [worklog('5', 900, '2026-10-05T23:59:59.000-0400')] }
    return Response.json(data)
  } })
  const result = await client.report('2026-10-05', '2026-10-05')
  assert.equal(result.totalSeconds, 6300)
  assert.equal(result.entryCount, 3)
  assert.equal(result.issueCount, 2)
  assert.deepEqual(result.projects.map(({ key, seconds }) => [key, seconds]), [['ALPHA', 5400], ['BETA', 900]])
  assert.deepEqual(result.days, [{ date: '2026-10-05', seconds: 6300 }])
  assert.equal(calls.length, 6)
  assert.ok(result.entries.every((entry) => entry.issueUrl.startsWith('https://devgateway.atlassian.net/browse/')))
  assert.ok(!JSON.stringify(result).includes('test-token'))
})

test('empty reports have zero totals', () => {
  assert.deepEqual(summarize([]), { totalSeconds: 0, entryCount: 0, issueCount: 0, projects: [], days: [] })
})

test('missing credentials do not make a Jira request', async () => {
  const client = createJiraClient({ fetchImpl: () => assert.fail('Unexpected request') })
  await assert.rejects(client.myself(), { status: 503 })
})

test('authentication and rate-limit errors do not expose Jira response bodies', async () => {
  for (const upstreamStatus of [401, 429]) {
    const client = createJiraClient({ email: 'test@example.com', token: 'secret',
      fetchImpl: async () => new Response('sensitive body', { status: upstreamStatus }) })
    await assert.rejects(client.myself(), (error) => {
      assert.equal(error.status, upstreamStatus === 429 ? 429 : 502)
      assert.ok(!error.message.includes('sensitive'))
      return true
    })
  }
})

test('local API reports configuration, validates dates, and rejects foreign hosts and origins', async (context) => {
  const app = createApp({ configured: false, client: createJiraClient({}) })
  const server = createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  const statusResponse = await fetch(`${url}/api/status`)
  assert.deepEqual(await statusResponse.json(), { configured: false })
  assert.equal(statusResponse.headers.get('cache-control'), 'no-store')
  const invalid = await fetch(`${url}/api/worklogs?from=bad&to=bad`)
  assert.equal(invalid.status, 400)
  const unconfigured = await fetch(`${url}/api/worklogs?from=2026-10-05&to=2026-10-05`)
  assert.equal(unconfigured.status, 503)
  assert.match((await unconfigured.json()).error, /not configured/)
  const origin = await fetch(`${url}/api/status`, { headers: { Origin: 'https://other.example' } })
  assert.equal(origin.status, 403)
  const hostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/api/status`, { headers: { Host: 'other.example' } }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(hostStatus, 403)
})