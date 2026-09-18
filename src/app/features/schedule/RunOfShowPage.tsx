import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ConfirmDialog, EmptyState, ErrorRetry, SkeletonRows } from '../../components/ui'
import { listSegments, listTeam, removeSegment, restoreSegment, saveSegment, saveTeamBriefing } from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type EventRecord, type SegmentRecord } from '../../data/types'
import { clearRequestKey, getRequestKey } from '../../lib/idempotency'
import { clockToMinutes, formatClock, formatDuration, minutesToClock, parseDurationInput, parseTimeInput } from '../../lib/timeInput'
import { addMs, eventLocalDate, formatInZone, resolveLocalDateTime, splitInZone, timeZoneLabel } from '../../lib/timezone'

type MemberOption = { id: string; displayName: string }

/** What a person types into a schedule row. Start and length stay as typed until blur. */
type Draft = {
  day: string
  start: string
  length: string
  offset: string
  title: string
  ownerMembershipId: string
  notes: string
}

const DEFAULT_LENGTH = 30

function localMinutes(iso: string, timezone: string) {
  return clockToMinutes(splitInZone(iso, timezone).time)
}

function nextDay(date: string) {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

/** Local calendar dates the event touches, first to last. */
function eventDays(event: EventRecord) {
  const last = eventLocalDate(event.endsAt, event.timezone)
  const days = [eventLocalDate(event.startsAt, event.timezone)]
  while (days.at(-1)! < last && days.length < 31) days.push(nextDay(days.at(-1)!))
  return days
}

function dayLabel(date: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`))
}

function draftFromSegment(segment: SegmentRecord, timezone: string): Draft {
  const start = splitInZone(segment.startsAt, timezone)
  const minutes = Math.max(1, Math.round((new Date(segment.endsAt).getTime() - new Date(segment.startsAt).getTime()) / 60_000))
  return {
    day: start.date,
    start: formatClock(clockToMinutes(start.time)),
    length: formatDuration(minutes),
    offset: start.offset,
    title: segment.title,
    ownerMembershipId: segment.ownerMembershipId || '',
    notes: segment.instructions,
  }
}

/** A blank row that starts when `after` ends, or at the event start. */
function blankDraft(event: EventRecord, afterIso?: string, seed?: Partial<Draft>): Draft {
  const startIso = afterIso ?? event.startsAt
  const start = splitInZone(startIso, event.timezone)
  return {
    day: start.date,
    start: formatClock(clockToMinutes(start.time)),
    length: formatDuration(DEFAULT_LENGTH),
    offset: '',
    title: '',
    ownerMembershipId: '',
    notes: '',
    ...seed,
  }
}

function ownerLabel(segment: SegmentRecord, members: MemberOption[]) {
  if (segment.ownerFormer) return 'Former member'
  return members.find((member) => member.id === segment.ownerMembershipId)?.displayName || segment.ownerName || null
}

function eventDateLabel(event: EventRecord) {
  const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: undefined, minute: undefined } as const
  const start = formatInZone(event.startsAt, event.timezone, options)
  if (eventLocalDate(event.startsAt, event.timezone) === eventLocalDate(event.endsAt, event.timezone)) return start
  return `${start} – ${formatInZone(event.endsAt, event.timezone, options)}`
}

function eventTimeLabel(event: EventRecord) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: event.timezone, hour: 'numeric', minute: '2-digit' })
  return `${formatter.format(new Date(event.startsAt))}–${formatter.format(new Date(event.endsAt))}`
}

/** "6:30 PM – 7 PM", with the date only when it is not the event's first day. */
function rowTimeLabel(segment: SegmentRecord, event: EventRecord, showDates: boolean) {
  const start = splitInZone(segment.startsAt, event.timezone)
  const end = splitInZone(segment.endsAt, event.timezone)
  const range = `${formatClock(clockToMinutes(start.time))} – ${formatClock(clockToMinutes(end.time))}`
  const dated = showDates || start.date !== eventLocalDate(event.startsAt, event.timezone)
  return { date: dated ? dayLabel(start.date) : null, range: end.date !== start.date ? `${range} next day` : range }
}

function byTime(a: SegmentRecord, b: SegmentRecord) {
  return a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt) || a.id.localeCompare(b.id)
}

export function RunOfShowPage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adder, setAdder] = useState<{ key: number; seed?: Partial<Draft>; afterIso?: string; focus: boolean }>({ key: 0, focus: false })
  const [deleting, setDeleting] = useState<SegmentRecord | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const manage = canManageEvents(workspace.role) && !event.archivedAt
  const segments = useQuery({
    queryKey: ['segments', workspace.id, event.id],
    queryFn: () => listSegments(workspace.id, event.id, manage),
    refetchOnWindowFocus: true,
  })
  const team = useQuery({ queryKey: ['team', workspace.id], queryFn: () => listTeam(workspace.id) })
  const visible = (segments.data ?? []).filter((segment) => !segment.removedAt).sort(byTime)
  const removed = (segments.data ?? []).filter((segment) => segment.removedAt)
  const members = (team.data?.members ?? []).filter((member) => !member.removedAt)
  const days = eventDays(event)
  const multiDay = days.length > 1
  const last = visible.at(-1)

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ['segments'] })
  }

  async function deleteItem() {
    if (!deleting) return
    setDeleteBusy(true)
    setActionError(null)
    try {
      await removeSegment(workspace.id, deleting.id, deleting.version)
      setToast(`Removed “${deleting.title}”. You can restore it below the schedule.`)
      setDeleting(null)
    } catch (caught) {
      setActionError(toAppError(caught).message)
    } finally {
      setDeleteBusy(false)
      await refresh()
    }
  }

  function duplicate(segment: SegmentRecord) {
    const draft = draftFromSegment(segment, event.timezone)
    setToast(null)
    setAdder((current) => ({
      key: current.key + 1,
      afterIso: segment.endsAt,
      seed: { title: segment.title, length: draft.length, ownerMembershipId: draft.ownerMembershipId, notes: draft.notes },
      focus: true,
    }))
  }

  async function added(saved: SegmentRecord) {
    setToast(`Added “${saved.title}”.`)
    setAdder((current) => ({ key: current.key + 1, afterIso: saved.endsAt, focus: true }))
    await refresh()
  }

  return (
    <article className="ros-document">
      <div className="ros-toolbar ros-no-print">
        <Button variant="secondary" onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>
      <header className="ros-document-header ros-print-only">
        <div>
          <p className="ros-kicker">Run of show</p>
          <p className="ros-title">{event.title}</p>
        </div>
        <dl className="ros-event-facts">
          <div><dt>Date</dt><dd>{eventDateLabel(event)} · {eventTimeLabel(event)}</dd></div>
          <div><dt>Venue</dt><dd>{event.location || 'Venue not set'}</dd></div>
          <div><dt>Timezone</dt><dd>{event.timezone} · {timeZoneLabel(event.timezone, event.startsAt).split(' · ').at(-1)}</dd></div>
        </dl>
      </header>

      <TeamBriefing workspace={workspace} event={event} manage={manage} />

      {toast ? <p className="app-banner ros-no-print" role="status">{toast}</p> : null}
      {actionError ? <ErrorRetry message={actionError} onRetry={() => refresh()} /> : null}
      {segments.isLoading ? <SkeletonRows count={5} /> : null}
      {segments.isError ? <ErrorRetry message={toAppError(segments.error).message} onRetry={() => segments.refetch()} /> : null}

      {segments.data && visible.length === 0 && !manage ? <EmptyState title="The schedule hasn’t been added yet." /> : null}
      {segments.data && visible.length === 0 && manage ? (
        <p className="ros-empty-copy ros-no-print">Build the schedule for event day. Include setup, program, and cleanup.</p>
      ) : null}

      {segments.data && (visible.length > 0 || manage) ? (
        <div className="ros-table-wrap">
          <table className="ros-schedule-table">
            <colgroup><col className="ros-col-time" /><col className="ros-col-activity" /><col className="ros-col-owner" /><col className="ros-col-notes" />{manage ? <col className="ros-col-actions" /> : null}</colgroup>
            <thead><tr><th>Time</th><th>Activity</th><th>Owner</th><th>Notes / cues</th>{manage ? <th className="ros-actions-heading"><span className="sr-only">Actions</span></th> : null}</tr></thead>
            <tbody>
              {visible.map((segment, index) => editingId === segment.id ? (
                <EditorRow key={segment.id} mode="edit" event={event} workspace={workspace} members={members} days={days}
                  segment={segment} initial={draftFromSegment(segment, event.timezone)} siblings={visible} focus
                  onCancel={() => setEditingId(null)}
                  onSaved={async () => { setEditingId(null); setToast('Changes saved.'); await refresh() }} />
              ) : (
                <ReadRow key={segment.id} segment={segment} event={event} members={members} manage={manage} showDates={multiDay}
                  gapMinutes={index > 0 ? Math.round((new Date(segment.startsAt).getTime() - new Date(visible[index - 1].endsAt).getTime()) / 60_000) : 0}
                  onEdit={() => { setToast(null); setEditingId(segment.id) }}
                  onDuplicate={() => duplicate(segment)} onDelete={() => setDeleting(segment)} />
              ))}
              {manage ? (
                <EditorRow key={`add-${adder.key}`} mode="add" event={event} workspace={workspace} members={members} days={days}
                  initial={blankDraft(event, adder.afterIso ?? last?.endsAt, adder.seed)} siblings={visible} focus={adder.focus}
                  onCancel={() => setAdder((current) => ({ key: current.key + 1, focus: false }))} onSaved={added} />
              ) : null}
            </tbody>
          </table>
          {manage ? <p className="ros-add-hint ros-no-print">Type a start like <kbd>6:30p</kbd> and a length like <kbd>45m</kbd>, then press Enter.</p> : null}
        </div>
      ) : null}

      {manage && removed.length > 0 ? (
        <details className="ros-removed ros-no-print">
          <summary>Removed items ({removed.length})</summary>
          {removed.map((segment) => <div key={segment.id} className="ros-removed-row"><span>{segment.title}</span>
            <Button variant="secondary" onClick={async () => {
              setActionError(null)
              try { await restoreSegment(workspace.id, segment.id, segment.version); setToast(`Restored “${segment.title}”.`) }
              catch (caught) { setActionError(toAppError(caught).message) }
              finally { await refresh() }
            }}>Restore</Button></div>)}
        </details>
      ) : null}

      {deleting ? <ConfirmDialog title={`Remove “${deleting.title}”?`} body="It will leave the schedule, but you can restore it from Removed items."
        actionLabel="Remove item" danger pending={deleteBusy} onCancel={() => setDeleting(null)} onConfirm={deleteItem} /> : null}
    </article>
  )
}

function ReadRow({ segment, event, members, manage, showDates, gapMinutes, onEdit, onDuplicate, onDelete }: {
  segment: SegmentRecord
  event: EventRecord
  members: MemberOption[]
  manage: boolean
  showDates: boolean
  gapMinutes: number
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const time = rowTimeLabel(segment, event, showDates)
  const owner = ownerLabel(segment, members)
  function pick(action: () => void) {
    menu.current?.removeAttribute('open')
    action()
  }
  return <tr>
    <td data-label="Time">
      {time.date ? <span className="ros-row-date">{time.date}</span> : null}
      <span className="ros-readable-time">{time.range}</span>
      {gapMinutes > 0 ? <span className="ros-timing-note">{formatDuration(gapMinutes)} gap before</span> : null}
      {segment.outOfRange ? <span className="ros-timing-note">Outside event hours</span> : null}
    </td>
    <td data-label="Activity">
      {manage
        ? <button type="button" className="ros-row-title" onClick={onEdit}><span className="sr-only">Edit </span>{segment.title}</button>
        : <strong className="ros-readable-activity">{segment.title}</strong>}
    </td>
    <td data-label="Owner"><span className={owner ? undefined : 'ros-unassigned'}>{owner ?? 'Everyone'}</span></td>
    <td data-label="Notes / cues">
      {segment.instructions ? <span className="ros-readable-notes">{segment.instructions}</span> : <span className="ros-unassigned">—</span>}
      {segment.overlaps ? <span className="ros-timing-note">Overlaps another item</span> : null}
    </td>
    {manage ? <td className="ros-actions-cell ros-no-print">
      <details ref={menu} className="ros-row-menu"><summary aria-label={`Actions for ${segment.title}`}>•••</summary><div>
        <button onClick={() => pick(onEdit)}>Edit</button>
        <button onClick={() => pick(onDuplicate)}>Duplicate</button>
        <button className="ros-danger-action" onClick={() => pick(onDelete)}>Remove</button>
      </div></details>
    </td> : null}
  </tr>
}

function EditorRow({ mode, event, workspace, members, days, segment, initial, siblings, focus, onCancel, onSaved }: {
  mode: 'add' | 'edit'
  event: EventRecord
  workspace: WorkspaceSummary
  members: MemberOption[]
  days: string[]
  segment?: SegmentRecord
  initial: Draft
  siblings: SegmentRecord[]
  focus: boolean
  onCancel: () => void
  onSaved: (saved: SegmentRecord) => void | Promise<void>
}) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const label = mode === 'add' ? 'new item' : segment!.title
  // A bare "6" means whichever of 6 AM or 6 PM is nearer the row's starting point.
  const [reference] = useState(() => parseTimeInput(initial.start) ?? localMinutes(event.startsAt, event.timezone))
  const [baseline] = useState(initial)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)

  useLayoutEffect(() => {
    if (focus) titleRef.current?.focus()
  }, [focus])

  const startMinutes = parseTimeInput(draft.start, reference)
  const lengthMinutes = parseDurationInput(draft.length)
  const resolution = startMinutes === null ? null : resolveLocalDateTime(draft.day, minutesToClock(startMinutes), event.timezone, draft.offset || undefined)
  const startIso = resolution?.ok ? resolution.iso : null
  const endIso = startIso && lengthMinutes ? addMs(startIso, lengthMinutes * 60_000) : null
  const endsNextDay = endIso ? splitInZone(endIso, event.timezone).date !== draft.day : false
  // An untouched add row is a suggestion, not a plan; warn only once someone starts typing.
  const warn = mode === 'edit' || dirty
  const overlap = warn && startIso && endIso && siblings.some((item) => item.id !== segment?.id && item.startsAt < endIso && item.endsAt > startIso)
  const outside = warn && startIso && endIso && (startIso < event.startsAt || endIso > event.endsAt)
  const dayOptions = days.includes(draft.day) ? days : [...days, draft.day].sort()

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setError(null)
  }

  function validate() {
    if (!draft.title.trim()) return 'Enter an activity.'
    if (startMinutes === null) return 'Enter a start time like 6:30 PM.'
    if (resolution && !resolution.ok) {
      return resolution.reason === 'ambiguous' ? `Choose which ${formatClock(startMinutes)} you mean.` : 'That time is skipped on this date by daylight saving time.'
    }
    if (lengthMinutes === null) return 'Enter a length like 30 min or 1 hr.'
    return null
  }

  async function save() {
    const problem = validate()
    if (problem || !startIso || !endIso) { setError(problem); return }
    setBusy(true)
    setError(null)
    try {
      const requestKey = `save_segment:${event.id}:${segment?.id ?? 'new'}`
      const saved = await saveSegment({ workspaceId: workspace.id, eventId: event.id, segmentId: segment?.id ?? null,
        title: draft.title.trim(), startsAt: startIso, endsAt: endIso, ownerMembershipId: draft.ownerMembershipId || null,
        instructions: draft.notes, ackWarnings: true, expectedVersion: segment?.version ?? 1, requestKey: getRequestKey(requestKey) })
      clearRequestKey(requestKey)
      await onSaved(saved)
    } catch (caught) {
      setError(toAppError(caught).message)
      setBusy(false)
    }
  }

  function cancel() {
    if (mode === 'add' && !dirty) return
    onCancel()
  }

  function onKeyDown(keyEvent: KeyboardEvent<HTMLTableRowElement>) {
    const target = keyEvent.target as HTMLElement
    if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); cancel(); return }
    if (keyEvent.key !== 'Enter' || target instanceof HTMLButtonElement) return
    if (target instanceof HTMLTextAreaElement && !(keyEvent.metaKey || keyEvent.ctrlKey)) return
    keyEvent.preventDefault()
    void save()
  }

  return <>
    <tr className={`ros-editor-row ros-no-print${mode === 'add' ? ' ros-add-row' : ''}`} onKeyDown={onKeyDown}>
      <td data-label="Time">
        <div className="ros-when">
          {dayOptions.length > 1 ? (
            <select className="ros-when-day" aria-label={`Day for ${label}`} value={draft.day} disabled={busy} onChange={(change) => update({ day: change.target.value, offset: '' })}>
              {dayOptions.map((day) => <option key={day} value={day}>{dayLabel(day)}</option>)}
            </select>
          ) : null}
          <input className="ros-when-start" aria-label={`Start for ${label}`} value={draft.start} placeholder="6:30 PM" disabled={busy} autoComplete="off"
            onChange={(change) => update({ start: change.target.value, offset: '' })}
            onBlur={() => { if (startMinutes !== null) update({ start: formatClock(startMinutes) }) }} />
          <input className="ros-when-length" aria-label={`Length for ${label}`} value={draft.length} placeholder="30 min" disabled={busy} autoComplete="off"
            onChange={(change) => update({ length: change.target.value })}
            onBlur={() => { if (lengthMinutes !== null) update({ length: formatDuration(lengthMinutes) }) }} />
          {resolution && !resolution.ok && resolution.reason === 'ambiguous' ? (
            <select aria-label={`Which ${formatClock(startMinutes!)}`} value={draft.offset} onChange={(change) => update({ offset: change.target.value })}>
              <option value="">Which one?</option>
              {resolution.options.map((option, index) => <option key={option.iso} value={option.offset}>{index === 0 ? 'First' : 'Second'} (UTC{option.offset})</option>)}
            </select>
          ) : null}
        </div>
        <span className="ros-when-end" aria-live="polite">
          {endIso ? `Ends ${formatClock(localMinutes(endIso, event.timezone))}${endsNextDay ? ' next day' : ''}` : ' '}
        </span>
      </td>
      <td data-label="Activity">
        <input ref={titleRef} className="ros-cell-input" aria-label={`Activity for ${label}`} value={draft.title} maxLength={120}
          placeholder={mode === 'add' ? 'Add an activity' : 'Activity'} disabled={busy} autoComplete="off"
          onChange={(change) => update({ title: change.target.value })} />
      </td>
      <td data-label="Owner">
        <select className={`ros-cell-select${draft.ownerMembershipId ? '' : ' ros-unassigned'}`} aria-label={`Owner for ${label}`}
          value={draft.ownerMembershipId} disabled={busy} onChange={(change) => update({ ownerMembershipId: change.target.value })}>
          <option value="">Everyone</option>
          {segment?.ownerFormer && draft.ownerMembershipId === segment.ownerMembershipId ? <option value={draft.ownerMembershipId}>Former member</option> : null}
          {members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
        </select>
      </td>
      <td data-label="Notes / cues">
        <AutoTextarea className="ros-cell-textarea" aria-label={`Notes for ${label}`} value={draft.notes} maxLength={4000}
          placeholder="Notes and cues" disabled={busy} onChange={(change) => update({ notes: change.target.value })} />
      </td>
      <td className="ros-actions-cell">
        <div className="ros-editor-actions">
          <Button busy={busy} busyLabel="Saving…" onClick={save}>{mode === 'add' ? 'Add' : 'Save'}</Button>
          {mode === 'edit' || dirty ? <Button variant="quiet" disabled={busy} onClick={onCancel}>{mode === 'add' ? 'Clear' : 'Cancel'}</Button> : null}
        </div>
      </td>
    </tr>
    {error || overlap || outside ? <tr className="ros-feedback-row ros-no-print"><td className="ros-row-feedback" colSpan={5}>
      {error ? <p className="app-error-text" role="alert">{error}</p> : null}
      {!error && overlap ? <span className="ros-timing-note">Overlaps another item. You can still save it.</span> : null}
      {!error && outside ? <span className="ros-timing-note">Outside event hours. Fine for setup and cleanup.</span> : null}
    </td></tr> : null}
  </>
}

function TeamBriefing({ workspace, event, manage }: { workspace: WorkspaceSummary; event: EventRecord; manage: boolean }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(event.teamBriefing || '')
  const [savedValue, setSavedValue] = useState(event.teamBriefing || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = value !== savedValue

  async function save() {
    setBusy(true); setError(null)
    try {
      const result = await saveTeamBriefing(workspace.id, event.id, value, event.version)
      setSavedValue(result.teamBriefing); setValue(result.teamBriefing)
      await queryClient.invalidateQueries({ queryKey: ['event', workspace.id, event.id] })
    } catch (caught) { setError(toAppError(caught).message) }
    finally { setBusy(false) }
  }

  return <section className="ros-briefing" aria-labelledby="team-briefing-title">
    <div className="ros-section-heading">
      <div><h2 id="team-briefing-title">Team briefing</h2><p>Arrival instructions, meeting points, and event-wide notes.</p></div>
      {manage && dirty ? <div className="ros-inline-actions ros-no-print"><span>Unsaved changes</span><Button variant="quiet" onClick={() => { setValue(savedValue); setError(null) }}>Cancel</Button><Button busy={busy} busyLabel="Saving…" onClick={save}>Save briefing</Button></div> : null}
    </div>
    {manage ? <AutoTextarea className="ros-briefing-input ros-screen-field" value={value} maxLength={4000}
      placeholder="Where should the team meet? What should everyone know before doors open?" aria-label="Team briefing"
      disabled={busy} onChange={(event) => setValue(event.target.value)} />
      : value ? <p className="ros-readable-notes">{value}</p> : <p className="ros-empty-copy">No team briefing added.</p>}
    <p className="ros-print-value ros-readable-notes">{value || 'No team briefing added.'}</p>
    {error ? <p className="app-error-text ros-no-print" role="alert">{error} <button className="ros-retry-link" onClick={save}>Retry</button></p> : null}
  </section>
}

function AutoTextarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    function resize() {
      if (!ref.current) return
      ref.current.style.height = 'auto'
      ref.current.style.height = `${Math.max(40, ref.current.scrollHeight)}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [props.value])
  return <textarea ref={ref} rows={1} className={className} {...props} />
}
