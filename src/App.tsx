import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Check, Clock3, Download, ExternalLink, FolderKanban, LoaderCircle, RefreshCw, Search, Unplug } from 'lucide-react'
import './App.css'

const jiraUrl = 'https://devgateway.atlassian.net'
type Range = { from: string; to: string }
type Project = { key: string; name: string; url: string }
type Entry = {
  id: string; date: string; started: string; seconds: number; comment: string
  issueKey: string; summary: string; issueUrl: string; project: Project
}
type Report = Range & {
  user: { displayName: string; timeZone: string }
  entries: Entry[]; fetchedAt: string
}
type Preset = 'week' | 'last-week' | 'month' | 'custom'

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

function exportCsv(entries: Entry[], range: Range) {
  const cell = (value: string | number) => {
    let text = String(value)
    if (/^\s*[=+\-@\t\r]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  const rows = [
    ['Date', 'Project', 'Project key', 'Issue', 'Summary', 'Comment', 'Seconds', 'Hours', 'Issue URL'],
    ...entries.map((entry) => [entry.date, entry.project.name, entry.project.key, entry.issueKey,
      entry.summary, entry.comment, entry.seconds, (entry.seconds / 3600).toFixed(4), entry.issueUrl]),
  ]
  const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `jira-worklog-${range.from}-to-${range.to}.csv`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function App() {
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
            <button className="secondary-button" type="button" aria-label="Export CSV" title="Export CSV" disabled={!entries.length || loading} onClick={() => exportCsv(entries, range)}><Download size={16} />Export CSV</button>
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
              <div className="entries-heading"><div className="section-heading"><h2>Worklog entries</h2><span className="count-badge">{entries.length}</span></div>
                <div className="table-filters"><label className="search-field"><Search size={15} /><input aria-label="Search worklogs" type="search" placeholder="Search issues or notes" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Filter by project" value={projectKey} onChange={(event) => setProjectKey(event.target.value)}><option value="all">All projects</option>{projects.map((project) => <option key={project.key} value={project.key}>{project.name}</option>)}</select></div>
              </div>
              <div className="table-scroll"><table><thead><tr><th>Date</th><th>Issue / worklog</th><th>Project</th><th className="time-cell">Time logged</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td className="date-cell">{displayDate(entry.date, true)}</td><td className="issue-cell"><a href={entry.issueUrl} target="_blank" rel="noreferrer">{entry.issueKey}<ArrowUpRight size={12} /></a><div>{entry.summary}</div>{entry.comment && <p>{entry.comment}</p>}</td><td><a className="project-key" href={entry.project.url} target="_blank" rel="noreferrer">{entry.project.key}<ExternalLink size={11} /></a></td><td className="time-cell">{duration(entry.seconds)}</td></tr>)}</tbody>{entries.length > 0 && <tfoot><tr><td colSpan={3}>{filtered ? 'Filtered total' : 'Total'} <span>{entries.length} entries</span></td><td className="time-cell">{duration(totalSeconds)}</td></tr></tfoot>}</table></div>
              {!entries.length && <div className="table-empty"><ArrowDownLeft size={22} /><h3>No worklogs found</h3><p>{filtered ? 'No entries match these filters.' : 'No time logged in this date range.'}</p></div>}
            </section>
          </>}
        <footer><span><Check size={13} />Read-only worklog report</span><span>{report && !loading ? `Updated ${new Date(report.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'DevGateway / Jira Cloud'}</span></footer>
      </main>
    </div>
  )
}

export default App
