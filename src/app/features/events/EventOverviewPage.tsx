import { Link, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listOverviewSegments, listOverviewTasks } from '../../data/api'
import { canManageEvents, canSeeAttendance, taskStatusLabel, type EventRecord } from '../../data/types'
import type { WorkspaceSummary } from '../../data/api'
import { formatInZone, formatTimeRange } from '../../lib/timezone'
import { toAppError } from '../../data/errors'
import { EmptyState, ErrorRetry, SkeletonRows } from '../../components/ui'

export function EventOverviewPage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  const tasks = useQuery({
    queryKey: ['overview-tasks', workspace.id, event.id],
    queryFn: () => listOverviewTasks(workspace.id, event.id),
  })
  const segments = useQuery({
    queryKey: ['overview-segments', workspace.id, event.id],
    queryFn: () => listOverviewSegments(workspace.id, event.id),
  })
  const manage = canManageEvents(workspace.role) && !event.archivedAt

  return (
    <div>
      {event.archivedAt ? (
        <div className="app-banner">This event is archived. Restore it to edit the plan.</div>
      ) : null}
      {event.status === 'canceled' ? (
        <div className="app-banner">This event is canceled. Previously recorded attendance stays in history.</div>
      ) : null}
      <div className="app-header-row" style={{ marginTop: 16 }}>
        <p className="app-meta">
          {event.location || 'Not added'} · Lead {event.leadFormer ? 'Former member' : event.leadName || 'Unassigned'}
        </p>
        {manage ? (
          <div className="app-toolbar">
            <Link className="app-btn app-btn-quiet" to={`/app/w/${workspace.id}/events/${event.id}/duplicate`}>
              Duplicate
            </Link>
          </div>
        ) : null}
      </div>
      <div className="app-overview-grid" style={{ marginTop: 24 }}>
        <section>
          <h2 className="app-section-title">Description</h2>
          <p>{event.description || 'Not added.'}</p>
          <h2 className="app-section-title" style={{ marginTop: 24 }}>
            Open tasks
          </h2>
          {tasks.isLoading ? <SkeletonRows count={2} /> : tasks.isError ? <ErrorRetry message={toAppError(tasks.error).message} onRetry={() => tasks.refetch()} /> : tasks.data?.length ? (
            <ul>
              {tasks.data.map((task) => (
                <li key={task.id}>
                  <Link to={`/app/w/${workspace.id}/events/${event.id}/tasks?task=${task.id}`}>
                    {task.title}
                  </Link>
                  <span className="app-meta">
                    {' '}
                    · {taskStatusLabel(task.status)}
                    {task.overdue ? ' · Overdue' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={event.taskTotal > 0 ? 'No open tasks' : 'No tasks yet'}
              body={event.taskTotal > 0 ? 'Your team has completed the current task list.' : manage ? 'Add the work your team needs to do.' : 'Ask an organizer to add or assign work.'}
              action={
                manage ? (
                  <Link className="app-btn app-btn-secondary" to={`/app/w/${workspace.id}/events/${event.id}/tasks?task=new`}>
                    Add task
                  </Link>
                ) : null
              }
            />
          )}
        </section>
        <section>
          <h2 className="app-section-title">Details</h2>
          <p className="app-tabular">{formatTimeRange(event.startsAt, event.endsAt, event.timezone)}</p>
          <p className="app-meta">{event.timezone}</p>
          <h2 className="app-section-title" style={{ marginTop: 24 }}>
            Next on the schedule
          </h2>
          {segments.isLoading ? <SkeletonRows count={2} /> : segments.isError ? <ErrorRetry message={toAppError(segments.error).message} onRetry={() => segments.refetch()} /> : segments.data?.length ? (
            <ul>
              {segments.data.map((segment) => (
                <li key={segment.id}>
                  <span className="app-tabular">{formatInZone(segment.startsAt, event.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  {' · '}
                  {segment.title}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No schedule yet"
              body={manage ? 'Add your first segment.' : 'Ask an organizer to add the event schedule.'}
              action={
                manage ? (
                  <Link className="app-btn app-btn-secondary" to={`/app/w/${workspace.id}/events/${event.id}/run-of-show`}>
                    Add segment
                  </Link>
                ) : null
              }
            />
          )}
          <p className="app-meta" style={{ marginTop: 24 }}>
            {event.attendanceCount == null
              ? 'Attendance unavailable'
              : event.attendanceCount === 0
                ? 'Attendance hasn’t been imported.'
                : `${event.attendanceCount} attendees recorded`}
            {canSeeAttendance(workspace.role) && event.attendanceCount ? (
              <>
                {' '}
                <Link to={`/app/w/${workspace.id}/events/${event.id}/attendance`}>View</Link>
              </>
            ) : null}
          </p>
        </section>
      </div>
    </div>
  )
}
