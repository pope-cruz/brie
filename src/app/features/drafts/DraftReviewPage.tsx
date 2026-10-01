import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTimeRange } from '../../components/DateTimeRange'
import { Button, ConfirmDialog, ErrorRetry, Field, SkeletonRows } from '../../components/ui'
import { acceptPlanDraft, discardPlanDraft, getPlanDraft } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type PlanDraft } from '../../data/types'
import { clearRequestKey, getRequestKey } from '../../lib/idempotency'
import { acceptChanges, dueLabel, initialEdits, previewDraft, timeLabel, type DraftEdits } from '../../lib/planDraft'
import { formatDay } from '../../lib/venueFit'
import { formatInZone, formatTimeRange, resolveLocalDateTime, splitInZone, timeZoneLabel } from '../../lib/timezone'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'
import { DraftStatus } from './DraftListPage'

export function DraftReviewPage() {
  const workspace = useCurrentWorkspace()
  const { draftId = '' } = useParams()
  const draft = useQuery({
    queryKey: ['plan-draft', workspace.id, draftId],
    queryFn: () => getPlanDraft(workspace.id, draftId),
    enabled: canManageEvents(workspace.role),
  })
  if (!canManageEvents(workspace.role)) {
    return <div className="app-page"><h1 className="app-h1">This page isn’t available</h1></div>
  }
  return (
    <div className="app-page">
      <p className="app-meta"><Link to={`/app/w/${workspace.id}/drafts`}>← Drafts</Link></p>
      {draft.isLoading ? <SkeletonRows count={4} /> : null}
      {draft.isError ? <ErrorRetry message={toAppError(draft.error).message} onRetry={() => draft.refetch()} /> : null}
      {draft.data ? <DraftReview key={`${draft.data.id}:${draft.data.version}`} draft={draft.data} /> : null}
    </div>
  )
}

function DraftReview({ draft }: { draft: PlanDraft }) {
  const workspace = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const pending = draft.status === 'pending'
  const [edits, setEdits] = useState<DraftEdits>(() => initialEdits(draft))
  const start = splitInZone(draft.startsAt, draft.timezone)
  const end = splitInZone(draft.endsAt, draft.timezone)
  const [startDate, setStartDate] = useState(start.date)
  const [startTime, setStartTime] = useState(start.time)
  const [endDate, setEndDate] = useState(end.date)
  const [endTime, setEndTime] = useState(end.time)
  const [startOffset, setStartOffset] = useState<string | undefined>(start.offset)
  const [endOffset, setEndOffset] = useState<string | undefined>(end.offset)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const resolvedStart = resolveLocalDateTime(startDate, startTime, draft.timezone, startOffset)
  const resolvedEnd = resolveLocalDateTime(endDate, endTime, draft.timezone, endOffset)
  const startError = resolvedStart.ok ? undefined : resolvedStart.reason === 'ambiguous' ? 'Choose which occurrence of this time you mean.' : 'This time doesn’t exist in this time zone.'
  const endError = !resolvedEnd.ok ? (resolvedEnd.reason === 'ambiguous' ? 'Choose which occurrence of this time you mean.' : 'This time doesn’t exist in this time zone.')
    : resolvedStart.ok && Date.parse(resolvedEnd.iso) <= Date.parse(resolvedStart.iso) ? 'End must be after start.' : undefined
  const startsAt = resolvedStart.ok ? resolvedStart.iso : edits.startsAt
  const endsAt = resolvedEnd.ok ? resolvedEnd.iso : edits.endsAt
  const preview = previewDraft(draft, startsAt, endsAt, draft.timezone)
  const titleError = edits.title.trim().length === 0 || edits.title.trim().length > 120 ? 'Enter a title up to 120 characters.' : undefined
  const scope = `accept-draft:${draft.id}:${draft.version}`

  function toggle(set: 'keptTodos' | 'keptSchedule', index: number) {
    setEdits((current) => {
      const next = new Set(current[set])
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return { ...current, [set]: next }
    })
  }

  async function accept() {
    if (titleError || startError || endError) { setError('Fix the highlighted details first.'); return }
    setBusy(true); setError(null)
    try {
      const changes = acceptChanges(draft, { ...edits, startsAt, endsAt })
      const result = await acceptPlanDraft(workspace.id, draft.id, changes, draft.version, getRequestKey(scope))
      clearRequestKey(scope)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plan-drafts', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['plan-draft', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['events', workspace.id] }),
      ])
      navigate(`/app/w/${workspace.id}/events/${result.eventId}`)
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    setBusy(true); setError(null)
    try {
      await discardPlanDraft(workspace.id, draft.id, draft.version)
      setConfirmDiscard(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plan-drafts', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['plan-draft', workspace.id] }),
      ])
    } catch (caught) {
      setConfirmDiscard(false)
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-draft-review">
      <div className="app-header-row">
        <div>
          <h1 className="app-h1">{draft.title}</h1>
          <p className="app-lede">
            <DraftStatus status={draft.status} /> Proposed {formatInZone(draft.createdAt, workspace.timezone)} by an assistant using “{draft.keyLabel}” ({draft.proposedByName}).
          </p>
        </div>
      </div>
      {draft.status === 'accepted' && draft.acceptedEventId ? (
        <p className="app-banner" role="status">
          Accepted {draft.decidedAt ? formatInZone(draft.decidedAt, workspace.timezone) : ''}{draft.decidedByName ? ` by ${draft.decidedByName}` : ''}. <Link to={`/app/w/${workspace.id}/events/${draft.acceptedEventId}`}>Open the event</Link>
        </p>
      ) : null}
      {draft.status === 'discarded' ? (
        <p className="app-banner" role="status">Discarded {draft.decidedAt ? formatInZone(draft.decidedAt, workspace.timezone) : ''}{draft.decidedByName ? ` by ${draft.decidedByName}` : ''}. Nothing was added.</p>
      ) : null}
      {draft.summary ? <p>{draft.summary}</p> : null}

      <section className="app-draft-callout" aria-labelledby="assumptions">
        <h2 id="assumptions" className="app-section-title">Assumptions to check</h2>
        <ul>{draft.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
        {draft.expectedAttendance != null ? <p className="app-meta">Planned for {draft.expectedAttendance} people.</p> : null}
      </section>

      <section aria-labelledby="based-on">
        <h2 id="based-on" className="app-section-title">Based on</h2>
        {draft.citedEvents.length === 0 ? <p className="app-meta">The assistant didn’t cite any past events.</p> : (
          <ul className="app-draft-list">
            {draft.citedEvents.map((event) => (
              <li key={event.id}>
                <Link to={`/app/w/${workspace.id}/events/${event.id}`}>{event.title}</Link>
                <span className="app-meta"> · {formatInZone(event.startsAt, event.timezone, { hour: undefined, minute: undefined })}{event.archived ? ' · Archived' : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="event-details" className="app-page-narrow">
        <h2 id="event-details" className="app-section-title">Event</h2>
        {pending ? (
          <>
            <Field label="Title" error={titleError}>
              <input className="app-input" value={edits.title} maxLength={120} onChange={(change) => setEdits({ ...edits, title: change.target.value })} />
            </Field>
            <DateTimeRange startDate={startDate} endDate={endDate} startTime={startTime} endTime={endTime}
              startOffset={startOffset} endOffset={endOffset} timezone={draft.timezone}
              onStartDate={setStartDate} onEndDate={setEndDate} onStartTime={setStartTime} onEndTime={setEndTime}
              onStartOffset={setStartOffset} onEndOffset={setEndOffset} startError={startError} endError={endError} />
            <p className="app-meta">Time zone: {timeZoneLabel(draft.timezone, startsAt)}. To-do due dates and schedule times move with the start.</p>
          </>
        ) : <p className="app-tabular">{formatTimeRange(draft.startsAt, draft.endsAt, draft.timezone)}</p>}
        {draft.description ? <p className="app-draft-text">{draft.description}</p> : null}
        {draft.location ? <p className="app-meta">Location: {draft.location}</p> : null}
        {draft.venue ? (
          pending && !draft.venue.archived ? (
            <label className="app-draft-check">
              <input type="checkbox" checked={edits.includeVenue} onChange={(change) => setEdits({ ...edits, includeVenue: change.target.checked })} />
              <span>Link venue <Link to={`/app/w/${workspace.id}/venues/${draft.venue.id}`}>{draft.venue.name}</Link>
                {draft.venue.capacity != null ? <span className="app-meta"> · holds {draft.venue.capacity}</span> : null}
                <span className="app-meta"> · no booking is made</span></span>
            </label>
          ) : <p className="app-meta">Venue: {draft.venue.name}{draft.venue.archived ? ' (archived, won’t be linked)' : ''}</p>
        ) : null}
      </section>

      <section aria-labelledby="draft-todos">
        <h2 id="draft-todos" className="app-section-title">To-dos ({pending ? `${edits.keptTodos.size} of ${draft.todos.length} kept` : draft.todos.length})</h2>
        {draft.todos.length === 0 ? <p className="app-meta">None proposed.</p> : null}
        <ul className="app-draft-list">
          {draft.todos.map((todo, index) => (
            <li key={index}>
              <label className="app-draft-check">
                {pending ? <input type="checkbox" checked={edits.keptTodos.has(index)} onChange={() => toggle('keptTodos', index)} aria-label={`Keep to-do: ${todo.title}`} /> : null}
                <span>
                  <strong>{todo.title}</strong>
                  <span className="app-meta"> · {dueLabel(todo.dueDaysBeforeEvent)}{preview.todos[index].dueDate ? ` (${formatDay(preview.todos[index].dueDate!)})` : ''} · Unassigned</span>
                  {todo.notes ? <span className="app-draft-text app-meta">{todo.notes}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="draft-schedule">
        <h2 id="draft-schedule" className="app-section-title">Run of show ({pending ? `${edits.keptSchedule.size} of ${draft.schedule.length} kept` : draft.schedule.length})</h2>
        {draft.schedule.length === 0 ? <p className="app-meta">None proposed.</p> : null}
        <ul className="app-draft-list">
          {draft.schedule.map((item, index) => (
            <li key={index}>
              <label className="app-draft-check">
                {pending ? <input type="checkbox" checked={edits.keptSchedule.has(index)} onChange={() => toggle('keptSchedule', index)} aria-label={`Keep schedule item: ${item.title}`} /> : null}
                <span>
                  <span className="app-tabular">{timeLabel(preview.schedule[index].startsAt, draft.timezone)}–{timeLabel(preview.schedule[index].endsAt, draft.timezone)}</span>{' '}
                  <strong>{item.title}</strong>
                  {preview.schedule[index].outsideEvent ? <span className="app-meta"> · outside event hours</span> : null}
                  {item.instructions ? <span className="app-draft-text app-meta">{item.instructions}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {draft.teamBriefing ? (
        <section aria-labelledby="draft-briefing">
          <h2 id="draft-briefing" className="app-section-title">Team briefing</h2>
          <p className="app-draft-text">{draft.teamBriefing}</p>
        </section>
      ) : null}

      {error ? <p className="app-error-text" role="alert">{error}</p> : null}
      {pending ? (
        <div className="app-toolbar app-draft-actions">
          <Button busy={busy} busyLabel="Creating…" onClick={() => void accept()}>Create draft event</Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmDiscard(true)}>Discard</Button>
          <p className="app-meta">Creates a Draft event with the kept to-dos and schedule. Nobody is assigned and no venue is booked; edit anything afterwards.</p>
        </div>
      ) : null}
      {confirmDiscard ? (
        <ConfirmDialog title="Discard this draft?" body="Nothing was added to your events. The draft stays in the reviewed list." actionLabel="Discard draft"
          pending={busy} onCancel={() => setConfirmDiscard(false)} onConfirm={() => void discard()} />
      ) : null}
    </div>
  )
}
