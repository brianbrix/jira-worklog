import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { UserOptions } from 'jspdf-autotable'

type InvoiceEntry = {
  seconds: number; issueKey: string; summary: string
  project: { key: string; name: string }
}
type InvoiceRange = { from: string; to: string }
export type Expense = { id: string; name: string; summary: string; amount: number }
export type InvoiceDetails = {
  senderName: string; contact: string; billTo: string; paymentDetails: string
  dailyRate: number; hoursPerDay: number; expenses: Expense[]
  projectLabels: Record<string, string>
}
export type InvoiceFonts = { regular: string; bold: string }

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function calculateInvoice(entries: InvoiceEntry[], dailyRate: number, hoursPerDay: number, expenses: Expense[]) {
  if (!Number.isFinite(dailyRate) || dailyRate < 0 || !Number.isFinite(hoursPerDay) || hoursPerDay <= 0) {
    throw new Error('Enter a non-negative daily rate and a positive number of hours per day.')
  }
  if (entries.some(entry => !Number.isFinite(entry.seconds) || entry.seconds < 0)
    || expenses.some(expense => !Number.isFinite(expense.amount) || expense.amount < 0)) {
    throw new Error('Worklog durations and expense amounts must be non-negative numbers.')
  }
  const seconds = entries.reduce((total, entry) => total + entry.seconds, 0)
  const hours = seconds / 3600
  const days = hours / hoursPerDay
  const workCents = Math.round(days * dailyRate * 100)
  const expenseCents = expenses.reduce((total, expense) => total + Math.round(expense.amount * 100), 0)
  const totalCents = workCents + expenseCents
  if (!Number.isSafeInteger(totalCents)) throw new Error('The invoice amount is too large.')
  return { seconds, hours, days, workCents, expenseCents, totalCents }
}

export function invoiceFilename(senderName: string, range: InvoiceRange) {
  const name = senderName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'worklog'
  const period = range.from.slice(0, 7) === range.to.slice(0, 7)
    ? `${months[Number(range.from.slice(5, 7)) - 1].toLowerCase()}_${range.from.slice(0, 4)}`
    : `${range.from}_to_${range.to}`
  return `${name}_${period}_invoice.pdf`
}

export function invoiceProjects(entries: InvoiceEntry[]) {
  const projects = new Map<string, { key: string; name: string; seconds: number; tasks: Set<string> }>()
  for (const entry of entries) {
    let project = projects.get(entry.project.key)
    if (!project) {
      project = { ...entry.project, seconds: 0, tasks: new Set<string>() }
      projects.set(entry.project.key, project)
    }
    project.seconds += entry.seconds
    project.tasks.add(`${entry.issueKey}: ${entry.summary}`)
  }
  return [...projects.values()]
}

export function createInvoicePdf(entries: InvoiceEntry[], range: InvoiceRange, details: InvoiceDetails, sample = false, fonts?: InvoiceFonts) {
  if (!entries.length) throw new Error('No worklogs are selected for this invoice.')
  if (!details.senderName.trim() || !details.billTo.trim()) throw new Error('Enter the sender name and billing recipient.')
  const totals = calculateInvoice(entries, details.dailyRate, details.hoursPerDay, details.expenses)
  const document = new jsPDF({ format: 'letter', unit: 'pt', precision: 5 })
  const font = fonts ? 'InvoiceTimesNewRoman' : 'times'
  if (fonts) {
    document.addFileToVFS('InvoiceTimesNewRoman.ttf', fonts.regular)
    document.addFont('InvoiceTimesNewRoman.ttf', font, 'normal')
    document.addFileToVFS('InvoiceTimesNewRomanBold.ttf', fonts.bold)
    document.addFont('InvoiceTimesNewRomanBold.ttf', font, 'bold')
  }
  const fontSize = 7.8
  const lineHeight = 14.94873
  const rowHeight = lineHeight + 0.75
  const baseline = 15.12903
  const left = 49.5
  const width = 520.5
  const bottom = 720
  document.setFont(font, 'normal').setFontSize(fontSize).setLineHeightFactor(lineHeight / fontSize)
  document.setProperties({ title: `Worklog invoice ${range.from} to ${range.to}`, author: details.senderName })
  let nextY = 311.17969
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
  const text = (content: string, x: number, y: number, bold = false, align: 'left' | 'center' | 'right' = 'left') => {
    document.setFont(font, bold ? 'bold' : 'normal').setFontSize(fontSize).setTextColor(0)
    document.text(content, x, y, { align })
  }
  const newPage = () => { document.addPage(); nextY = 72 }
  const ensureSpace = (height: number) => { if (nextY + height > bottom) newPage() }
  const table = (options: UserOptions) => {
    const cellText = new WeakMap<object, string[]>()
    autoTable(document, {
      startY: nextY, margin: { top: 72, bottom: 72, left, right: 42 }, tableWidth: width, theme: 'grid',
      styles: { font, fontSize, minCellHeight: rowHeight, cellPadding: { top: 0.375, bottom: 0.375, left: 5.25, right: 5.25 }, textColor: 0, lineColor: 0, lineWidth: 0.5 },
      headStyles: { fillColor: 255, textColor: 0, fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: 255, textColor: 0, fontStyle: 'bold' }, showFoot: 'lastPage',
      ...options,
      willDrawCell: data => { cellText.set(data.cell, data.cell.text); data.cell.text = [] },
      didDrawCell: data => {
        const lines = cellText.get(data.cell) ?? []
        data.cell.text = lines
        const alignment = data.cell.styles.halign
        const x = alignment === 'right' ? data.cell.x + data.cell.width - 5.25
          : alignment === 'center' ? data.cell.x + data.cell.width / 2 : data.cell.x + 5.25
        document.saveGraphicsState()
        document.rect(data.cell.x + 0.75, data.cell.y + 0.75, data.cell.width - 1.5, data.cell.height - 0.75, null).clip().discardPath()
        lines.forEach((line, index) => text(line, line === 'TOTAL COST' ? 457.26719 : x, data.cell.y + baseline + index * lineHeight, data.cell.styles.fontStyle === 'bold', line === 'TOTAL COST' ? 'left' : alignment === 'right' || alignment === 'center' ? alignment : 'left'))
        if (data.section === 'foot' && lines[0]?.startsWith('TOTAL HOURS')) {
          document.setLineWidth(0.45)
          document.line(x, data.cell.y + baseline + 0.5, x + document.getTextWidth(lines[0]), data.cell.y + baseline + 0.5)
        }
        document.restoreGraphicsState()
      },
    })
    nextY = (document as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 0.75
  }
  const heading = range.from.slice(0, 7) === range.to.slice(0, 7)
    ? `INVOICE FOR THE MONTH OF ${months[Number(range.from.slice(5, 7)) - 1].toUpperCase()} ${range.from.slice(0, 4)}`
    : 'INVOICE FOR THE PAY PERIOD'

  if (sample) text('SAMPLE INVOICE - NOT FOR PAYMENT', left, 50, true)
  text(details.senderName.trim().replace(/,$/, ''), left, 86.37903, true)
  const senderWidth = document.getTextWidth(details.senderName.trim().replace(/,$/, ''))
  text(',', left + senderWidth, 86.37903)
  document.setFont(font, 'normal')
  const contact = document.splitTextToSize(details.contact.trim(), width) as string[]
  contact.forEach((line, index) => text(line, left, 101.32776 + index * lineHeight))
  const headingY = Math.max(161.12256, 101.32776 + contact.length * lineHeight + lineHeight)
  text(heading, left, headingY, true)
  text(`${range.from} \u2013 ${range.to}`, left, headingY + lineHeight, true)
  const billingY = headingY + lineHeight * 3
  text('Bill to:', 48.75, billingY, true)
  text('Payment Details:', 257.25, billingY, true)
  const drawDetails = (content: string, x: number, columnWidth: number) => {
    document.setFont(font, 'normal')
    const lines = document.splitTextToSize(content.trim(), columnWidth) as string[]
    lines.forEach((line, index) => {
      const y = billingY + (index + 1) * lineHeight
      if (/^(https?:\/\/|www\.)/.test(line)) {
        document.setFont(font, 'normal').setTextColor(0, 0, 255)
        document.textWithLink(line, x, y, { url: line.startsWith('www.') ? `https://${line}` : line })
        document.setDrawColor(0, 0, 255).setLineWidth(0.4).line(x, y + 0.8, x + document.getTextWidth(line), y + 0.8)
        document.setDrawColor(0)
      } else if (/^Swift Code:/i.test(line)) {
        const label = line.slice(0, line.indexOf(':') + 1) + ' '
        text(label, x, y)
        const offset = document.getTextWidth(label)
        text(line.slice(line.indexOf(':') + 1).trim(), x + offset, y, true)
      } else {
        const ordinal = line.match(/^(.*?\b\d+)(st|nd|rd|th)(\b.*)$/)
        if (ordinal) {
          text(ordinal[1], x, y)
          const offset = document.getTextWidth(ordinal[1])
          text(ordinal[2], x + offset, y - 7)
          const suffixWidth = document.getTextWidth(ordinal[2])
          text(ordinal[3], x + offset + suffixWidth, y)
        } else text(line, x, y)
      }
    })
    return lines.length
  }
  const billingLines = drawDetails(details.billTo, 48.75, 202.5)
  const paymentLines = drawDetails(details.paymentDetails, 257.25, 312)
  nextY = Math.max(311.17969, billingY + Math.max(billingLines, paymentLines) * lineHeight + 15.51843)

  table({ head: [
    [{ content: 'BILLABLE WORK', colSpan: 3, styles: { fillColor: 242, fontStyle: 'normal', halign: 'left' } }],
    ['Project Code', 'Summary of Primary Tasks', 'Hours'],
  ],
    body: invoiceProjects(entries).map(project => [
      details.projectLabels[project.key]?.trim() || `${project.name} (${project.key})`,
      [...project.tasks].join('\n'), (project.seconds / 3600).toFixed(2),
    ]),
    foot: [['', 'TOTAL HOURS Worked in Pay Period', totals.hours.toFixed(2)]],
    columnStyles: { 0: { cellWidth: 117 }, 1: { cellWidth: 346 }, 2: { cellWidth: 57.5, halign: 'right' } },
    didParseCell: data => {
      if (data.section === 'body') data.cell.styles.minCellHeight = data.row.index === 0 ? 45.59619 : 59.25
      if (data.column.index === 2 && data.section !== 'head') data.cell.styles.halign = 'right'
    },
  })
  ensureSpace(90.44238)
  const dailyY = nextY + 29.32776
  text('DAILY RATE: ', left, dailyY)
  const rateLabelWidth = document.getTextWidth('DAILY RATE: ')
  text(`${details.dailyRate} USD/day`, left + rateLabelWidth, dailyY, true)
  const formulaY = dailyY + lineHeight * 2
  const multiplier = Number((1 / details.hoursPerDay).toFixed(6)).toString()
  const formulaWidths = [66.75, 13.5, 90, 18, 63, 14.25, 255]
  const formulaHead = ['Total Hours', 'x', `${multiplier} Days/Hour`, 'x', 'Daily Rate', '=', 'TOTAL USD for Hours Worked in Pay Period']
  const formulaValues = [totals.hours.toFixed(2), 'x', multiplier, 'x', String(details.dailyRate), '=', money(totals.workCents)]
  let formulaX = left
  formulaWidths.forEach((columnWidth, index) => {
    const align = index === 0 ? 'left' : index === 6 ? 'right' : 'center'
    const headerX = index === 0 ? formulaX + 5.25 : index === 6 ? formulaX + columnWidth - 5.25 : formulaX + columnWidth / 2
    text(formulaHead[index], headerX, formulaY, index === 6, align)
    text(formulaValues[index], index === 6 ? headerX : formulaX + columnWidth / 2, formulaY + rowHeight, index === 6, index === 6 ? 'right' : 'center')
    formulaX += columnWidth
  })
  document.setDrawColor(0).setLineWidth(0.75).line(left + 0.5, formulaY + 0.75, left + width - 0.5, formulaY + 0.75)
  nextY = formulaY + rowHeight + lineHeight + 0.57

  const expenseColumns = { 0: { cellWidth: 207.75 }, 1: { cellWidth: 255.75 }, 2: { cellWidth: 57.75, halign: 'right' as const } }
  table({ tableWidth: 521.25, head: [
    [{ content: 'REIMBURSABLE EXPENSES', colSpan: 3, styles: { fillColor: 242, fontStyle: 'normal', halign: 'left' } }],
    ['Name of Approved Expensify Report', 'Summary of Expenses', 'Cost'],
  ], body: [], columnStyles: expenseColumns })
  table({ tableWidth: 521.25, showHead: 'never', body: details.expenses.map(expense => [expense.name, expense.summary, money(Math.round(expense.amount * 100))]),
    columns: [{ dataKey: 0 }, { dataKey: 1 }, { dataKey: 2 }],
    foot: [['', { content: 'TOTAL COST', styles: { halign: 'right' } }, details.expenses.length ? money(totals.expenseCents) : '']],
    columnStyles: expenseColumns,
    didParseCell: data => {
      data.cell.styles.cellWidth = [207.75, 255.75, 57.75][data.column.index]
      if (data.column.index === 2) data.cell.styles.halign = 'right'
    },
  })
  nextY += rowHeight - 0.75
  table({ body: [['TOTAL INVOICED', money(totals.totalCents)]],
    bodyStyles: { fillColor: 217, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 462.75 }, 1: { cellWidth: 57.75 } } })
  return document
}