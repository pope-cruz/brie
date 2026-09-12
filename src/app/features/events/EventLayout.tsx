import { NavLink, Outlet, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getEvent } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, canSeeAttendance, statusLabel } from '../../data/types'
import { formatTimeRange, timeZoneLabel } from '../../lib/timezone'
import { ErrorRetry } from '../../components/ui'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'

export function EventLayout() {
  const workspace = useCurrentWorkspace()
  const { eventId = '' } = useParams()
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
  return (
    <div className="app-page">
      <p className="app-meta">
        <NavLink to={`/app/w/${workspace.id}/events`}>Events</NavLink> / {event.data.title}
      </p>
      <div className="app-header-row">
        <h1 className="app-h1">{event.data.title}</h1>
        {canManageEvents(workspace.role) && !event.data.archivedAt ?
          <NavLink className="app-btn app-btn-secondary" to={`${base}/edit`}>Edit event</NavLink> : null}
      </div>
      <p className="app-meta">
        {statusLabel(event.data.status)} · {formatTimeRange(event.data.startsAt, event.data.endsAt, event.data.timezone)} ·{' '}
        {timeZoneLabel(event.data.timezone, event.data.startsAt)}
      </p>
      <div className="app-tabs" role="tablist">
        <NavLink className="app-tab" end to={base}>
          Overview
        </NavLink>
        <NavLink className="app-tab" to={`${base}/tasks`}>
          Tasks
        </NavLink>
        <NavLink className="app-tab" to={`${base}/run-of-show`}>
          Run of show
        </NavLink>
        {canSeeAttendance(workspace.role) ? (
          <NavLink className="app-tab" to={`${base}/attendance`}>
            Attendance
          </NavLink>
        ) : null}
      </div>
      <Outlet context={{ workspace, event: event.data }} />
    </div>
  )
}
