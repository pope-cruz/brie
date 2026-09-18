import { DateTimeRange } from '../../components/DateTimeRange'
import { TimeZonePicker } from '../../components/TimeZonePicker'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field } from '../../components/ui'
import { createEvent, duplicateEvent, getEvent, listTeam, updateEvent } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type EventRecord, type EventStatus } from '../../data/types'
import { clearRequestKey, getRequestKey } from '../../lib/idempotency'
import { resolveLocalDateTime, splitInZone, timeZoneLabel } from '../../lib/timezone'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'

type Mode = 'new' | 'edit' | 'duplicate'

export function EventFormPage({ mode }: { mode: Mode }) {
  const workspace = useCurrentWorkspace()
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const source = useQuery({
    queryKey: ['event', workspace.id, eventId],
    queryFn: () => getEvent(workspace.id, eventId),
    enabled: mode !== 'new',
  })
  const team = useQuery({
    queryKey: ['team', workspace.id],
    queryFn: () => listTeam(workspace.id),
  })

  if (!canManageEvents(workspace.role)) {
    return (
      <div className="app-page app-page-narrow">
        <h1 className="app-h1">This page isn’t available</h1>
        <p className="app-lede">Ask an organizer to create or edit events.</p>
      </div>
    )
  }

  if (mode !== 'new' && source.isPending && !source.errorUpdatedAt) {
    return (
      <div className="app-page app-page-narrow">
        <h1 className="app-h1">{mode === 'edit' ? 'Edit event' : 'Duplicate event'}</h1>
        <p role="status">Loading…</p>
      </div>
    )
  }

  if (mode !== 'new' && !source.data) {
    return (
      <div className="app-page app-page-narrow">
        <h1 className="app-h1">{mode === 'edit' ? 'Edit event' : 'Duplicate event'}</h1>
        <p role="alert">Couldn’t load this event. It may be unavailable, or your connection may have dropped.</p>
        <div className="app-toolbar">
          <Button onClick={() => source.refetch()} busy={source.isFetching} busyLabel="Retrying…">Try again</Button>
          <Link className="app-link" to={`/app/w/${workspace.id}/events`}>Back to events</Link>
        </div>
      </div>
    )
  }

  const initial = source.data
  const startParts = initial ? splitInZone(initial.startsAt, initial.timezone) : { date: '', time: '', offset: '' }
  const endParts = initial ? splitInZone(initial.endsAt, initial.timezone) : { date: '', time: '', offset: '' }

  return (
    <EventForm
      key={`${mode}:${workspace.id}:${eventId}`}
      layout="page"
      mode={mode}
      workspaceId={workspace.id}
      timezoneDefault={initial?.timezone || workspace.timezone}
      defaultTitle={mode === 'duplicate' && initial ? `${initial.title} copy` : initial?.title || ''}
      defaultDescription={initial?.description || ''}
      defaultLocation={initial?.location || ''}
      defaultStartDate={startParts.date}
      defaultStartTime={startParts.time}
      defaultEndDate={endParts.date}
      defaultEndTime={endParts.time}
      defaultStartOffset={startParts.offset}
      defaultEndOffset={endParts.offset}
      defaultLead={mode === 'duplicate' ? '' : initial?.leadMembershipId || ''}
      defaultStatus={initial?.status || 'draft'}
      version={initial?.version || 1}
      sourceId={initial?.id}
      members={(team.data?.members ?? []).filter((member) => !member.removedAt)}
      onCancel={() => navigate(mode === 'new' ? `/app/w/${workspace.id}/events` : `/app/w/${workspace.id}/events/${eventId}`)}
    />
  )
}

/**
 * The event fields for every place an event is created or edited.
 * `page` is a full page; `embedded` sits in the quick-create popover or the details panel.
 * A new event asks only title, zone, and times; the rest waits for Edit details.
 */
export function EventForm({
  mode,
  layout = 'page',
  onSaved,
  onDirtyChange,
  workspaceId,
  timezoneDefault,
  defaultTitle,
  defaultDescription,
  defaultLocation,
  defaultStartDate,
  defaultStartTime,
  defaultEndDate,
  defaultEndTime,
  defaultStartOffset,
  defaultEndOffset,
  defaultLead,
  defaultStatus,
  version,
  sourceId,
  members,
  onCancel,
}: {
  mode: Mode
  workspaceId: string
  timezoneDefault: string
  defaultTitle: string
  defaultDescription: string
  defaultLocation: string
  defaultStartDate: string
  defaultStartTime: string
  defaultEndDate: string
  defaultEndTime: string
  defaultStartOffset: string
  defaultEndOffset: string
  defaultLead: string
  defaultStatus: EventStatus
  version: number
  sourceId?: string
  members: Array<{ id: string; displayName: string }>
  onCancel: () => void
  layout?: 'page' | 'embedded'
  /** Replaces the default navigation to the event page after a save. */
  onSaved?: (saved: EventRecord) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState(defaultDescription)
  const [location, setLocation] = useState(defaultLocation)
  const [timezone, setTimezone] = useState(timezoneDefault)
  const [startDate, setStartDate] = useState(defaultStartDate)
  const [startTime, setStartTime] = useState(defaultStartTime)
  const [endDate, setEndDate] = useState(defaultEndDate)
  const [endTime, setEndTime] = useState(defaultEndTime)
  const [startOffset, setStartOffset] = useState<string | undefined>(defaultStartOffset)
  const [endOffset, setEndOffset] = useState<string | undefined>(defaultEndOffset)
  const [lead, setLead] = useState(defaultLead)
  const [status, setStatus] = useState<EventStatus>(defaultStatus)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [changingZone, setChangingZone] = useState(mode !== 'new')
  const dirty = title !== defaultTitle || description !== defaultDescription || location !== defaultLocation
    || timezone !== timezoneDefault || startDate !== defaultStartDate || startTime !== defaultStartTime
    || endDate !== defaultEndDate || endTime !== defaultEndTime || lead !== defaultLead || status !== defaultStatus

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  // Range errors describe the times that were submitted; they stop showing once those change.
  const rangeKey = [startDate, startTime, endDate, endTime, startOffset, endOffset, timezone].join('|')
  const [errorsFor, setErrorsFor] = useState(rangeKey)
  const rangeErrors = errorsFor === rangeKey
  function showErrors(next: Record<string, string>) {
    setErrors(next)
    setErrorsFor(rangeKey)
  }

  const headings = useMemo(
    () => ({ new: 'New event', edit: 'Edit event', duplicate: 'Duplicate event' }),
    [],
  )

  function resolveRange() {
    const missing: Record<string, string> = {}
    if (!startDate || !startTime) missing.startsAt = 'Enter a start date and time.'
    if (!endDate || !endTime) missing.endsAt = 'Enter an end date and time.'
    if (Object.keys(missing).length > 0) return { error: missing }
    const start = resolveLocalDateTime(startDate, startTime, timezone, startOffset)
    const end = resolveLocalDateTime(endDate, endTime, timezone, endOffset)
    if (!start.ok && start.reason === 'nonexistent') {
      return { error: { startsAt: 'That local start time does not exist in this time zone.' } as Record<string, string> }
    }
    if (!end.ok && end.reason === 'nonexistent') {
      return { error: { endsAt: 'That local end time does not exist in this time zone.' } as Record<string, string> }
    }
    if (!start.ok && start.reason === 'ambiguous') {
      return { ambiguous: 'start' as const, options: start.options }
    }
    if (!end.ok && end.reason === 'ambiguous') {
      return { ambiguous: 'end' as const, options: end.options }
    }
    if (start.ok && end.ok) return { start: start.iso, end: end.iso }
    return { error: { form: 'Enter a start and end.' } as Record<string, string> }
  }

  // The event header and overview read ['event', …]; seed it with the saved
  // record so status/title changes show before any background refetch.
  function rememberSaved(saved: EventRecord) {
    queryClient.setQueryData(['event', workspaceId, saved.id], saved)
    void queryClient.invalidateQueries({ queryKey: ['events', workspaceId] })
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const resolved = resolveRange()
    if ('error' in resolved && resolved.error) {
      showErrors(resolved.error)
      return
    }
    if ('ambiguous' in resolved && resolved.ambiguous) {
      showErrors({
        [resolved.ambiguous === 'start' ? 'startsAt' : 'endsAt']:
          'This time happens twice. Choose which offset to use.',
      })
      return
    }
    if (!('start' in resolved) || !resolved.start || !resolved.end) return
    setBusy(true)
    setErrors({})
    try {
      if (mode === 'new') {
        const created = await createEvent({
          workspaceId,
          title,
          description,
          location,
          startsAt: resolved.start,
          endsAt: resolved.end,
          timezone,
          leadMembershipId: lead || null,
          requestKey: getRequestKey(`create_event:${workspaceId}`),
        })
        clearRequestKey(`create_event:${workspaceId}`)
        rememberSaved(created)
        if (onSaved) onSaved(created)
        // Land in the first Before row: the next step for a new event is its to-dos.
        else navigate(`/app/w/${workspaceId}/events/${created.id}`, { state: { focus: 'before' } })
      } else if (mode === 'duplicate' && sourceId) {
        const created = await duplicateEvent({
          workspaceId,
          sourceEventId: sourceId,
          title,
          startsAt: resolved.start,
          endsAt: resolved.end,
          timezone,
          requestKey: getRequestKey(`duplicate_event:${sourceId}`),
        })
        clearRequestKey(`duplicate_event:${sourceId}`)
        rememberSaved(created)
        if (onSaved) onSaved(created)
        else navigate(`/app/w/${workspaceId}/events/${created.id}`)
      } else if (sourceId) {
        const updated = await updateEvent({
          workspaceId,
          eventId: sourceId,
          title,
          description,
          location,
          startsAt: resolved.start,
          endsAt: resolved.end,
          timezone,
          leadMembershipId: lead || null,
          status,
          expectedVersion: version,
        })
        rememberSaved(updated)
        if (onSaved) onSaved(updated)
        else navigate(`/app/w/${workspaceId}/events/${updated.id}`)
      }
    } catch (caught) {
      const appError = toAppError(caught)
      // A message already shown beside its field isn't repeated under the form.
      const shownOnField = Object.values(appError.fields).includes(appError.message)
      showErrors({ ...(shownOnField ? {} : { form: appError.message }), ...appError.fields })
    } finally {
      setBusy(false)
    }
  }

  const form = (
    <form onSubmit={onSubmit} className={layout === 'embedded' ? 'event-form-embedded' : undefined}>
        <Field label="Title" error={errors.title}>
          <input className="app-input" value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} />
        </Field>
        {mode === 'edit' ? (
          <>
            <Field label="Description">
              <textarea className="app-textarea" value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} />
            </Field>
            <Field label="Location">
              <input className="app-input" value={location} maxLength={200} onChange={(event) => setLocation(event.target.value)} />
            </Field>
          </>
        ) : null}
        {changingZone ? (
          <Field label="Time zone" error={errors.timezone} hint="Enter all dates and times in this zone. Changing it keeps the clock times you entered.">
            <TimeZonePicker value={timezone} onChange={(zone) => { setTimezone(zone); setStartOffset(undefined); setEndOffset(undefined) }} />
          </Field>
        ) : (
          <p className="app-meta event-form-zone">
            Times in {timeZoneLabel(timezone, new Date().toISOString())}.{' '}
            <button type="button" className="app-link-button" onClick={() => setChangingZone(true)}>Change</button>
          </p>
        )}
        <DateTimeRange startDate={startDate} endDate={endDate} startTime={startTime} endTime={endTime}
          startOffset={startOffset} endOffset={endOffset} timezone={timezone} onStartDate={setStartDate} onEndDate={setEndDate} onStartTime={setStartTime} onEndTime={setEndTime} onStartOffset={setStartOffset} onEndOffset={setEndOffset} startError={rangeErrors ? errors.startsAt : undefined} endError={rangeErrors ? errors.endsAt : undefined} />
        {mode === 'edit' ? (
          <Field label="Lead">
            <select className="app-select" value={lead} onChange={(event) => setLead(event.target.value)}>
              <option value="">Unassigned</option>
              {/* A removed lead stays visible but can't be picked again. */}
              {defaultLead && members.length > 0 && !members.some((member) => member.id === defaultLead)
                ? <option value={defaultLead} disabled={lead !== defaultLead}>Former member</option> : null}
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {mode === 'edit' ? (
          <Field label="Status">
            <select className="app-select" value={status} onChange={(event) => setStatus(event.target.value as EventStatus)}>
              <option value="draft">Draft</option>
              <option value="planned">Planned</option>
              <option value="completed">Completed</option>
              <option value="canceled">Canceled</option>
            </select>
          </Field>
        ) : null}
        {mode === 'edit' ? (
          <p className="app-meta">Changing the start or zone does not move existing schedule times. Review Run of show after saving.</p>
        ) : null}
        {errors.form && rangeErrors ? <p className="app-error-text">{errors.form}</p> : null}
        <div className="app-toolbar">
          <Button type="submit" busy={busy}>
            {mode === 'new' ? 'Create event' : mode === 'duplicate' ? 'Create copy' : 'Save'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
  )
  if (layout === 'embedded') return form

  return (
    <div className="app-page app-page-narrow">
      <Link to={`/app/w/${workspaceId}/events`}>Events</Link>
      <h1 className="app-h1">{headings[mode]}</h1>
      {mode === 'new' ? <p className="app-lede">Add a title and times. Location, lead, and details can wait for Edit details.</p> : null}
      {mode === 'duplicate' ? (
        <p className="app-lede">
          The copy starts as a Draft with the original description, location, task titles and notes, and schedule shifted to
          the new start. Tasks reset to Todo and unassigned. Attendance is not copied. Edit the copy after creating it.
        </p>
      ) : null}
      {form}
    </div>
  )
}
