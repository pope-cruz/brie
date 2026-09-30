import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ErrorRetry } from '../../components/ui'
import {
  archiveBookingLogEntry, getBookingRequestChecks, getBookingRequestDraft, getVenue,
  listBookingLogEntries, restoreBookingLogEntry, saveBookingLogEntry,
  saveBookingRequestDraft, setBookingRequestCheck, type WorkspaceSummary,
} from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type BookingLogEntry, type BookingRequestCheck, type BookingRequestItemKey, type EventBooking, type EventRecord, type Venue } from '../../data/types'
import { nyuRequestChecklist, outsideVenueEmailDraft } from '../../lib/bookingRequest'

export function BookingRequestPreparation({ workspace, event, booking }: {
  workspace: WorkspaceSummary; event: EventRecord; booking: EventBooking
}) {
  const venue = useQuery({
    queryKey: ['venue', workspace.id, booking.venueId],
    queryFn: () => getVenue(workspace.id, booking.venueId),
  })
  const canEdit = canManageEvents(workspace.role) && !event.archivedAt && !booking.venueMismatch
  if (venue.isLoading) return <p>Loading request details…</p>
  if (venue.isError || !venue.data) return <ErrorRetry message={toAppError(venue.error).message} onRetry={() => venue.refetch()} />
  return <section style={{ marginTop: 24 }}>
    <h3 className="app-section-title">Prepare venue request</h3>
    {venue.data.venueType === 'nyu_room'
      ? <NyuRequestChecklist workspaceId={workspace.id} booking={booking} event={event} venue={venue.data} canEdit={canEdit} />
      : <OutsideVenueDraft workspaceId={workspace.id} booking={booking} event={event} venue={venue.data}
          canRead={canManageEvents(workspace.role)} canEdit={canEdit} />}
    <BookingLog workspaceId={workspace.id} booking={booking} canEdit={canEdit} />
  </section>
}

function NyuRequestChecklist({ workspaceId, booking, event, venue, canEdit }: {
  workspaceId: string; booking: EventBooking; event: EventRecord; venue: Venue; canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const checks = useQuery({
    queryKey: ['booking-checks', workspaceId, booking.id],
    queryFn: () => getBookingRequestChecks(workspaceId, booking.id),
  })
  const [saving, setSaving] = useState<BookingRequestItemKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const items = nyuRequestChecklist(event, venue)
  async function toggle(key: BookingRequestItemKey, current?: BookingRequestCheck) {
    setSaving(key)
    setError(null)
    try {
      await setBookingRequestCheck(workspaceId, booking.id, key, !current?.checkedAt, current?.version ?? null)
      await queryClient.invalidateQueries({ queryKey: ['booking-checks', workspaceId, booking.id] })
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setSaving(null)
    }
  }
  return <div>
    <p className="app-meta">Review these details, then submit the NYU room request manually.</p>
    {items.map((item) => {
      const check = checks.data?.find((row) => row.itemKey === item.key)
      return <div key={item.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--app-border)' }}>
        <label><input type="checkbox" checked={Boolean(check?.checkedAt)} disabled={!canEdit || saving === item.key}
          onChange={() => void toggle(item.key, check)} /> {item.label}</label>
        <p className="app-meta">{item.detail}</p>
      </div>
    })}
    {venue.bookingLink ? <p><a href={venue.bookingLink} target="_blank" rel="noreferrer">Open booking link</a></p> : null}
    {error ? <p className="app-error-text" role="alert">{error}</p> : null}
  </div>
}

function OutsideVenueDraft({ workspaceId, booking, event, venue, canRead, canEdit }: {
  workspaceId: string; booking: EventBooking; event: EventRecord; venue: Venue; canRead: boolean; canEdit: boolean
}) {
  const saved = useQuery({
    queryKey: ['booking-draft', workspaceId, booking.id],
    queryFn: () => getBookingRequestDraft(workspaceId, booking.id),
    enabled: canRead,
  })
  if (!canRead) return <p className="app-meta">An organizer prepares the request email for this venue.</p>
  if (saved.isLoading) return <p>Loading draft…</p>
  if (saved.isError || !saved.data) return <ErrorRetry message={toAppError(saved.error).message} onRetry={() => saved.refetch()} />
  return <OutsideDraftEditor key={`${booking.id}:${saved.data.updatedAt}`} workspaceId={workspaceId}
    booking={booking} venue={venue} event={event} saved={saved.data} canEdit={canEdit} />
}

function OutsideDraftEditor({ workspaceId, booking, event, venue, saved, canEdit }: {
  workspaceId: string; booking: EventBooking; event: EventRecord; venue: Venue;
  saved: { draft: string; updatedAt: string | null; version: number }; canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(saved.draft || outsideVenueEmailDraft(event, venue))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      await saveBookingRequestDraft(workspaceId, booking.id, draft, saved.version)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['booking-draft', workspaceId, booking.id] }),
        queryClient.invalidateQueries({ queryKey: ['event-booking', workspaceId, booking.eventId] }),
      ])
      setMessage('Draft saved.')
    } catch (caught) {
      setMessage(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    setMessage(null)
    try {
      await navigator.clipboard.writeText(draft)
      setMessage('Draft copied. Review it before sending it yourself.')
    } catch {
      setMessage('Couldn’t copy the draft. Select the text and copy it manually.')
    }
  }
  return <div>
    <p className="app-meta">{canEdit ? 'Edit this draft, then copy it into your own email.' : 'Copy this saved draft for reference.'} Brie does not send it.</p>
    {venue.bookingContact ? <p className="app-meta">Booking contact: {venue.bookingContact}</p> : null}
    <textarea className="app-textarea" aria-label="Venue request email draft" rows={14} maxLength={5000}
      value={draft} readOnly={!canEdit} onChange={(change) => setDraft(change.target.value)} />
    <div className="app-toolbar" style={{ marginTop: 8 }}>
      {canEdit ? <Button variant="secondary" busy={busy} onClick={() => void save()}>Save draft</Button> : null}
      <Button variant="secondary" onClick={() => void copy()}>Copy draft</Button>
      <Link to={`/app/w/${workspaceId}/venues/${venue.id}`}>Venue details</Link>
    </div>
    {message ? <p className="app-meta" role="status">{message}</p> : null}
  </div>
}

function BookingLog({ workspaceId, booking, canEdit }: { workspaceId: string; booking: EventBooking; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [includeArchived, setIncludeArchived] = useState(false)
  const [editing, setEditing] = useState<BookingLogEntry | null>(null)
  const [entryType, setEntryType] = useState<BookingLogEntry['entryType']>('reply')
  const [occurredAt, setOccurredAt] = useState(() => localDateTimeInput(new Date()))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const entries = useQuery({
    queryKey: ['booking-log', workspaceId, booking.id, includeArchived],
    queryFn: () => listBookingLogEntries(workspaceId, booking.id, includeArchived),
  })
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ['booking-log', workspaceId, booking.id] })
      return true
    } catch (caught) {
      setError(toAppError(caught).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  function edit(entry: BookingLogEntry) {
    setEditing(entry)
    setEntryType(entry.entryType)
    setOccurredAt(localDateTimeInput(new Date(entry.occurredAt)))
    setNotes(entry.notes)
  }
  async function save() {
    const success = await run(() => saveBookingLogEntry(workspaceId, booking.id, editing?.id ?? null,
      entryType, new Date(occurredAt).toISOString(), notes, editing?.version ?? null))
    if (success) { setEditing(null); setNotes('') }
  }
  return <section style={{ marginTop: 24 }}>
    <h4 className="app-section-title">Replies and decisions</h4>
    <p className="app-meta">Record replies, quotes, holds, and confirmations with their dates.</p>
    {canEdit ? <div>
      <div className="app-toolbar">
        <select className="app-select" aria-label="Entry type" value={entryType} onChange={(change) => setEntryType(change.target.value as BookingLogEntry['entryType'])}>
          <option value="reply">Reply</option><option value="quote">Quote</option>
          <option value="hold">Hold</option><option value="confirmation">Confirmation</option>
        </select>
        <input className="app-input" aria-label="Entry date and time" type="datetime-local" value={occurredAt} onChange={(change) => setOccurredAt(change.target.value)} />
      </div>
      <textarea className="app-textarea" aria-label="Booking note" rows={3} maxLength={4000} value={notes} onChange={(change) => setNotes(change.target.value)} />
      <div className="app-toolbar">
        <Button variant="secondary" busy={busy} disabled={!notes.trim() || !occurredAt} onClick={() => void save()}>{editing ? 'Save note' : 'Add note'}</Button>
        {editing ? <Button variant="quiet" onClick={() => { setEditing(null); setNotes('') }}>Cancel edit</Button> : null}
      </div>
    </div> : null}
    <label className="app-meta"><input type="checkbox" checked={includeArchived} onChange={(change) => setIncludeArchived(change.target.checked)} /> Show archived notes</label>
    {entries.isError ? <ErrorRetry message={toAppError(entries.error).message} onRetry={() => entries.refetch()} /> : null}
    {entries.data?.length === 0 ? <p className="app-meta">No replies or decisions logged yet.</p> : null}
    {entries.data?.map((entry) => <div key={entry.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--app-border)' }}>
      <strong>{entry.entryType[0].toUpperCase() + entry.entryType.slice(1)}</strong>
      <p className="app-meta">{new Date(entry.occurredAt).toLocaleString()} · {entry.createdBy}{entry.removedAt ? ' · Archived' : ''}</p>
      <p>{entry.notes}</p>
      {canEdit ? <div className="app-toolbar">
        {!entry.removedAt ? <Button variant="quiet" onClick={() => edit(entry)}>Edit</Button> : null}
        <Button variant="quiet" busy={busy} onClick={() => void run(() => entry.removedAt
          ? restoreBookingLogEntry(workspaceId, entry.id, entry.version)
          : archiveBookingLogEntry(workspaceId, entry.id, entry.version))}>
          {entry.removedAt ? 'Restore' : 'Archive'}
        </Button>
      </div> : null}
    </div>)}
    {error ? <p className="app-error-text" role="alert">{error}</p> : null}
  </section>
}

function localDateTimeInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
