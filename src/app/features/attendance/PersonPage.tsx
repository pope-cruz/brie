import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ErrorRetry } from '../../components/ui'
import { getAttendeeDetail } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canSeeAttendance, statusLabel } from '../../data/types'
import { formatTimeRange } from '../../lib/timezone'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'

export function PersonPage() {
  const workspace = useCurrentWorkspace()
  const { personId = '' } = useParams()
  const [params] = useSearchParams()
  const detail = useQuery({
    queryKey: ['person', workspace.id, personId],
    queryFn: () => getAttendeeDetail(workspace.id, personId),
    enabled: canSeeAttendance(workspace.role),
  })

  if (!canSeeAttendance(workspace.role)) {
    return (
      <div className="app-page">
        <h1 className="app-h1">This page isn’t available</h1>
      </div>
    )
  }
  if (detail.isError) {
    return (
      <div className="app-page">
        <ErrorRetry message={toAppError(detail.error).message} onRetry={() => detail.refetch()} />
      </div>
    )
  }
  if (!detail.data) {
    return (
      <div className="app-page">
        <h1 className="app-h1">Attendance</h1>
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <div className="app-page">
      <Link to={`/app/w/${workspace.id}/attendance?${params.toString()}`}>Attendance history</Link>
      <h1 className="app-h1">{detail.data.name || 'Name not provided'}</h1>
      <p className="app-meta">{detail.data.email}</p>
      <p>
        {detail.data.eventsAttended} events
        {detail.data.firstAttended ? ` · first ${new Date(detail.data.firstAttended).toLocaleDateString()}` : ''}
        {detail.data.lastAttended ? ` · last ${new Date(detail.data.lastAttended).toLocaleDateString()}` : ''}
      </p>
      {detail.data.events.length === 0 ? <p>No active attendance records.</p> : null}
      {detail.data.events.map((item) => (
        <div key={item.eventId} style={{ padding: '12px 0', borderBottom: '1px solid var(--app-border)' }}>
          <Link to={`/app/w/${workspace.id}/events/${item.eventId}`}>{item.title}</Link>
          <p className="app-meta app-tabular">
            {formatTimeRange(item.startsAt, item.startsAt, item.timezone)} · {statusLabel(item.status)}
          </p>
          {item.batches?.map((batch) => (
            <p key={batch.id} className="app-meta">
              <Link to={`/app/w/${workspace.id}/events/${item.eventId}/attendance/imports/${batch.id}`}>
                {batch.fileLabel}
              </Link>
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}
