import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { calculateInvoice, createInvoicePdf, invoiceFilename, invoiceProjects } from '../src/invoice.ts'
import { createApp } from './app.mjs'

const range = { from: '2026-03-01', to: '2026-03-31' }
const entry = { seconds: 3600, issueKey: 'TEST-1', summary: 'Primary task', project: { key: 'TEST', name: 'Test project' } }
const details = {
  senderName: 'Example Sender', contact: 'Test contact', billTo: 'Example Client', paymentDetails: 'Test payment details',
  dailyRate: 252, hoursPerDay: 8, expenses: [], projectLabels: {},
}

test('invoice totals use exact worklog time and the same hours throughout', () => {
  const totals = calculateInvoice([{ ...entry, seconds: 197.5 * 3600 }], 252, 8, [{ id: '1', name: 'Approved report', summary: 'Travel', amount: 12.34 }])
  assert.deepEqual(totals, { seconds: 711000, hours: 197.5, days: 24.6875, workCents: 622125, expenseCents: 1234, totalCents: 623359 })
  const fraction = calculateInvoice([{ ...entry, seconds: 1 }], 252, 8, [])
  assert.equal(fraction.workCents, 1)
})

test('expense totals and the final amount are accumulated in cents', () => {
  const expenses = [0.1, 0.2].map((amount, index) => ({ id: String(index), name: 'Report', summary: '', amount }))
  const totals = calculateInvoice([entry], 10.01, 8, expenses)
  assert.equal(totals.workCents, 125)
  assert.equal(totals.expenseCents, 30)
  assert.equal(totals.totalCents, 155)
  assert.equal(calculateInvoice([], 0, 8, []).totalCents, 0)
})

test('invalid rates, durations, expense values, and excessive totals are rejected', () => {
  for (const dailyRate of [-1, NaN, Infinity]) assert.throws(() => calculateInvoice([entry], dailyRate, 8, []))
  for (const hoursPerDay of [0, -1, NaN, Infinity]) assert.throws(() => calculateInvoice([entry], 252, hoursPerDay, []))
  assert.throws(() => calculateInvoice([{ ...entry, seconds: -1 }], 252, 8, []))
  assert.throws(() => calculateInvoice([entry], 252, 8, [{ id: '1', name: 'Report', summary: '', amount: -1 }]))
  assert.throws(() => calculateInvoice([entry], Number.MAX_VALUE, 8, []), /too large/)
})

test('invoice filenames follow the monthly template and identify multi-month ranges', () => {
  assert.equal(invoiceFilename('Example Sender', range), 'example_sender_mar_2026_invoice.pdf')
  assert.equal(invoiceFilename('Example Sender', { from: '2026-03-20', to: '2026-04-05' }), 'example_sender_2026-03-20_to_2026-04-05_invoice.pdf')
  assert.equal(invoiceFilename('../../../Example Sender', range), 'example_sender_mar_2026_invoice.pdf')
})

test('projects aggregate only the supplied entries and deduplicate primary tasks', () => {
  const projects = invoiceProjects([entry, { ...entry, seconds: 1800 }, { ...entry, issueKey: 'TEST-2', summary: 'Follow-up task' }])
  assert.equal(projects.length, 1)
  assert.equal(projects[0].seconds, 9000)
  assert.deepEqual([...projects[0].tasks], ['TEST-1: Primary task', 'TEST-2: Follow-up task'])
  assert.equal(invoiceProjects([entry])[0].seconds, 3600)
})

test('PDF includes the template sections, custom billing codes, expenses, and sample marking', () => {
  const document = createInvoicePdf([entry], range, {
    ...details, projectLabels: { TEST: 'Client billing code-1234' },
    expenses: [{ id: '1', name: 'Approved report', summary: 'Travel', amount: 12.34 }],
  }, true)
  const output = document.output()
  for (const label of ['INVOICE FOR THE MONTH OF MAR 2026', 'Bill to:', 'Payment Details:', 'BILLABLE WORK',
    'Client billing code-1234', 'REIMBURSABLE EXPENSES', 'Approved report', 'TOTAL INVOICED', 'SAMPLE INVOICE - NOT FOR PAYMENT']) {
    assert.ok(output.includes(label), `PDF contains ${label}`)
  }
  assert.match(output, /^%PDF/)
  assert.match(output, /\$43\.84/)
  assert.throws(() => createInvoicePdf([], range, details), /No worklogs/)
  assert.throws(() => createInvoicePdf([entry], range, { ...details, senderName: ' ' }), /sender name/)
})

test('long task lists paginate without losing the final invoice total', () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({ ...entry, issueKey: `TEST-${index}`, summary: 'A long task summary describing implementation and verification '.repeat(4) }))
  const document = createInvoicePdf(entries, range, details)
  assert.ok(document.getNumberOfPages() > 1)
  const output = document.output()
  assert.ok(output.includes('TEST-99'))
  assert.equal(output.match(/TOTAL INVOICED/g).length, 1)
  assert.ok(output.includes('$3150.00'))
})

test('the reference layout uses Letter pages and preserves its two-page total position', () => {
  const counts = [3, 2, 1, 3]
  const hours = [14.5, 136, 2, 45]
  const entries = counts.flatMap((count, projectIndex) => Array.from({ length: count }, (_, index) => ({
    ...entry, seconds: hours[projectIndex] * 3600 / count, issueKey: `TEST-${projectIndex}-${index}`,
    project: { key: `P${projectIndex}`, name: `Project ${projectIndex + 1}` },
  })))
  const document = createInvoicePdf(entries, range, details)
  assert.equal(document.internal.pageSize.getWidth(), 612)
  assert.equal(document.internal.pageSize.getHeight(), 792)
  assert.equal(document.getNumberOfPages(), 2)
  assert.equal(document.lastAutoTable.startPageNumber, 2)
  assert.ok(Math.abs(document.lastAutoTable.body[0].cells[0].y - 103.39746) < 0.001)
  assert.deepEqual(document.lastAutoTable.columns.map(column => column.width), [462.75, 57.75])
  assert.ok(document.output().includes('7.8 Tf'))
  assert.ok(document.output().includes('54.75 465.69128 Td'))
  assert.ok(document.internal.pages[2].join('\n').includes('49.5 720. 207.75 -15.69873 re'))
})

test('invoice fonts are served only locally and failures never expose filesystem details', async () => {
  for (const available of [true, false]) {
    const fonts = { regular: 'regular-font-data', bold: 'bold-font-data' }
    const server = createServer(createApp({ client: {}, configured: false, invoiceFonts: async () => {
      if (!available) throw new Error('Sensitive filesystem error')
      return fonts
    } }))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/invoice-fonts`
      const response = await fetch(url)
      assert.equal(response.status, available ? 200 : 503)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      if (available) assert.deepEqual(await response.json(), fonts)
      else assert.equal((await response.text()).includes('Sensitive filesystem error'), false)
      assert.equal((await fetch(url, { headers: { Origin: 'https://foreign.example' } })).status, 403)
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
})