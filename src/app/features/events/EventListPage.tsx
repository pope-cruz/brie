import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, EmptyState, ErrorRetry, Pagination, SkeletonRows, StatusBadge } from '../../components/ui'
import { archiveEvent, listEvents, restoreEvent } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, statusLabel } from '../../data/types'
import { formatTimeRange } from '../../lib/timezone'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'
import { SEARCH_DEBOUNCE_MS } from '../../lib/search'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

export function EventListPage() {
  const workspace = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const filter = params.get('filter') || 'upcoming'
  const query = params.get('q') || ''
  const page = Number(params.get('page') || '1')
  const [draftQuery, setDraftQuery] = useState(query)
  const debounced = useDebouncedValue(draftQuery, SEARCH_DEBOUNCE_MS)
  const events = useQuery({
    queryKey: ['events', workspace.id, filter, debounced, page],
    queryFn: () => listEvents(workspace.id, filter, debounced, page),
  })
  const archive = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      filter === 'archived' ? restoreEvent(workspace.id, id, version) : archiveEvent(workspace.id, id, version),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['events', workspace.id] }),
  })

  const filters = useMemo(() => ['upcoming', 'past', 'all', 'archived'] as const, [])

  function setFilter(next: string) {
    const nextParams = new URLSearchParams(params)
    nextParams.set('filter', next)
    nextParams.set('page', '1')
    setParams(nextParams)
  }

  return (
    <div className="app-page">
      <div className="app-header-row">
        <div>
          <h1 className="app-h1">Events</h1>
          <p className="app-lede">{workspace.name}</p>
        </div>
        {canManageEvents(workspace.role) ? (
          <Link className="app-btn app-btn-primary" to={`/app/w/${workspace.id}/events/new`}>
            New event
          </Link>
        ) : null}
      </div>
      <div className="app-toolbar">
        {filters.map((item) => (
          <Button key={item} variant={filter === item ? 'primary' : 'secondary'} onClick={() => setFilter(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </Button>
        ))}
        <input
          className="app-input"
          style={{ maxWidth: 280 }}
          value={draftQuery}
          placeholder="Search titles or locations"
          onChange={(event) => {
            setDraftQuery(event.target.value)
            const nextParams = new URLSearchParams(params)
            nextParams.set('q', event.target.value)
            nextParams.set('page', '1')
            setParams(nextParams)
          }}
        />
      </div>
      {events.isLoading ? <SkeletonRows /> : null}
      {events.isError ? (
        <ErrorRetry message={toAppError(events.error).message} onRetry={() => events.refetch()} />
      ) : null}
      {events.data && events.data.rows.length === 0 ? (
        <EmptyState
          title={
            filter === 'archived'
              ? 'Archived events will appear here.'
              : query
                ? `No events match “${query}”`
                : filter === 'upcoming'
                  ? 'No upcoming events'
                  : workspace.role === 'member'
                    ? 'Your team hasn’t added an event yet.'
                    : 'Plan your first event'
          }
          action={
            query ? (
              <Button variant="secondary" onClick={() => setFilter('all')}>
                Clear filters
              </Button>
            ) : canManageEvents(workspace.role) && filter !== 'archived' && !query ? (
              <Link className="app-btn app-btn-primary" to={`/app/w/${workspace.id}/events/new`}>
                New event
              </Link>
            ) : null
          }
        />
      ) : null}
      {events.data && events.data.rows.length > 0 ? (
        <>
          <div className="app-table-wrap app-table-desktop">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>When</th>
                  <th>Status</th>
                  <th>Lead</th>
                  <th>Tasks</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.data.rows.map((event) => (
                  <tr key={event.id} className="app-event-row">
                    <td>
                      <Link to={`/app/w/${workspace.id}/events/${event.id}`}>{event.title}</Link>
                      {event.location ? <div className="app-meta">{event.location}</div> : null}
                    </td>
                    <td className="app-tabular">{formatTimeRange(event.startsAt, event.endsAt, event.timezone)}</td>
                    <td>
                      <StatusBadge>{statusLabel(event.status)}</StatusBadge>
                    </td>
                    <td>{event.leadFormer ? 'Former member' : event.leadName || 'Unassigned'}</td>
                    <td className="app-tabular">
                      {event.taskDone}/{event.taskTotal}
                    </td>
                    <td>
                      {canManageEvents(workspace.role) ? (
                        <div className="app-toolbar">
                          {filter !== 'archived' ? (
                            <>
                              <Link className="app-btn app-btn-quiet" to={`/app/w/${workspace.id}/events/${event.id}/edit`}>
                                Edit event
                              </Link>
                              <Link className="app-btn app-btn-quiet" to={`/app/w/${workspace.id}/events/${event.id}/duplicate`}>
                                Duplicate
                              </Link>
                            </>
                          ) : null}
                          <Button
                            variant="quiet"
                            onClick={() => {
                              const confirmed = window.confirm(
                                filter === 'archived'
                                  ? 'Restore this event so the team can edit it again?'
                                  : 'Archive this event? It becomes read-only and stays in attendance history.',
                              )
                              if (confirmed) archive.mutate({ id: event.id, version: event.version })
                            }}
                          >
                            {filter === 'archived' ? 'Restore' : 'Archive'}
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="app-stack-mobile">
            {events.data.rows.map((event) => (
              <div key={event.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--app-border)' }}>
                <Link to={`/app/w/${workspace.id}/events/${event.id}`}>{event.title}</Link>
                <p className="app-meta app-tabular">{formatTimeRange(event.startsAt, event.endsAt, event.timezone)}</p>
                <p className="app-meta">
                  {statusLabel(event.status)} · {event.taskDone}/{event.taskTotal} tasks
                </p>
                {canManageEvents(workspace.role) && !event.archivedAt ? (
                  <Link className="app-btn app-btn-secondary" to={`/app/w/${workspace.id}/events/${event.id}/edit`}>Edit event</Link>
                ) : null}
              </div>
            ))}
          </div>
          <Pagination
            page={events.data.page}
            total={events.data.total}
            onPage={(next) => {
              const nextParams = new URLSearchParams(params)
              nextParams.set('page', String(next))
              setParams(nextParams)
            }}
          />
        </>
      ) : null}
    </div>
  )
}
