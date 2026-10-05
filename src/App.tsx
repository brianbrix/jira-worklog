import { useEffect, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronDown, Clock3, Download, ExternalLink, FolderKanban, LoaderCircle, ReceiptText, RefreshCw, Search, Unplug } from 'lucide-react'
import InvoiceSection from './InvoiceSection'
import { groupWorkItems, worklogCsv } from './worklogs'
import type { WorklogEntry as Entry } from './worklogs'
import './App.css'

const jiraUrl = 'https://devgateway.atlassian.net'
type Range = { from: string; to: string }
type Project = { key: string; name: string; url: string }
type Report = Range & {
  user: { displayName: string; timeZone: string }
  entries: Entry[]; fetchedAt: string
}
type Preset = 'week' | 'last-week' | 'month' | 'custom'
type View = 'worklogs' | 'invoice'
type Grouping = 'entries' | 'work-items'

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function presetRange(preset: Preset): Range {
  const today = new Date()
  const from = new Date(today)
  const to = new Date(today)
  if (preset === 'month') from.setDate(1)
  else {
    from.setDate(today.getDate() - (today.getDay() + 6) % 7)
    if (preset === 'last-week') {
      from.setDate(from.getDate() - 7)
      to.setTime(from.getTime())
      to.setDate(from.getDate() + 6)
    }
  }
  return { from: localDate(from), to: localDate(to) }
}

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const remainder = seconds % 60
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', remainder ? `${remainder}s` : ''].filter(Boolean).join(' ') || '0h'
}

function displayDate(date: string, short = false) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', ...(short ? {} : { year: 'numeric' }) }).format(new Date(`${date}T12:00:00`))
}

function sampleReport(range: Range): Report {
  const projects: Project[] = [
    { key: 'AMP', name: 'Aid Management Platform', url: `${jiraUrl}/browse/AMP` },
    { key: 'DGI', name: 'Data & Insights', url: `${jiraUrl}/browse/DGI` },
    { key: 'OPS', name: 'Platform Operations', url: `${jiraUrl}/browse/OPS` },
  ]
  const tasks = ['Improve data import validation', 'Review dashboard queries', 'Resolve deployment configuration', 'Update reporting filters', 'Review API changes', 'Verify release fixes']
  const entries = tasks.map((summary, index) => {
    const date = new Date(`${range.to}T12:00:00`)
    date.setDate(date.getDate() - Math.floor(index / 2))
    const project = projects[index % projects.length]
    const dateString = localDate(date)
    return {
      id: `sample-${index}`, date: dateString, started: `${dateString}T09:00:00Z`,
      seconds: [10800, 5400, 3600, 7200, 9000, 1800][index],
      comment: ['Implementation and verification', 'Review and follow-up', 'Investigate and resolve'][index % 3],
      issueKey: `${project.key}-${120 + index}`, summary, project,
      issueUrl: `${jiraUrl}/browse/${project.key}-${120 + index}`,
    }
  }).filter((entry) => entry.date >= range.from && entry.date <= range.to)
  return { ...range, user: { displayName: 'Sample user', timeZone: 'UTC' }, entries, fetchedAt: new Date().toISOString() }
}

function exportCsv(entries: Entry[], range: Range, grouping: Grouping) {
  const url = URL.createObjectURL(new Blob([worklogCsv(entries, grouping === 'work-items')], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `jira-worklog-${grouping === 'work-items' ? 'by-work-item-' : ''}${range.from}-to-${range.to}.csv`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function App() {
  const [view, setView] = useState<View>('worklogs')
  const [grouping, setGrouping] = useState<Grouping>('entries')
  const [draft, setDraft] = useState<Range>(() => presetRange('week'))
  const [range, setRange] = useState(draft)
  const [preset, setPreset] = useState<Preset>('week')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [sample, setSample] = useState(false)
  const [liveReport, setLiveReport] = useState<Report | null>(null)
  const [isLoading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [projectKey, setProjectKey] = useState('all')
  const [query, setQuery] = useState('')
  const report = sample ? sampleReport(range) : liveReport
  const loading = !sample && isLoading

  useEffect(() => {
    const controller = new AbortController()
    if (sample) return () => controller.abort()
    fetch('/api/status', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('The local API is unavailable.')
        const status = await response.json()
        if (controller.signal.aborted) return null
        setConfigured(status.configured)
        if (!status.configured) return null
        const worklogs = await fetch(`/api/worklogs?${new URLSearchParams(range)}`, { signal: controller.signal })
        const body = await worklogs.json()
        if (!worklogs.ok) throw new Error(body.error || 'Unable to load worklogs.')
        return body as Report
      })
      .then((body) => { if (!controller.signal.aborted) setLiveReport(body) })
      .catch((caught: Error) => {
        if (!controller.signal.aborted) setError(caught.message)
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [range, sample, revision])

  function resetReport() {
    setLiveReport(null)
    setLoading(true)
    setError('')
    setProjectKey('all')
    setQuery('')
  }

  const projects = [...new Map((report?.entries ?? []).map((entry) => [entry.project.key, entry.project])).values()]
  const entries = (report?.entries ?? []).filter((entry) =>
    (projectKey === 'all' || entry.project.key === projectKey)
    && `${entry.issueKey} ${entry.summary} ${entry.comment} ${entry.project.name}`.toLowerCase().includes(query.toLowerCase()))
  const workItems = groupWorkItems(entries)
  const totalSeconds = entries.reduce((total, entry) => total + entry.seconds, 0)
  const breakdown = projects.map((project) => {
    const matching = entries.filter((entry) => entry.project.key === project.key)
    return { ...project, seconds: matching.reduce((total, entry) => total + entry.seconds, 0), count: matching.length }
  }).filter((project) => project.count).sort((first, second) => second.seconds - first.seconds)
  const days = [...new Set(entries.map((entry) => entry.date))].sort()
  const daily = days.map((date) => ({ date, seconds: entries.filter((entry) => entry.date === date).reduce((total, entry) => total + entry.seconds, 0) }))
  const maxDay = Math.max(1, ...daily.map((day) => day.seconds))
  const filtered = projectKey !== 'all' || Boolean(query)

  function applyRange(event: FormEvent) {
    event.preventDefault()
    if (draft.from > draft.to) { setError('Start date must be on or before end date.'); return }
    resetReport()
    setRange({ ...draft })
  }

  function selectPreset(value: Preset) {
    setPreset(value)
    if (value !== 'custom') {
      const nextRange = presetRange(value)
      resetReport()
      setDraft(nextRange)
      setRange(nextRange)
    }
  }

  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextView: View = event.key === 'Home' ? 'worklogs' : event.key === 'End' ? 'invoice' : view === 'worklogs' ? 'invoice' : 'worklogs'
    setView(nextView)
    event.currentTarget.querySelector<HTMLButtonElement>(`#${nextView}-tab`)?.focus()
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Worklog home"><span className="brand-icon"><Clock3 size={21} /></span><span>worklog<span className="brand-period">.</span></span></a>
        <a className="site-link" href={jiraUrl} target="_blank" rel="noreferrer">devgateway.atlassian.net <ArrowUpRight size={14} /></a>
        <label className="sample-toggle"><input type="checkbox" checked={sample} onChange={(event) => { resetReport(); setSample(event.target.checked) }} /><span className="switch" />Sample data</label>
        <span className={`connection ${sample ? 'sample' : report ? 'connected' : ''}`}><span />{sample ? 'Sample mode' : report ? 'Connected to Jira' : configured ? 'Jira configured' : 'Not connected'}</span>
      </header>

      <main>
        <div className="page-heading">
          <div><div className="eyebrow">PERSONAL TIMESHEET</div><h1>My worklog</h1><p>{report ? report.user.displayName : 'Current Jira user'}<span className="separator">/</span>{report?.user.timeZone ?? 'Jira account timezone'}</p></div>
          <div className="heading-actions">
            <button className="icon-button" type="button" aria-label="Refresh worklogs" title="Refresh worklogs" disabled={loading} onClick={() => { resetReport(); setRevision((value) => value + 1) }}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>
            <button className="secondary-button" type="button" aria-label="Export CSV" title={grouping === 'work-items' ? 'Export work items as CSV' : 'Export CSV'} disabled={!entries.length || loading} onClick={() => exportCsv(entries, range, grouping)}><Download size={16} />Export CSV</button>
          </div>
        </div>

        <section className="range-section" aria-label="Date range">
          <div className="presets" role="radiogroup" aria-label="Date presets">
            {([['week', 'This week'], ['last-week', 'Last week'], ['month', 'This month'], ['custom', 'Custom']] as const).map(([value, label]) =>
              <label key={value} className={preset === value ? 'active' : ''}><input type="radio" name="preset" checked={preset === value} onChange={() => selectPreset(value)} />{label}</label>)}
          </div>
          <form className="date-form" onSubmit={applyRange}>
            <label><span>From</span><input aria-label="From date" type="date" required value={draft.from} onChange={(event) => { setDraft({ ...draft, from: event.target.value }); setPreset('custom') }} /></label>
            <span className="date-dash">to</span>
            <label><span>To</span><input aria-label="To date" type="date" required value={draft.to} onChange={(event) => { setDraft({ ...draft, to: event.target.value }); setPreset('custom') }} /></label>
            <button className="primary-button" type="submit" disabled={loading}><CalendarDays size={16} />Apply</button>
          </form>
        </section>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {sample && <div className="sample-notice"><span className="sample-label">SAMPLE DATA</span><span>Not connected to your Jira worklogs.</span></div>}

        <div className="view-tabs" role="tablist" aria-label="Report views" onKeyDown={navigateTabs}>
          <button id="worklogs-tab" type="button" role="tab" aria-selected={view === 'worklogs'} aria-controls="worklogs-panel" tabIndex={view === 'worklogs' ? 0 : -1} onClick={() => setView('worklogs')}><Clock3 size={16} />Worklogs</button>
          <button id="invoice-tab" type="button" role="tab" aria-selected={view === 'invoice'} aria-controls="invoice-panel" tabIndex={view === 'invoice' ? 0 : -1} onClick={() => setView('invoice')}><ReceiptText size={16} />Invoice</button>
        </div>
        <div className="tab-panel" id="worklogs-panel" role="tabpanel" aria-labelledby="worklogs-tab" hidden={view !== 'worklogs'}>
        <section className="summary-band" aria-label="Time summary" aria-busy={loading}>
          <div className="total-stat"><span className="stat-label"><Clock3 size={15} />{filtered ? 'Filtered time' : 'Total logged time'}</span><strong>{report && !loading ? duration(totalSeconds) : '--'}</strong><span className="stat-note">{displayDate(range.from, true)} - {displayDate(range.to)}</span></div>
          <div className="small-stat"><span className="stat-label">Projects</span><strong>{report && !loading ? breakdown.length : '--'}</strong><span className="stat-note">with logged time</span></div>
          <div className="small-stat"><span className="stat-label">Issues</span><strong>{report && !loading ? new Set(entries.map((entry) => entry.issueKey)).size : '--'}</strong><span className="stat-note">worked on</span></div>
          <div className="small-stat"><span className="stat-label">Entries</span><strong>{report && !loading ? entries.length : '--'}</strong><span className="stat-note">worklogs recorded</span></div>
        </section>

        {loading ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={28} /><h2>Loading worklogs</h2></div> : !report ?
          <div className="empty-state"><div className="empty-icon"><Unplug size={30} /></div><h2>{error ? 'Worklogs unavailable' : 'Jira is not connected'}</h2><p>{error ? 'No worklog data loaded.' : 'Jira credentials required.'}</p><a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">Atlassian API tokens <ExternalLink size={14} /></a></div> :
          <>
            <section className="overview" aria-label="Worklog breakdown">
              <div className="project-section"><div className="section-heading"><h2>By project</h2><span>{breakdown.length} projects</span></div>
                {breakdown.length ? breakdown.map((project, index) => <div className="project-row" key={project.key}>
                  <span className={`project-icon color-${index % 4}`}><FolderKanban size={19} /></span>
                  <div className="project-info"><a href={project.url} target="_blank" rel="noreferrer">{project.name}<ArrowUpRight size={13} /></a><span>{project.key} <span className="separator">/</span> {project.count} {project.count === 1 ? 'entry' : 'entries'}</span><div className="project-track"><div className={`color-${index % 4}`} style={{ width: `${totalSeconds ? project.seconds / totalSeconds * 100 : 0}%` }} /></div></div>
                  <strong>{duration(project.seconds)}</strong>
                </div>) : <p className="muted-empty">No projects in this selection.</p>}
              </div>
              <div className="activity-section"><div className="section-heading"><h2>Daily activity</h2><span>{days.length} active {days.length === 1 ? 'day' : 'days'}</span></div>
                <div className="daily-chart" role="list" aria-label="Time logged per day">{daily.length ? daily.map((day) => <div className="chart-column" role="listitem" key={day.date} title={`${displayDate(day.date)}: ${duration(day.seconds)}`}><span>{duration(day.seconds)}</span><div className="bar-space"><div className="chart-bar" style={{ height: `${Math.max(3, day.seconds / maxDay * 100)}%` }} /></div><span>{displayDate(day.date, true)}</span></div>) : <p className="muted-empty">No activity in this selection.</p>}</div>
              </div>
            </section>

            <section className="entries-section" aria-label="Worklog entries">
              <div className="entries-heading"><div className="section-heading"><h2>{grouping === 'work-items' ? 'Work items' : 'Worklog entries'}</h2><span className="count-badge">{grouping === 'work-items' ? workItems.length : entries.length}</span></div>
                <div className="entries-toolbar">
                  <div className="presets grouping-control" role="radiogroup" aria-label="Group worklogs">
                    {([['entries', 'Entries'], ['work-items', 'Work items']] as const).map(([value, label]) => <label key={value} className={grouping === value ? 'active' : ''}><input type="radio" name="worklog-grouping" checked={grouping === value} onChange={() => setGrouping(value)} />{label}</label>)}
                  </div>
                  <div className="table-filters"><label className="search-field"><Search size={15} /><input aria-label="Search worklogs" type="search" placeholder="Search issues or notes" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Filter by project" value={projectKey} onChange={(event) => setProjectKey(event.target.value)}><option value="all">All projects</option>{projects.map((project) => <option key={project.key} value={project.key}>{project.name}</option>)}</select></div>
                </div>
              </div>
              <div className="table-scroll"><table>
                <thead><tr><th>{grouping === 'work-items' ? 'Dates' : 'Date'}</th><th>{grouping === 'work-items' ? 'Work item' : 'Issue / worklog'}</th><th>Project</th><th className="time-cell">Time logged</th></tr></thead>
                <tbody>{grouping === 'work-items' ? workItems.map(item => <tr key={item.issueKey}>
                  <td className="date-cell work-item-date"><span>{displayDate(item.from, item.from.slice(0, 4) === item.to.slice(0, 4))}</span>{item.to !== item.from && <span>to {displayDate(item.to, item.from.slice(0, 4) === item.to.slice(0, 4))}</span>}</td>
                  <td className="issue-cell"><a href={item.issueUrl} target="_blank" rel="noreferrer">{item.issueKey}<ArrowUpRight size={12} /></a><div>{item.summary}</div>
                    <details className="work-item-logs"><summary>{item.entries.length} {item.entries.length === 1 ? 'worklog' : 'worklogs'}<ChevronDown size={12} /></summary><div className="work-item-log-list">{item.entries.map(entry => <div className="work-item-log" key={entry.id}><time dateTime={entry.date}>{displayDate(entry.date)}</time><strong>{duration(entry.seconds)}</strong>{entry.comment && <p>{entry.comment}</p>}</div>)}</div></details>
                  </td>
                  <td><a className="project-key" href={item.project.url} target="_blank" rel="noreferrer">{item.project.key}<ExternalLink size={11} /></a></td>
                  <td className="time-cell">{duration(item.seconds)}</td>
                </tr>) : entries.map((entry) => <tr key={entry.id}><td className="date-cell">{displayDate(entry.date, true)}</td><td className="issue-cell"><a href={entry.issueUrl} target="_blank" rel="noreferrer">{entry.issueKey}<ArrowUpRight size={12} /></a><div>{entry.summary}</div>{entry.comment && <p>{entry.comment}</p>}</td><td><a className="project-key" href={entry.project.url} target="_blank" rel="noreferrer">{entry.project.key}<ExternalLink size={11} /></a></td><td className="time-cell">{duration(entry.seconds)}</td></tr>)}</tbody>
                {entries.length > 0 && <tfoot><tr><td colSpan={3}>{filtered ? 'Filtered total' : 'Total'} <span>{grouping === 'work-items' ? `${workItems.length} work items / ` : ''}{entries.length} entries</span></td><td className="time-cell">{duration(totalSeconds)}</td></tr></tfoot>}
              </table></div>
              {!entries.length && <div className="table-empty"><ArrowDownLeft size={22} /><h3>No worklogs found</h3><p>{filtered ? 'No entries match these filters.' : 'No time logged in this date range.'}</p></div>}
            </section>
          </>}
        </div>
        <div className="tab-panel" id="invoice-panel" role="tabpanel" aria-labelledby="invoice-tab" hidden={view !== 'invoice'}>
          <InvoiceSection entries={entries} range={range} userName={report?.user.displayName ?? ''} loading={loading} sample={sample} filtered={filtered} />
        </div>
        <footer><span><Check size={13} />Read-only worklog report</span><span>{report && !loading ? `Updated ${new Date(report.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'DevGateway / Jira Cloud'}</span></footer>
      </main>
    </div>
  )
}

export default App
