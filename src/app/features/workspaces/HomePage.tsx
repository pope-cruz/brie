import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorRetry, Pagination, SkeletonRows } from '../../components/ui'
import { listEvents, listHomeSchedule, listWorkspaceTasks, setTaskStatus } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type HomeScheduleRecord, type TaskRecord, type TaskStatus } from '../../data/types'
import { groupByEvent } from '../../lib/groupByEvent'
import { formatTimeRange } from '../../lib/timezone'
import { rowTimeLabel, scheduleMarks } from '../../lib/scheduleView'
import { useCurrentWorkspace } from './workspaceContext'

type RowState = { status: TaskStatus; version: number; busy: boolean; error: string | null }

function dueLabel(date: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`))
}

function groupSchedule(rows: HomeScheduleRecord[]) {
  const groups = new Map<string, { eventId: string; eventTitle: string; items: HomeScheduleRecord[] }>()
  for (const row of rows) {
    const group = groups.get(row.eventId) ?? { eventId: row.eventId, eventTitle: row.eventTitle, items: [] }
    group.items.push(row)
    groups.set(row.eventId, group)
  }
  return [...groups.values()]
}

export function HomePage() {
  const workspace = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const page = Number(params.get('page') || '1')
  // Checked rows stay in place (and can be unchecked) until the next visit refreshes the list.
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const organizer = canManageEvents(workspace.role)

  const tasks = useQuery({
    queryKey: ['home-tasks', workspace.id, page],
    queryFn: () => listWorkspaceTasks(workspace.id, 'open', 'me', false, page),
  })
  const upcoming = useQuery({
    queryKey: ['events', workspace.id, 'upcoming', '', 1],
    queryFn: () => listEvents(workspace.id, 'upcoming', '', 1),
    enabled: organizer,
  })
  const schedule = useQuery({
    queryKey: ['home-schedule', workspace.id],
    queryFn: () => listHomeSchedule(workspace.id),
    refetchOnWindowFocus: true,
  })

  async function toggle(task: TaskRecord, done: boolean) {
    const previous = rows[task.id] ?? { status: task.status, version: task.version, busy: false, error: null }
    const next: TaskStatus = done ? 'done' : 'todo'
    setNotice(null)
    setRows((current) => ({ ...current, [task.id]: { ...previous, status: next, busy: true, error: null } }))
    try {
      const saved = await setTaskStatus(workspace.id, task.id, next, previous.version)
      setRows((current) => ({ ...current, [task.id]: { status: saved.status, version: saved.version, busy: false, error: null } }))
      await Promise.all(['tasks', 'event', 'events'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
    } catch (caught) {
      const error = toAppError(caught)
      if (error.code === 'CONFLICT' || error.code === 'FORBIDDEN') {
        // Someone else changed it (reassigned, edited, archived): show the latest list instead.
        setRows((current) => {
          const rest = { ...current }
          delete rest[task.id]
          return rest
        })
        setNotice(`“${task.title}” changed while you were checking it off. The list now shows the latest.`)
        await tasks.refetch()
      } else {
        setRows((current) => ({ ...current, [task.id]: { ...previous, busy: false, error: error.message } }))
      }
    }
  }

  const groups = groupByEvent(tasks.data?.rows ?? [])
  const nextEvents = (upcoming.data?.rows ?? []).slice(0, 5)

  return (
    <div className="app-page home-page">
      <h1 className="app-h1">Home</h1>

      <section className="home-section" aria-labelledby="home-todos">
        <h2 id="home-todos" className="app-section-title">Your to-dos</h2>
        {notice ? <p className="app-banner" role="status">{notice}</p> : null}
        {tasks.isLoading ? <SkeletonRows count={4} /> : null}
        {tasks.isError ? <ErrorRetry message={toAppError(tasks.error).message} onRetry={() => tasks.refetch()} /> : null}
        {tasks.data && tasks.data.total === 0 ? (
          <p className="app-meta">Nothing assigned to you yet. <Link to={`/app/w/${workspace.id}/events`}>Go to events</Link></p>
        ) : null}
        {groups.map((group) => (
          <div key={group.eventId} className="home-group">
            <h3 className="home-group-title">
              <Link to={`/app/w/${workspace.id}/events/${group.eventId}`} state={{ from: 'home' }}>{group.eventTitle}</Link>
            </h3>
            <ul className="home-list">
              {group.tasks.map((task) => {
                const state = rows[task.id]
                const status = state?.status ?? task.status
                return (
                  <li key={task.id} className="home-todo" data-done={status === 'done' ? '' : undefined}>
                    <label className="home-check">
                      <input type="checkbox" checked={status === 'done'} disabled={state?.busy}
                        onChange={(change) => toggle(task, change.target.checked)} />
                      <span className="home-todo-title">{task.title}</span>
                    </label>
                    <span className="home-todo-meta">
                      {task.overdue && status !== 'done' ? <span className="home-overdue">Overdue · </span> : null}
                      {task.dueDate ? `Due ${dueLabel(task.dueDate)}` : null}
                    </span>
                    {state?.error ? (
                      <p className="app-error-text home-row-error" role="alert">
                        {state.error}{' '}
                        <button type="button" className="ros-retry-link" onClick={() => toggle(task, status !== 'done')}>Retry</button>
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        {tasks.data && tasks.data.total > 50 ? (
          <Pagination page={tasks.data.page} total={tasks.data.total}
            onPage={(next) => { const merged = new URLSearchParams(params); merged.set('page', String(next)); setParams(merged) }} />
        ) : null}
      </section>

      <section className="home-section" aria-labelledby="home-schedule">
        <h2 id="home-schedule" className="app-section-title">Your schedule</h2>
        {schedule.isLoading ? <SkeletonRows count={3} /> : null}
        {schedule.isError ? <ErrorRetry message={toAppError(schedule.error).message} onRetry={() => schedule.refetch()} /> : null}
        {schedule.data?.length === 0 ? <p className="app-meta">Nothing on your schedule in the next seven days.</p> : null}
        {groupSchedule(schedule.data ?? []).map((group) => {
          const first = group.items[0]
          const marks = scheduleMarks(group.items, {
            startsAt: first.eventStartsAt, endsAt: first.eventEndsAt, timezone: first.eventTimezone,
          }, now)
          return <div key={group.eventId} className="home-group">
            <h3 className="home-group-title"><Link to={`/app/w/${workspace.id}/events/${group.eventId}#day-of`} state={{ from: 'home' }}>{group.eventTitle}</Link></h3>
            <ul className="home-list">{group.items.map((item) => {
              const time = rowTimeLabel(item, { startsAt: item.eventStartsAt, timezone: item.eventTimezone }, true)
              const mark = marks.get(item.id)
              return <li key={item.id} className="home-event">
                <Link to={`/app/w/${workspace.id}/events/${group.eventId}#day-of`} state={{ from: 'home' }}>{item.title}</Link>
                <span className="home-todo-meta app-tabular">{mark === 'now' ? 'Now · ' : mark === 'next' ? 'Next · ' : ''}{time.date} · {time.range}</span>
              </li>
            })}</ul>
          </div>
        })}
      </section>

      {organizer ? (
        <section className="home-section" aria-labelledby="home-upcoming">
          <h2 id="home-upcoming" className="app-section-title">Upcoming events</h2>
          {upcoming.isLoading ? <SkeletonRows count={3} /> : null}
          {upcoming.isError ? <ErrorRetry message={toAppError(upcoming.error).message} onRetry={() => upcoming.refetch()} /> : null}
          {upcoming.data && nextEvents.length === 0 ? (
            <p className="app-meta">No upcoming events. <Link to={`/app/w/${workspace.id}/events/new`}>New event</Link></p>
          ) : null}
          {nextEvents.length > 0 ? (
            <ul className="home-list">
              {nextEvents.map((event) => (
                <li key={event.id} className="home-event">
                  <Link to={`/app/w/${workspace.id}/events/${event.id}`} state={{ from: 'home' }}>{event.title}</Link>
                  <span className="home-todo-meta app-tabular">{formatTimeRange(event.startsAt, event.endsAt, event.timezone)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
