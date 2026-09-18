import { Link, Navigate, NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getEvent } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, statusLabel } from '../../data/types'
import { formatTimeRange, timeZoneLabel } from '../../lib/timezone'
import { ErrorRetry } from '../../components/ui'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'
import type { EventSectionId } from '../../lib/eventPhase'

export function EventLayout() {
  const workspace = useCurrentWorkspace()
  const { eventId = '' } = useParams()
  const location = useLocation()
  const event = useQuery({
    queryKey: ['event', workspace.id, eventId],
    queryFn: () => getEvent(workspace.id, eventId),
  })

  if (event.isLoading) {
    return (
      <div className="app-page">
        <h1 className="app-h1">Event</h1>
        <p>Loading…</p>
      </div>
    )
  }
  if (event.isError || !event.data) {
    return (
      <div className="app-page">
        <h1 className="app-h1">This page isn’t available</h1>
        <ErrorRetry
          message={event.error ? toAppError(event.error).message : 'Go to events.'}
          onRetry={() => event.refetch()}
        />
      </div>
    )
  }

  const base = `/app/w/${workspace.id}/events/${event.data.id}`
  // Opened from Home: the breadcrumb returns there instead of the event list.
  const fromHome = (location.state as { from?: string } | null)?.from === 'home'
  const subpage = location.pathname.replace(/\/$/, '') !== base
  const manage = canManageEvents(workspace.role) && !event.data.archivedAt
  const lead = event.data.leadFormer ? 'Former member' : event.data.leadName
  return (
    <div className="app-page">
      <p className="app-meta app-event-breadcrumb">
        {fromHome
          ? <Link to={`/app/w/${workspace.id}/home`}>Home</Link>
          : <NavLink to={`/app/w/${workspace.id}/events`}>Events</NavLink>} /{' '}
        {subpage ? <Link to={base}>{event.data.title}</Link> : event.data.title}
      </p>
      <header className="event-header">
        <div className="app-header-row">
          <h1 className="app-h1">{event.data.title}</h1>
          {manage && !subpage ? (
            <div className="app-toolbar">
              <Link className="app-btn app-btn-quiet" to={`${base}/duplicate`}>Duplicate</Link>
              <Link className="app-btn app-btn-secondary" to={`${base}/edit`}>Edit details</Link>
            </div>
          ) : null}
        </div>
        <p className="app-meta">
          {[
            statusLabel(event.data.status),
            formatTimeRange(event.data.startsAt, event.data.endsAt, event.data.timezone),
            timeZoneLabel(event.data.timezone, event.data.startsAt),
            event.data.location,
            lead ? `Lead: ${lead}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
        {!subpage && event.data.description ? <p className="event-description">{event.data.description}</p> : null}
        {event.data.archivedAt ? <div className="app-banner">This event is archived. Restore it to edit the plan.</div> : null}
        {event.data.status === 'canceled' ? <div className="app-banner">This event is canceled. Previously recorded attendance stays in history.</div> : null}
      </header>
      <Outlet context={{ workspace, event: event.data }} />
    </div>
  )
}

/** Sends a former tab URL to its section on the event page, keeping filters and open panels. */
export function EventSectionRedirect({ section }: { section: EventSectionId }) {
  const { workspaceId = '', eventId = '' } = useParams()
  const location = useLocation()
  return <Navigate replace to={{ pathname: `/app/w/${workspaceId}/events/${eventId}`, search: location.search, hash: section }} />
}
