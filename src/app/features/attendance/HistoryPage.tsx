import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, EmptyState, Pagination, SkeletonRows } from '../../components/ui'
import { listAttendanceHistory } from '../../data/api'
import { canSeeAttendance, statusLabel } from '../../data/types'
import { SEARCH_DEBOUNCE_MS } from '../../lib/search'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'
import { eventLocalDate } from '../../lib/timezone'

export function HistoryPage() {
  const workspace = useCurrentWorkspace()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const page = Number(params.get('page') || '1')
  const [draft, setDraft] = useState(query)
  const debounced = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)

  const allowed = canSeeAttendance(workspace.role)
  const history = useQuery({
    queryKey: ['history', workspace.id, debounced, from, to, page],
    queryFn: () => listAttendanceHistory(workspace.id, debounced, from || null, to || null, page),
    enabled: allowed,
  })

  if (!allowed) {
    return (
      <div className="app-page">
        <h1 className="app-h1">This page isn’t available</h1>
        <p>Ask an organizer to review attendance history.</p>
      </div>
    )
  }

  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params)
    Object.entries(next).forEach(([key, value]) => {
      if (value) merged.set(key, value)
      else merged.delete(key)
    })
    merged.set('page', next.page || '1')
    setParams(merged)
  }

  return (
    <div className="app-page">
      <h1 className="app-h1">Attendance history</h1>
      <p className="app-lede">People recorded at your workspace’s events.</p>
      <div className="app-toolbar">
        <input
          className="app-input"
          style={{ maxWidth: 260 }}
          value={draft}
          placeholder="Search names or emails"
          onChange={(event) => {
            setDraft(event.target.value)
            update({ q: event.target.value })
          }}
        />
        <input className="app-input" type="date" value={from} onChange={(event) => update({ from: event.target.value })} />
        <input className="app-input" type="date" value={to} onChange={(event) => update({ to: event.target.value })} />
      </div>
      {history.data ? (
        <p className="app-meta">
          {history.data.peopleCount} people · {history.data.eventCount} events in this view
        </p>
      ) : null}
      {history.isLoading ? <SkeletonRows /> : null}
      {history.data?.rows.length === 0 ? (
        <EmptyState
          title={query || from || to ? 'No attendance matches these filters' : 'Attendance history starts with your first import'}
          action={
            query || from || to ? (
              <Button variant="secondary" onClick={() => setParams({})}>
                Clear filters
              </Button>
            ) : (
              <Link className="app-btn app-btn-secondary" to={`/app/w/${workspace.id}/events`}>
                Browse events
              </Link>
            )
          }
        />
      ) : null}
      {history.data?.rows.map((person) => (
        <div key={person.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--app-border)' }}>
          <Link to={`/app/w/${workspace.id}/attendance/${person.id}?${params.toString()}`}>
            {person.name || 'Name not provided'}
          </Link>
          <p className="app-meta">
            {person.email} · {person.eventsAttended} events · {person.lastEventTitle}
            {person.lastEventStatus ? ` · ${statusLabel(person.lastEventStatus)}` : ''}
            {person.lastAttended ? ` · ${eventLocalDate(person.lastAttended, workspace.timezone)}` : ''}
          </p>
        </div>
      ))}
      {history.data ? (
        <Pagination page={history.data.page} total={history.data.total} onPage={(next) => update({ page: String(next) })} />
      ) : null}
    </div>
  )
}
