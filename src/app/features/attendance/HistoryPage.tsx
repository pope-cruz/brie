import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, EmptyState, ErrorRetry, Pagination, SkeletonRows } from '../../components/ui'
import { listAttendanceGroups, listEventAttendanceGroups } from '../../data/api'
import { toAppError } from '../../data/errors'
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
  const attendedEventId = params.get('attended') || ''
  const anyEventIds = (params.get('any') || '').split(',').filter(Boolean)
  const firstEventId = params.get('first') || ''
  const minEvents = params.get('min') || ''
  const notSeenSince = params.get('notSeen') || ''
  const [draft, setDraft] = useState(query)
  const debounced = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)

  const allowed = canSeeAttendance(workspace.role)
  const events = useQuery({
    queryKey: ['attendance-events', workspace.id],
    queryFn: () => listEventAttendanceGroups(workspace.id),
    enabled: allowed,
  })
  const history = useQuery({
    queryKey: ['history', workspace.id, debounced, from, to, attendedEventId, anyEventIds.join(','), firstEventId, minEvents, notSeenSince, page],
    queryFn: () => listAttendanceGroups(workspace.id, debounced, {
      ...(from ? { from } : {}), ...(to ? { to } : {}),
      ...(attendedEventId ? { attendedEventId } : {}),
      ...(anyEventIds.length ? { anyEventIds } : {}),
      ...(firstEventId ? { firstEventId } : {}),
      ...(minEvents ? { minEvents: Number(minEvents) } : {}),
      ...(notSeenSince ? { notSeenSince } : {}),
    }, page),
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
      <h1 className="app-h1">People</h1>
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
      </div>
      <div className="app-toolbar" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
        <label>Attended event
          <select className="app-input" value={attendedEventId} onChange={(event) => update({ attended: event.target.value })}>
            <option value="">Any event</option>
            {events.data?.map((item) => <option key={item.eventId} value={item.eventId}>{item.title}</option>)}
          </select>
        </label>
        <label>Attended any of these events
          <select className="app-input" multiple size={Math.min(4, Math.max(2, events.data?.length || 2))}
            value={anyEventIds}
            onChange={(event) => update({ any: Array.from(event.target.selectedOptions, (option) => option.value).join(',') })}>
            {events.data?.map((item) => <option key={item.eventId} value={item.eventId}>{item.title}</option>)}
          </select>
          <span className="app-meta">Hold Command or Ctrl to choose several.</span>
        </label>
        <label>First attended at
          <select className="app-input" value={firstEventId} onChange={(event) => update({ first: event.target.value })}>
            <option value="">Any event</option>
            {events.data?.map((item) => <option key={item.eventId} value={item.eventId}>{item.title}</option>)}
          </select>
        </label>
        <label>At least this many events
          <input className="app-input" type="number" min="1" value={minEvents} onChange={(event) => update({ min: event.target.value })} />
        </label>
        <label>Not seen since
          <input className="app-input" type="date" value={notSeenSince} onChange={(event) => update({ notSeen: event.target.value })} />
        </label>
        <label>Event date from
          <input className="app-input" type="date" value={from} onChange={(event) => update({ from: event.target.value })} />
        </label>
        <label>Event date to
          <input className="app-input" type="date" value={to} onChange={(event) => update({ to: event.target.value })} />
        </label>
      </div>
      {events.isError ? <ErrorRetry message={toAppError(events.error).message} onRetry={() => events.refetch()} /> : null}
      {history.data ? (
        <p className="app-meta">
          {history.data.peopleCount} people · {history.data.eventCount} events in this view
        </p>
      ) : null}
      {history.isLoading ? <SkeletonRows /> : null}
      {history.isError ? <ErrorRetry message={toAppError(history.error).message} onRetry={() => history.refetch()} /> : null}
      {history.data?.rows.length === 0 ? (
        <EmptyState
          title={params.toString() ? 'No attendance matches these filters' : 'Attendance history starts with your first import'}
          action={
            params.toString() ? (
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
          <Link to={`/app/w/${workspace.id}/people/${person.id}?${params.toString()}`}>
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
