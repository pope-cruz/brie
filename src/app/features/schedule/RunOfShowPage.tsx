import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/shadcn/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/shadcn/sheet'
import { Button, ConfirmDialog, EmptyState, ErrorRetry, SkeletonRows } from '../../components/ui'
import { listSegments, listTeam, pasteSchedule, removeSegment, restoreSegment, saveSegment, saveTeamBriefing } from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type EventRecord, type SegmentRecord } from '../../data/types'
import { clearRequestKey, getRequestKey } from '../../lib/idempotency'
import { buildRunOfShowDoc, downloadRunOfShowPdf, pdfFileName } from '../../lib/runOfShowPdf'
import { byTime, dayLabel, filterSchedule, peopleLabel, readStoredWho, resolveWho, rowTimeLabel, scheduleMarks, storeWho, type Who } from '../../lib/scheduleView'
import { clockToMinutes, formatClock, formatDuration, minutesToClock, parseDurationInput, parseTimeInput } from '../../lib/timeInput'
import { addMs, eventLocalDate, resolveLocalDateTime, splitInZone } from '../../lib/timezone'
import { layoutCalendar } from '../../lib/calendarLayout'
import { parseSchedulePaste } from '../../lib/schedulePaste'
import { useNarrow } from '../../lib/useNarrow'
import { CalendarView, type EmptySlot } from './CalendarView'

type MemberOption = { id: string; displayName: string }

/** What a person types into a schedule row. Start and length stay as typed until blur. */
type Draft = {
  day: string
  start: string
  length: string
  offset: string
  title: string
  personIds: string[]
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


function draftFromSegment(segment: SegmentRecord, timezone: string): Draft {
  const start = splitInZone(segment.startsAt, timezone)
  const minutes = Math.max(1, Math.round((new Date(segment.endsAt).getTime() - new Date(segment.startsAt).getTime()) / 60_000))
  return {
    day: start.date,
    start: formatClock(clockToMinutes(start.time)),
    length: formatDuration(minutes),
    offset: start.offset,
    title: segment.title,
    personIds: segment.people.map((person) => person.id),
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
    personIds: [],
    notes: '',
    ...seed,
  }
}






/** The wall clock, advanced every 30 seconds so Now and Next move on their own. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function RunOfShowPage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const now = useNow()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adder, setAdder] = useState<{ key: number; seed?: Partial<Draft>; afterIso?: string; focus: boolean }>({ key: 0, focus: false })
  const [deleting, setDeleting] = useState<SegmentRecord | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [panel, setPanel] = useState<{ key: number; segment?: SegmentRecord; initial?: Draft } | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const narrow = useNarrow()
  const manage = canManageEvents(workspace.role) && !event.archivedAt
  const segments = useQuery({
    queryKey: ['segments', workspace.id, event.id],
    queryFn: () => listSegments(workspace.id, event.id, manage),
    refetchOnWindowFocus: true,
  })
  const team = useQuery({ queryKey: ['team', workspace.id], queryFn: () => listTeam(workspace.id) })
  const all = (segments.data ?? []).filter((segment) => !segment.removedAt).sort(byTime)
  const removed = (segments.data ?? []).filter((segment) => segment.removedAt)
  const members = (team.data?.members ?? []).filter((member) => !member.removedAt)
  const people = members.filter((member) => member.id !== workspace.membershipId)
  const who = resolveWho(new URLSearchParams(location.search).get('who'), readStoredWho(workspace.id), workspace.role, people.map((member) => member.id))
  const visible = filterSchedule(all, who, workspace.membershipId)
  const marks = scheduleMarks(visible, event, now)
  const whoName = who === 'everyone' ? null : who === 'mine' ? 'you' : members.find((member) => member.id === who)?.displayName ?? null
  const days = eventDays(event)
  const multiDay = days.length > 1
  const last = visible.at(-1)
  const search = new URLSearchParams(location.search)
  // The calendar is for desktop and tablet; phones always get the list.
  const calendar = !narrow && search.get('view') === 'calendar'
  const byPerson = search.get('cols') === 'people'

  function setParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(location.search)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    const next = params.toString()
    // Keep the section hash so the page stays on Day of.
    navigate({ search: next ? `?${next}` : '', hash: location.hash }, { replace: true, preventScrollReset: true })
  }

  function chooseWho(next: Who) {
    storeWho(workspace.id, next)
    setParams({ who: next })
  }

  function openNewAt(slot: EmptySlot) {
    const day = slot.minute >= 24 * 60 ? nextDay(slot.day) : slot.day
    setToast(null)
    setPanel((current) => ({
      key: (current?.key ?? 0) + 1,
      initial: blankDraft(event, undefined, { day, start: formatClock(slot.minute % (24 * 60)), personIds: slot.personId ? [slot.personId] : [] }),
    }))
  }

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
      seed: { title: segment.title, length: draft.length, personIds: draft.personIds, notes: draft.notes },
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
      <div className="ros-toolbar">
        <label className="ros-who">
          <span aria-hidden="true">Show</span>
          <select className="app-select" aria-label="Show schedule for" value={who} onChange={(change) => chooseWho(change.target.value)}>
            <option value="everyone">Everyone</option>
            <option value="mine">Mine</option>
            {people.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
          </select>
        </label>
        {!narrow ? (
          <div className="ros-view" role="group" aria-label="View">
            <button type="button" aria-pressed={!calendar} onClick={() => setParams({ view: null })}>List</button>
            <button type="button" aria-pressed={calendar} onClick={() => setParams({ view: 'calendar' })}>Calendar</button>
          </div>
        ) : null}
        {calendar ? (
          <label className="ros-by-person">
            <input type="checkbox" checked={byPerson} onChange={(change) => setParams({ cols: change.target.checked ? 'people' : null })} />
            Column per person
          </label>
        ) : null}
        <DownloadPdf workspace={workspace} event={event} all={all} members={members} current={who} showDates={multiDay} />
        {manage ? <Button variant="secondary" onClick={() => setPasteOpen(true)}>Paste rows</Button> : null}
      </div>

      <TeamBriefing workspace={workspace} event={event} manage={manage} />

      {toast ? <p className="app-banner" role="status">{toast}</p> : null}
      {actionError ? <ErrorRetry message={actionError} onRetry={() => refresh()} /> : null}
      {segments.isLoading ? <SkeletonRows count={5} /> : null}
      {segments.isError ? <ErrorRetry message={toAppError(segments.error).message} onRetry={() => segments.refetch()} /> : null}

      {segments.data && all.length === 0 && !manage ? <EmptyState title="The schedule hasn’t been added yet." /> : null}
      {segments.data && all.length > 0 && visible.length === 0 ? (
        <EmptyState title={`Nothing on the schedule for ${whoName ?? 'this person'}`}
          action={<Button variant="secondary" onClick={() => chooseWho('everyone')}>Show everyone</Button>} />
      ) : null}
      {segments.data && all.length === 0 && manage ? (
        <p className="ros-empty-copy">Build the schedule for event day. Include setup, program, and cleanup.</p>
      ) : null}

      {segments.data && calendar && (visible.length > 0 || manage) ? (
        <div className="ros-calendar-wrap">
          {manage ? (
            <div className="ros-calendar-actions">
              <Button variant="secondary" onClick={() => openNewAt({ day: last ? splitInZone(last.endsAt, event.timezone).date : days[0], minute: localMinutes(last?.endsAt ?? event.startsAt, event.timezone), personId: null })}>Add item</Button>
              <span className="app-meta">Or click empty time in the grid.</span>
            </div>
          ) : null}
          <CalendarView
            layout={layoutCalendar(visible, { timezone: event.timezone, days, byPerson, people: members })}
            showDayHeads={multiDay} marks={marks} ownerName={(segment) => peopleLabel(segment, members)}
            onOpen={(segment) => { setToast(null); setPanel((current) => ({ key: (current?.key ?? 0) + 1, segment })) }}
            onAddAt={manage ? openNewAt : undefined} />
        </div>
      ) : null}

      {segments.data && !calendar && (visible.length > 0 || manage) ? (
        <div className="ros-table-wrap">
          <table className="ros-schedule-table">
            <colgroup><col className="ros-col-time" /><col className="ros-col-activity" /><col className="ros-col-owner" /><col className="ros-col-notes" />{manage ? <col className="ros-col-actions" /> : null}</colgroup>
            <thead><tr><th>Time</th><th>Activity</th><th>People</th><th>Notes / cues</th>{manage ? <th className="ros-actions-heading"><span className="sr-only">Actions</span></th> : null}</tr></thead>
            <tbody>
              {visible.map((segment, index) => editingId === segment.id ? (
                <EditorRow key={segment.id} mode="edit" event={event} workspace={workspace} members={members} days={days}
                  segment={segment} initial={draftFromSegment(segment, event.timezone)} siblings={visible} focus
                  onCancel={() => setEditingId(null)}
                  onSaved={async () => { setEditingId(null); setToast('Changes saved.'); await refresh() }} />
              ) : (
                <ReadRow key={segment.id} segment={segment} event={event} members={members} manage={manage} showDates={multiDay} mark={marks.get(segment.id)}
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
          {manage ? <p className="ros-add-hint">Type a start like <kbd>6:30p</kbd> and a length like <kbd>45m</kbd>, then press Enter.</p> : null}
        </div>
      ) : null}

      {manage && removed.length > 0 ? (
        <details className="ros-removed">
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

      {panel ? (
        <ItemPanel key={panel.key} event={event} workspace={workspace} members={members} days={days} manage={manage}
          segment={panel.segment} initial={panel.initial ?? (panel.segment ? draftFromSegment(panel.segment, event.timezone) : blankDraft(event))}
          siblings={all} onClose={() => setPanel(null)}
          onSaved={async (saved) => { setPanel(null); setToast(panel.segment ? 'Changes saved.' : `Added “${saved.title}”.`); await refresh() }}
          onRemove={(segment) => { setPanel(null); setDeleting(segment) }} />
      ) : null}

      {pasteOpen ? <PasteSchedule event={event} workspace={workspace} members={members} existing={all}
        onClose={() => setPasteOpen(false)} onSaved={async (count) => { setPasteOpen(false); setToast(`Added ${count} schedule items.`); await refresh() }} /> : null}

      {deleting ? <ConfirmDialog title={`Remove “${deleting.title}”?`} body="It will leave the schedule, but you can restore it from Removed items."
        actionLabel="Remove item" danger pending={deleteBusy} onCancel={() => setDeleting(null)} onConfirm={deleteItem} /> : null}
    </article>
  )
}

function ReadRow({ segment, event, members, manage, showDates, mark, gapMinutes, onEdit, onDuplicate, onDelete }: {
  segment: SegmentRecord
  mark?: 'now' | 'next'
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
  const owner = peopleLabel(segment, members)
  function pick(action: () => void) {
    menu.current?.removeAttribute('open')
    action()
  }
  return <tr className={mark === 'now' ? 'ros-row-now' : undefined}>
    <td data-label="Time">
      {mark ? <span className={`ros-mark ros-mark-${mark}`}>{mark === 'now' ? 'Now' : 'Next'}</span> : null}
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
    <td data-label="People"><span className={owner ? undefined : 'ros-unassigned'}>{owner ?? 'Everyone'}</span></td>
    <td data-label="Notes / cues">
      {segment.instructions ? <span className="ros-readable-notes">{segment.instructions}</span> : <span className="ros-unassigned">—</span>}
      {segment.overlaps ? <span className="ros-timing-note">Overlaps another item</span> : null}
    </td>
    {manage ? <td className="ros-actions-cell">
      <details ref={menu} className="ros-row-menu"><summary aria-label={`Actions for ${segment.title}`}>•••</summary><div>
        <button onClick={() => pick(onEdit)}>Edit</button>
        <button onClick={() => pick(onDuplicate)}>Duplicate</button>
        <button className="ros-danger-action" onClick={() => pick(onDelete)}>Remove</button>
      </div></details>
    </td> : null}
  </tr>
}

type EditorInput = {
  mode: 'add' | 'edit'
  event: EventRecord
  workspace: WorkspaceSummary
  days: string[]
  segment?: SegmentRecord
  initial: Draft
  siblings: SegmentRecord[]
  onSaved: (saved: SegmentRecord) => void | Promise<void>
}

/** Typed start, length, and fields for one schedule item; shared by the list row and the item panel. */
function useSegmentEditor({ mode, event, workspace, days, segment, initial, siblings, onSaved }: EditorInput) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shiftLater, setShiftLater] = useState(false)
  const label = mode === 'add' ? 'new item' : segment!.title
  // A bare "6" means whichever of 6 AM or 6 PM is nearer the row's starting point.
  const [reference] = useState(() => parseTimeInput(initial.start) ?? localMinutes(event.startsAt, event.timezone))
  const [baseline] = useState(initial)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)

  const startMinutes = parseTimeInput(draft.start, reference)
  const lengthMinutes = parseDurationInput(draft.length)
  const resolution = startMinutes === null ? null : resolveLocalDateTime(draft.day, minutesToClock(startMinutes), event.timezone, draft.offset || undefined)
  const startIso = resolution?.ok ? resolution.iso : null
  const endIso = startIso && lengthMinutes ? addMs(startIso, lengthMinutes * 60_000) : null
  const timeChanged = Boolean(segment && startIso && endIso &&
    (Date.parse(startIso) !== Date.parse(segment.startsAt) || Date.parse(endIso) !== Date.parse(segment.endsAt)))
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
        title: draft.title.trim(), startsAt: startIso, endsAt: endIso, personIds: draft.personIds,
        instructions: draft.notes, ackWarnings: true, expectedVersion: segment?.version ?? 1,
        shiftLater: timeChanged && shiftLater, requestKey: getRequestKey(requestKey) })
      clearRequestKey(requestKey)
      await onSaved(saved)
    } catch (caught) {
      setError(toAppError(caught).message)
      setBusy(false)
    }
  }

  return { draft, update, busy, error, dirty, label, startMinutes, lengthMinutes, resolution, endIso, endsNextDay, overlap, outside, dayOptions, timeChanged, shiftLater, setShiftLater, save }
}

function EditorRow({ mode, event, workspace, members, days, segment, initial, siblings, focus, onCancel, onSaved }: EditorInput & {
  members: MemberOption[]
  focus: boolean
  onCancel: () => void
}) {
  const editor = useSegmentEditor({ mode, event, workspace, days, segment, initial, siblings, onSaved })
  const { draft, update, busy, error, dirty, label, startMinutes, lengthMinutes, resolution, endIso, endsNextDay, overlap, outside, dayOptions, timeChanged, shiftLater, setShiftLater, save } = editor
  const titleRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (focus) titleRef.current?.focus()
  }, [focus])

  function cancel() {
    if (mode === 'add' && !dirty) return
    onCancel()
  }

  function onKeyDown(keyEvent: KeyboardEvent<HTMLTableRowElement>) {
    const target = keyEvent.target as HTMLElement
    if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); cancel(); return }
    if (keyEvent.key !== 'Enter' || target instanceof HTMLButtonElement || target instanceof HTMLSelectElement
      || target.closest('summary') || (target instanceof HTMLInputElement && target.type === 'checkbox')) return
    if (target instanceof HTMLTextAreaElement && !(keyEvent.metaKey || keyEvent.ctrlKey)) return
    keyEvent.preventDefault()
    void save()
  }

  return <>
    <tr className={`ros-editor-row${mode === 'add' ? ' ros-add-row' : ''}`} onKeyDown={onKeyDown}>
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
      <td data-label="People"><PeoplePicker label={`People for ${label}`} selected={draft.personIds}
        members={members} former={segment?.people.filter((person) => person.former) ?? []} disabled={busy}
        onChange={(personIds) => update({ personIds })} /></td>
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
    {error || overlap || outside || timeChanged ? <tr className="ros-feedback-row"><td className="ros-row-feedback" colSpan={5}>
      {timeChanged ? <label><input type="checkbox" checked={shiftLater} disabled={busy} onChange={(change) => setShiftLater(change.target.checked)} /> Also shift later items</label> : null}
      {error ? <p className="app-error-text" role="alert">{error}</p> : null}
      {!error && overlap ? <span className="ros-timing-note">Overlaps another item. You can still save it.</span> : null}
      {!error && outside ? <span className="ros-timing-note">Outside event hours. Fine for setup and cleanup.</span> : null}
    </td></tr> : null}
  </>
}

/** Download PDF: Everyone or one person (default: the current filter), built in the browser. */
function DownloadPdf({ workspace, event, all, members, current, showDates }: {
  workspace: WorkspaceSummary
  event: EventRecord
  all: SegmentRecord[]
  members: MemberOption[]
  current: Who
  showDates: boolean
}) {
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<Who>(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const myName = members.find((member) => member.id === workspace.membershipId)?.displayName || workspace.displayName || 'you'
  const people = members.filter((member) => member.id !== workspace.membershipId)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const whoLabel = choice === 'everyone' ? 'Everyone' : choice === 'mine' ? `Mine: ${myName}` : people.find((member) => member.id === choice)?.displayName ?? 'Person'
      const doc = buildRunOfShowDoc({
        event, items: filterSchedule(all, choice, workspace.membershipId), members, whoLabel, showDates, generatedAt: new Date(),
      })
      await downloadRunOfShowPdf(doc, pdfFileName(event.title, whoLabel))
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? `Couldn’t make the PDF: ${caught.message}` : 'Couldn’t make the PDF. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => { if (next) { setChoice(current); setError(null) } setOpen(next) }}>
      <PopoverTrigger asChild><Button variant="secondary">Download PDF</Button></PopoverTrigger>
      <PopoverContent align="end" className="ros-pdf-popover">
        <label className="ros-pdf-field">
          <span>Download for</span>
          <select className="app-select" value={choice} disabled={busy} onChange={(change) => setChoice(change.target.value)}>
            <option value="everyone">Everyone</option>
            <option value="mine">Mine ({myName})</option>
            {people.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
          </select>
        </label>
        <p className="app-meta">Made on this device. Nothing is uploaded.</p>
        {error ? <p className="app-error-text" role="alert">{error}</p> : null}
        <Button busy={busy} busyLabel="Making PDF…" onClick={download}>Download</Button>
      </PopoverContent>
    </Popover>
  )
}

/** One schedule item from the calendar: its editor for organizers, its full text for everyone else. */
function ItemPanel({ event, workspace, members, days, manage, segment, initial, siblings, onClose, onSaved, onRemove }: {
  event: EventRecord
  workspace: WorkspaceSummary
  members: MemberOption[]
  days: string[]
  manage: boolean
  segment?: SegmentRecord
  initial: Draft
  siblings: SegmentRecord[]
  onClose: () => void
  onSaved: (saved: SegmentRecord) => void | Promise<void>
  onRemove: (segment: SegmentRecord) => void
}) {
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="app-task-sheet ros-item-panel" showCloseButton={false}>
        {manage
          ? <ItemEditor event={event} workspace={workspace} members={members} days={days} segment={segment} initial={initial} siblings={siblings} onClose={onClose} onSaved={onSaved} onRemove={onRemove} />
          : segment ? <ItemReader event={event} segment={segment} members={members} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function ItemReader({ event, segment, members, onClose }: { event: EventRecord; segment: SegmentRecord; members: MemberOption[]; onClose: () => void }) {
  const time = rowTimeLabel(segment, event, true)
  return <>
    <SheetHeader>
      <div className="app-header-row"><SheetTitle>{segment.title}</SheetTitle><Button variant="quiet" onClick={onClose}>Close</Button></div>
      <SheetDescription>{time.date} · {time.range}</SheetDescription>
    </SheetHeader>
    <div className="app-panel-body">
      <p className="app-meta">{peopleLabel(segment, members) ?? 'Everyone'}</p>
      <p className="ros-readable-notes">{segment.instructions || 'No notes.'}</p>
    </div>
  </>
}

function ItemEditor({ event, workspace, members, days, segment, initial, siblings, onClose, onSaved, onRemove }: Omit<EditorInput, 'mode'> & {
  members: MemberOption[]
  onClose: () => void
  onRemove: (segment: SegmentRecord) => void
}) {
  const mode = segment ? 'edit' : 'add'
  const { draft, update, busy, error, dirty, label, startMinutes, resolution, endIso, endsNextDay, overlap, outside, dayOptions, timeChanged, shiftLater, setShiftLater, save } =
    useSegmentEditor({ mode, event, workspace, days, segment, initial, siblings, onSaved })
  const [discard, setDiscard] = useState(false)
  const close = () => (dirty ? setDiscard(true) : onClose())
  return <>
    <SheetHeader>
      <div className="app-header-row">
        <SheetTitle>{segment ? 'Edit item' : 'Add item'}</SheetTitle>
        <Button variant="quiet" disabled={busy} onClick={close}>Close</Button>
      </div>
      <SheetDescription>{event.title}</SheetDescription>
    </SheetHeader>
    <form className="app-panel-body ros-item-form" onSubmit={(submit) => { submit.preventDefault(); void save() }}
      onKeyDown={(key) => { if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); close() } }}>
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
          onChange={(change) => update({ length: change.target.value })} />
        {resolution && !resolution.ok && resolution.reason === 'ambiguous' ? (
          <select aria-label={`Which ${formatClock(startMinutes!)}`} value={draft.offset} onChange={(change) => update({ offset: change.target.value })}>
            <option value="">Which one?</option>
            {resolution.options.map((option, index) => <option key={option.iso} value={option.offset}>{index === 0 ? 'First' : 'Second'} (UTC{option.offset})</option>)}
          </select>
        ) : null}
      </div>
      <span className="ros-when-end" aria-live="polite">{endIso ? `Ends ${formatClock(localMinutes(endIso, event.timezone))}${endsNextDay ? ' next day' : ''}` : ' '}</span>
      <label className="app-field"><span className="app-label">Activity</span>
        <input className="app-input" aria-label={`Activity for ${label}`} value={draft.title} maxLength={120} disabled={busy} autoFocus={!segment}
          onChange={(change) => update({ title: change.target.value })} /></label>
      <PeoplePicker label={`People for ${label}`} selected={draft.personIds}
        members={members} former={segment?.people.filter((person) => person.former) ?? []} disabled={busy}
        onChange={(personIds) => update({ personIds })} />
      <label className="app-field"><span className="app-label">Notes</span>
        <textarea className="app-textarea" aria-label={`Notes for ${label}`} value={draft.notes} maxLength={4000} disabled={busy} onChange={(change) => update({ notes: change.target.value })} /></label>
      {timeChanged ? <label className="app-field"><span><input type="checkbox" checked={shiftLater} disabled={busy} onChange={(change) => setShiftLater(change.target.checked)} /> Also shift later items</span></label> : null}
      {error ? <p className="app-error-text" role="alert">{error}</p> : null}
      {!error && overlap ? <p className="ros-timing-note">Overlaps another item. You can still save it.</p> : null}
      {!error && outside ? <p className="ros-timing-note">Outside event hours. Fine for setup and cleanup.</p> : null}
      {discard ? <div role="alert" className="app-banner">
        <p>Discard your changes?</p>
        <div className="app-toolbar">
          <Button type="button" variant="secondary" onClick={() => setDiscard(false)}>Keep editing</Button>
          <Button type="button" variant="danger" onClick={onClose}>Discard</Button>
        </div>
      </div> : null}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
    <div className="app-panel-footer">
      {segment ? <Button variant="quiet" disabled={busy} onClick={() => onRemove(segment)}>Remove</Button> : null}
      <Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button>
      <Button busy={busy} busyLabel="Saving…" onClick={() => void save()}>{segment ? 'Save' : 'Add'}</Button>
    </div>
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
      {manage && dirty ? <div className="ros-inline-actions"><span>Unsaved changes</span><Button variant="quiet" onClick={() => { setValue(savedValue); setError(null) }}>Cancel</Button><Button busy={busy} busyLabel="Saving…" onClick={save}>Save briefing</Button></div> : null}
    </div>
    {manage ? <AutoTextarea className="ros-briefing-input" value={value} maxLength={4000}
      placeholder="Where should the team meet? What should everyone know before doors open?" aria-label="Team briefing"
      disabled={busy} onChange={(event) => setValue(event.target.value)} />
      : value ? <p className="ros-readable-notes">{value}</p> : <p className="ros-empty-copy">No team briefing added.</p>}
    {error ? <p className="app-error-text" role="alert">{error} <button className="ros-retry-link" onClick={save}>Retry</button></p> : null}
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

function PeoplePicker({ label, selected, members, former, disabled, onChange }: {
  label: string
  selected: string[]
  members: MemberOption[]
  former: Array<{ id: string; name: string }>
  disabled: boolean
  onChange: (ids: string[]) => void
}) {
  const options = [
    ...members.map((member) => ({ id: member.id, name: member.displayName })),
    ...former.filter((person) => !members.some((member) => member.id === person.id)).map((person) => ({ id: person.id, name: `${person.name} (former member)` })),
  ]
  const names = selected.map((id) => options.find((person) => person.id === id)?.name ?? 'Former member')
  return <details className="ros-people-picker">
    <summary aria-label={label}>{names.length ? names.join(', ') : 'Everyone'}</summary>
    <fieldset disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      {options.map((person) => <label key={person.id}>
        <input type="checkbox" checked={selected.includes(person.id)}
          onChange={(change) => onChange(change.target.checked ? [...selected, person.id] : selected.filter((id) => id !== person.id))} />
        {person.name}
      </label>)}
      {options.length === 0 ? <span className="app-meta">No teammates yet. Everyone will see this item.</span> : null}
    </fieldset>
  </details>
}

function PasteSchedule({ event, workspace, members, existing, onClose, onSaved }: {
  event: EventRecord
  workspace: WorkspaceSummary
  members: MemberOption[]
  existing: SegmentRecord[]
  onClose: () => void
  onSaved: (count: number) => void | Promise<void>
}) {
  const [text, setText] = useState('')
  const [ackWarnings, setAckWarnings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = parseSchedulePaste(text, event, members, existing)
  const invalid = preview.rows.some((row) => row.errors.length > 0)
  const warned = preview.rows.some((row) => row.warnings.length > 0)

  async function addAll() {
    if (preview.error || !preview.rows.length || invalid || (warned && !ackWarnings)) return
    setBusy(true); setError(null)
    const scope = `paste_schedule:${event.id}`
    try {
      const saved = await pasteSchedule({ workspaceId: workspace.id, eventId: event.id,
        rows: preview.rows.map((row) => ({ title: row.title, startsAt: row.startsAt!, endsAt: row.endsAt!, personIds: row.personIds, instructions: row.instructions })),
        ackWarnings, requestKey: getRequestKey(scope) })
      clearRequestKey(scope)
      await onSaved(saved.length)
    } catch (caught) { setError(toAppError(caught).message) }
    finally { setBusy(false) }
  }

  return <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <SheetContent className="app-task-sheet ros-paste-sheet" showCloseButton={false}>
      <SheetHeader>
        <div className="app-header-row"><SheetTitle>Paste schedule rows</SheetTitle><Button variant="quiet" disabled={busy} onClick={onClose}>Close</Button></div>
        <SheetDescription>Use tab or comma separated columns: time, title, people, notes. Separate several people with semicolons. Add “+ 45m” after a time for a different length; otherwise each item is 30 minutes.</SheetDescription>
      </SheetHeader>
      <div className="app-panel-body">
        <label className="app-field"><span className="app-label">Rows</span>
          <textarea className="app-textarea" rows={7} value={text} disabled={busy} placeholder={'6:30p\tDoors open\tSam; Ana\tGreet guests'}
            onChange={(change) => { setText(change.target.value); setAckWarnings(false); setError(null) }} /></label>
        {preview.error ? <p className="app-error-text" role="alert">{preview.error}</p> : null}
        {preview.rows.length ? <div className="ros-paste-preview"><h3>Preview · {preview.rows.length} items</h3>
          <ol>{preview.rows.map((row) => <li key={row.rowNumber}>
            <strong>{row.time || 'No time'} · {row.title || 'No title'}</strong>
            <span>{row.peopleText || 'Everyone'}{row.instructions ? ` · ${row.instructions}` : ''}</span>
            {row.errors.map((message) => <span className="app-error-text" key={message}>{message}</span>)}
            {row.warnings.map((message) => <span className="ros-timing-note" key={message}>{message}</span>)}
          </li>)}</ol>
        </div> : null}
        {warned ? <label className="app-field"><span><input type="checkbox" checked={ackWarnings} disabled={busy}
          onChange={(change) => setAckWarnings(change.target.checked)} /> I reviewed the overlap and outside-hours warnings</span></label> : null}
        {error ? <p className="app-error-text" role="alert">{error}</p> : null}
      </div>
      <div className="app-panel-footer"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button busy={busy} busyLabel="Adding…" disabled={!preview.rows.length || invalid || Boolean(preview.error) || (warned && !ackWarnings)} onClick={addAll}>Add {preview.rows.length || ''} items</Button></div>
    </SheetContent>
  </Sheet>
}
