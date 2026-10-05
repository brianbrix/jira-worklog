import { useState } from 'react'
import type { FormEvent } from 'react'
import { Download, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { calculateInvoice, createInvoicePdf, invoiceFilename, invoiceProjects } from './invoice'
import type { InvoiceFonts } from './invoice'

type Props = {
  entries: Parameters<typeof invoiceProjects>[0]
  range: { from: string; to: string }
  userName: string; loading: boolean; sample: boolean; filtered: boolean
}
type DraftExpense = { id: string; name: string; summary: string; amount: string }
type SavedDetails = {
  senderName: string | null; contact: string; billTo: string; paymentDetails: string
  dailyRate: string; hoursPerDay: string; projectLabels: Record<string, string>
}

const storageKey = 'jira-worklog.invoice-details.v1'

function loadSavedDetails(): SavedDetails | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const saved = value as Record<string, unknown>
    if (saved.senderName !== null && typeof saved.senderName !== 'string') return null
    if (!['contact', 'billTo', 'paymentDetails', 'dailyRate', 'hoursPerDay'].every(key => typeof saved[key] === 'string')) return null
    if (!saved.projectLabels || typeof saved.projectLabels !== 'object' || Array.isArray(saved.projectLabels)
      || !Object.values(saved.projectLabels).every(label => typeof label === 'string')) return null
    return saved as SavedDetails
  } catch { return null }
}

function InvoiceSection({ entries, range, userName, loading, sample, filtered }: Props) {
  const [savedDetails] = useState(loadSavedDetails)
  const [remember, setRemember] = useState(Boolean(savedDetails))
  const [storageError, setStorageError] = useState('')
  const [details, setDetails] = useState<SavedDetails>(savedDetails ?? {
    senderName: null, contact: '', paymentDetails: '', dailyRate: '', hoursPerDay: '8', projectLabels: {},
    billTo: 'Development Gateway, Inc.\n\n1100 13th Street, NW, Suite 800\nWashington, D.C. 20005, USA\n+1 202-572-9200\nwww.developmentgateway.org',
  })
  const { senderName, contact, billTo, paymentDetails, dailyRate, hoursPerDay, projectLabels } = details
  const [draftExpenses, setDraftExpenses] = useState<DraftExpense[]>([])
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const name = senderName ?? userName
  const projects = invoiceProjects(entries)
  const expenses = draftExpenses.map(expense => ({ ...expense, amount: expense.amount === '' ? NaN : Number(expense.amount) }))
  let totals: ReturnType<typeof calculateInvoice> | null = null
  if (dailyRate !== '' && hoursPerDay !== '') {
    try { totals = calculateInvoice(entries, Number(dailyRate), Number(hoursPerDay), expenses) }
    catch { totals = null }
  }
  const money = (cents: number | undefined) => cents === undefined ? '--' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

  function saveDetails(nextDetails: SavedDetails) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...nextDetails, senderName: nextDetails.senderName ?? userName }))
      setStorageError('')
    } catch {
      setStorageError('Your browser could not save these details. They are available only in this page session.')
    }
  }

  function changeDetails<Key extends keyof SavedDetails>(field: Key, value: SavedDetails[Key]) {
    const nextDetails = { ...details, [field]: value }
    setDetails(nextDetails)
    if (remember) saveDetails(nextDetails)
  }

  function changeRemember(enabled: boolean) {
    setRemember(enabled)
    if (enabled) saveDetails(details)
    else {
      try { localStorage.removeItem(storageKey); setStorageError('') }
      catch { setStorageError('Your browser could not remove saved details. Clear this site\'s data in your browser settings.') }
    }
  }

  function changeExpense(id: string, field: 'name' | 'summary' | 'amount', value: string) {
    setDraftExpenses(current => current.map(expense => expense.id === id ? { ...expense, [field]: value } : expense))
  }

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setExporting(true)
    try {
      if (!entries.length || loading || dailyRate === '' || hoursPerDay === '') throw new Error('Load worklogs and enter the billing rate first.')
      const response = await fetch('/api/invoice-fonts')
      const fonts = await response.json()
      if (!response.ok) throw new Error(fonts.error || 'Unable to load the invoice fonts.')
      if (typeof fonts.regular !== 'string' || typeof fonts.bold !== 'string') throw new Error('The invoice fonts are unavailable. Restart the local server and try again.')
      const document = createInvoicePdf(entries, range, {
        senderName: name, contact, billTo, paymentDetails,
        dailyRate: Number(dailyRate), hoursPerDay: Number(hoursPerDay), expenses, projectLabels,
      }, sample, fonts as InvoiceFonts)
      const url = URL.createObjectURL(document.output('blob'))
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = `${sample ? 'sample_' : ''}${invoiceFilename(name, range)}`
      window.document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the invoice PDF.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="invoice-section" aria-labelledby="invoice-heading">
      <form onSubmit={download}>
        <div className="invoice-heading">
          <div className="section-heading"><h2 id="invoice-heading">Invoice</h2>{sample && <span className="sample-label">SAMPLE</span>}{filtered && <span>Filtered worklogs</span>}</div>
          <div className="invoice-actions"><strong>Total {loading ? '--' : money(totals?.totalCents)}</strong><button className="primary-button" type="submit" disabled={loading || !entries.length || exporting}>{exporting ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}Download PDF</button></div>
        </div>
        <div className="invoice-period">{range.from} - {range.to}<span>{entries.length} worklogs</span></div>
        <div className="invoice-persistence">
          <label title="Saved unencrypted in this browser profile. Avoid saving payment details on shared computers."><input type="checkbox" checked={remember} onChange={event => changeRemember(event.target.checked)} /><span>Remember invoice details</span></label>
          <button className="secondary-button" type="button" disabled={!remember} onClick={() => changeRemember(false)}><Trash2 size={15} />Clear saved details</button>
        </div>
        {storageError && <div className="error-banner" role="alert">{storageError}</div>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="invoice-fields">
          <div className="invoice-field-group">
            <label><span>Sender name</span><input required maxLength={120} autoComplete="name" value={name} onChange={event => changeDetails('senderName', event.target.value)} /></label>
            <label><span>Address and contact</span><textarea rows={4} maxLength={1000} placeholder={'Address\nPhone\nEmail'} value={contact} onChange={event => changeDetails('contact', event.target.value)} /></label>
          </div>
          <label><span>Bill to</span><textarea required rows={7} maxLength={1000} value={billTo} onChange={event => changeDetails('billTo', event.target.value)} /></label>
          <label><span>Payment details</span><textarea rows={7} maxLength={1000} placeholder={'Bank\nBranch\nSWIFT code\nAccount name\nAccount number'} value={paymentDetails} onChange={event => changeDetails('paymentDetails', event.target.value)} /></label>
        </div>
        <div className="invoice-rate-fields">
          <label><span>Daily rate (USD)</span><input type="number" required min="0" max="1000000" step="0.01" placeholder="0.00" value={dailyRate} onChange={event => changeDetails('dailyRate', event.target.value)} /></label>
          <label><span>Hours per day</span><input type="number" required min="0.01" max="24" step="0.01" value={hoursPerDay} onChange={event => changeDetails('hoursPerDay', event.target.value)} /></label>
          <div><span>Billable hours</span><strong>{loading ? '--' : (entries.reduce((total, entry) => total + entry.seconds, 0) / 3600).toFixed(2)}</strong></div>
          <div><span>Billable days</span><strong>{loading || !totals ? '--' : totals.days.toFixed(4)}</strong></div>
          <div><span>Billable work</span><strong>{loading ? '--' : money(totals?.workCents)}</strong></div>
        </div>
        {projects.length > 0 && <fieldset className="invoice-projects"><legend>Project codes</legend><div>{projects.map(project => <label key={project.key}><span>{project.key}</span><input aria-label={`Billing code for ${project.key}`} maxLength={200} value={projectLabels[project.key] ?? `${project.name} (${project.key})`} onChange={event => changeDetails('projectLabels', { ...projectLabels, [project.key]: event.target.value })} /></label>)}</div></fieldset>}
        <div className="invoice-expenses-heading"><h3>Reimbursable expenses</h3><span>{money(totals?.expenseCents)}</span><button className="secondary-button" type="button" onClick={() => setDraftExpenses(current => [...current, { id: crypto.randomUUID(), name: '', summary: '', amount: '' }])}><Plus size={15} />Add expense</button></div>
        {draftExpenses.map((expense, index) => <div className="invoice-expense-row" key={expense.id}>
          <label><span>Approved report</span><input aria-label={`Expense ${index + 1} report`} required maxLength={200} value={expense.name} onChange={event => changeExpense(expense.id, 'name', event.target.value)} /></label>
          <label><span>Summary</span><input aria-label={`Expense ${index + 1} summary`} maxLength={500} value={expense.summary} onChange={event => changeExpense(expense.id, 'summary', event.target.value)} /></label>
          <label><span>Cost (USD)</span><input aria-label={`Expense ${index + 1} cost`} required type="number" min="0" max="1000000" step="0.01" value={expense.amount} onChange={event => changeExpense(expense.id, 'amount', event.target.value)} /></label>
          <button className="icon-button" type="button" aria-label={`Remove expense ${index + 1}`} title={`Remove expense ${index + 1}`} onClick={() => setDraftExpenses(current => current.filter(item => item.id !== expense.id))}><Trash2 size={16} /></button>
        </div>)}
      </form>
    </section>
  )
}

export default InvoiceSection