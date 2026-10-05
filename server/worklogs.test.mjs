import test from 'node:test'
import assert from 'node:assert/strict'
import { groupWorkItems, worklogCsv } from '../src/worklogs.ts'

const first = {
  id: '1', date: '2026-03-02', started: '2026-03-02T09:00:00Z', seconds: 3601, comment: 'Implementation',
  issueKey: 'TEST-1', summary: 'Primary task', issueUrl: 'https://jira.example/browse/TEST-1',
  project: { key: 'TEST', name: 'Test project', url: 'https://jira.example/browse/TEST' },
}
const second = { ...first, id: '2', date: '2026-03-01', started: '2026-03-01T09:00:00Z', seconds: 1802, comment: 'Review' }
const other = { ...first, id: '3', seconds: 7200, issueKey: 'OTHER-2', summary: 'Other task',
  issueUrl: 'https://jira.example/browse/OTHER-2', project: { key: 'OTHER', name: 'Other project', url: 'https://jira.example/browse/OTHER' } }

test('work-item groups combine repeated issue keys and preserve exact time, dates, and notes', () => {
  const items = groupWorkItems([first, second, other])
  assert.equal(items.length, 2)
  assert.equal(items[0].issueKey, 'OTHER-2')
  assert.equal(items[1].seconds, 5403)
  assert.equal(items[1].from, '2026-03-01')
  assert.equal(items[1].to, '2026-03-02')
  assert.deepEqual(items[1].entries, [first, second])
  assert.equal(items.reduce((total, item) => total + item.seconds, 0), 12603)
  assert.equal(items[1].issueUrl, first.issueUrl)
})

test('grouping only aggregates supplied filtered worklogs without mutating them', () => {
  const entries = Object.freeze([Object.freeze(second), Object.freeze(first)])
  assert.deepEqual(groupWorkItems(entries)[0].entries, [first, second])
  assert.deepEqual(entries, [second, first])
  assert.equal(groupWorkItems([second])[0].seconds, second.seconds)
  assert.equal(groupWorkItems([second])[0].entries.length, 1)
  assert.deepEqual(groupWorkItems([]), [])
})

test('equal-time groups have a stable issue-key order', () => {
  const items = groupWorkItems([{ ...first, issueKey: 'TEST-2' }, first])
  assert.deepEqual(items.map(item => item.issueKey), ['TEST-1', 'TEST-2'])
})

test('grouped CSV includes one row per work item, date span, count, exact totals, and all notes', () => {
  const csv = worklogCsv([first, second, other], true)
  assert.equal(csv.split('\r\n').length, 3)
  assert.ok(csv.startsWith('"From date","To date"'))
  assert.ok(csv.includes('"2026-03-01","2026-03-02"'))
  assert.ok(csv.includes('"2","2026-03-02: Implementation\n2026-03-01: Review","5403","1.5008"'))
  assert.equal(csv.match(/"TEST-1"/g).length, 1)
})

test('ungrouped CSV retains the original columns and individual entries', () => {
  const csv = worklogCsv([first, second])
  assert.equal(csv.split('\r\n').length, 3)
  assert.ok(csv.startsWith('"Date","Project","Project key","Issue","Summary","Comment","Seconds","Hours","Issue URL"'))
  assert.equal(csv.match(/"TEST-1"/g).length, 2)
  assert.ok(csv.includes('"3601","1.0003"'))
})

test('both CSV modes escape quotes and neutralize spreadsheet formulas', () => {
  const entry = { ...first, summary: '=SUM(1,2)', comment: 'A "quoted" note', project: { ...first.project, name: '@dangerous' } }
  for (const grouped of [false, true]) {
    const csv = worklogCsv([entry], grouped)
    assert.ok(csv.includes('"\'=SUM(1,2)"'))
    assert.ok(csv.includes('"\'@dangerous"'))
    assert.ok(csv.includes('A ""quoted"" note'))
  }
})