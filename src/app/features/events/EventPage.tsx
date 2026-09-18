import { useLayoutEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useOutletContext } from 'react-router-dom'
import type { WorkspaceSummary } from '../../data/api'
import { canManageEvents, canSeeAttendance, type EventRecord } from '../../data/types'
import { eventPhase, type EventSectionId } from '../../lib/eventPhase'
import { formatInZone, timeZoneLabel } from '../../lib/timezone'
import { RunOfShowPage } from '../schedule/RunOfShowPage'
import { EventTasksPage } from '../tasks/TasksPage'

const SECTIONS: Array<{ id: EventSectionId; label: string }> = [
  { id: 'before', label: 'Before' },
  { id: 'day-of', label: 'Day of' },
  { id: 'after', label: 'After' },
]

function isSection(value: string): value is EventSectionId {
  return SECTIONS.some((section) => section.id === value)
}

export function EventPage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  const location = useLocation()
  const seesAttendance = canSeeAttendance(workspace.role)
  const hash = location.hash.slice(1)
  const [target] = useState<EventSectionId>(() => (isSection(hash) ? hash : eventPhase(event, seesAttendance)))
  // Collapsing applies below 768px only; desktop always shows every section.
  const [expanded, setExpanded] = useState<Set<EventSectionId>>(() => new Set([target]))

  useLayoutEffect(() => {
    if (target !== 'before') document.getElementById(target)?.scrollIntoView({ block: 'start' })
  }, [target])

  function toggle(id: EventSectionId) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const dayLabel = formatInZone(event.startsAt, event.timezone, { weekday: 'short', month: 'short', day: 'numeric', year: undefined, hour: undefined, minute: undefined })
  const zoneLabel = timeZoneLabel(event.timezone, event.startsAt).split(' · ').at(-1)
  const summaries: Record<EventSectionId, string> = {
    before: event.taskTotal ? `${event.taskDone} of ${event.taskTotal} done` : 'No to-dos yet',
    'day-of': `${dayLabel} · ${zoneLabel}`,
    after: attendanceLine(event),
  }

  return (
    <div className="event-page">
      <nav className="event-jump" aria-label="Event sections">
        {SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`} onClick={() => setExpanded((current) => new Set(current).add(section.id))}>
            {section.label}
          </a>
        ))}
      </nav>
      <EventSection id="before" label="Before" summary={summaries.before} open={expanded.has('before')} onToggle={toggle}>
        <EventTasksPage />
      </EventSection>
      <EventSection id="day-of" label="Day of" summary={summaries['day-of']} open={expanded.has('day-of')} onToggle={toggle}>
        <RunOfShowPage />
      </EventSection>
      <EventSection id="after" label="After" summary={summaries.after} open={expanded.has('after')} onToggle={toggle}>
        <AfterSection workspace={workspace} event={event} />
      </EventSection>
    </div>
  )
}

function EventSection({ id, label, summary, open, onToggle, children }: {
  id: EventSectionId
  label: string
  summary: string
  open: boolean
  onToggle: (id: EventSectionId) => void
  children: ReactNode
}) {
  const bodyId = `${id}-body`
  return (
    <section id={id} className={`event-section event-section-${id}`} data-collapsed={open ? undefined : ''} aria-labelledby={`${id}-title`}>
      <header className="event-section-head">
        <h2 id={`${id}-title`}>{label}</h2>
        <span className="event-section-summary">{summary}</span>
        <button type="button" className="event-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(id)}>
          {open ? 'Hide' : 'Show'}<span className="sr-only"> {label}</span>
        </button>
      </header>
      <div id={bodyId} className="event-section-body">{children}</div>
    </section>
  )
}

function attendanceLine(event: EventRecord) {
  if (event.attendanceCount == null) return 'Attendance unavailable'
  if (event.attendanceCount === 0) return 'Attendance hasn’t been recorded'
  return `${event.attendanceCount} ${event.attendanceCount === 1 ? 'attendee' : 'attendees'} recorded`
}

function AfterSection({ workspace, event }: { workspace: WorkspaceSummary; event: EventRecord }) {
  if (!canSeeAttendance(workspace.role)) {
    return <p className="app-meta">Organizers record attendance after the event.</p>
  }
  const base = `/app/w/${workspace.id}/events/${event.id}/attendance`
  const canImport = canManageEvents(workspace.role) && !event.archivedAt && event.status !== 'canceled'
  return (
    <div className="event-after">
      <div className="app-toolbar">
        {canImport ? <Link className="app-btn app-btn-secondary" to={`${base}/import`}>Import attendance</Link> : null}
        {event.attendanceCount ? <Link className="app-btn app-btn-quiet" to={base}>View attendees</Link> : null}
        <Link className="app-btn app-btn-quiet" to={`${base}?view=imports`}>View imports</Link>
      </div>
      {event.status === 'canceled' ? <p className="app-meta">Canceled events keep recorded attendance but don’t accept new imports.</p> : null}
    </div>
  )
}
