import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ErrorRetry } from '../../components/ui'
import {
  archiveEventBooking, getEventBooking, getEventVenue, listArchivedEventBookings,
  restoreEventBooking, setBookingStepStatus, startEventBooking,
  type WorkspaceSummary,
} from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type EventBookingStep, type EventRecord } from '../../data/types'

export function EventBookingSummary({ workspace, event }: { workspace: WorkspaceSummary; event: EventRecord }) {
  const booking = useQuery({ queryKey: ['event-booking', workspace.id, event.id], queryFn: () => getEventBooking(workspace.id, event.id) })
  if (!booking.data) return null
  return <p className="app-meta">
    Booking: {booking.data.currentStepTitle ? `${booking.data.currentStepTitle} · ` : ''}{booking.data.currentStatus}
    {booking.data.nextDeadline ? ` · Next deadline ${booking.data.nextDeadline}` : ''}
    {booking.data.venueMismatch ? ' · Venue changed' : ''}
  </p>
}

export function EventBookingPanel({ workspace, event }: { workspace: WorkspaceSummary; event: EventRecord }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = canManageEvents(workspace.role) && !event.archivedAt
  const booking = useQuery({ queryKey: ['event-booking', workspace.id, event.id], queryFn: () => getEventBooking(workspace.id, event.id) })
  const venue = useQuery({ queryKey: ['event-venue', workspace.id, event.id], queryFn: () => getEventVenue(workspace.id, event.id) })
  const archived = useQuery({
    queryKey: ['archived-event-bookings', workspace.id, event.id],
    queryFn: () => listArchivedEventBookings(workspace.id, event.id),
  })

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['event-booking', workspace.id, event.id] }),
        queryClient.invalidateQueries({ queryKey: ['archived-event-bookings', workspace.id, event.id] }),
      ])
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  function changeStatus(step: EventBookingStep, status: EventBookingStep['status']) {
    void run(() => setBookingStepStatus(workspace.id, step.id, status, step.version))
  }

  return <section style={{ marginBottom: 24 }}>
    <h3 className="app-section-title">Venue booking</h3>
    {booking.isError ? <ErrorRetry message={toAppError(booking.error).message} onRetry={() => booking.refetch()} /> : null}
    {!booking.data && venue.data?.venueId && canEdit ? <Button variant="secondary" busy={busy} onClick={() => void run(() => startEventBooking(workspace.id, event.id))}>Start booking</Button> : null}
    {!booking.data && !venue.data?.venueId ? <p className="app-meta">Link a venue above to track booking.</p> : null}
    {booking.data ? <>
      <p className="app-meta">{booking.data.venueName} · {booking.data.currentStatus}
        {booking.data.nextDeadline ? ` · Next deadline ${booking.data.nextDeadline}` : ''}</p>
      {booking.data.venueMismatch ? <p className="app-banner">This booking tracks a different venue. Archive it before starting one for the linked venue.</p> : null}
      {booking.data.steps.map((step) => <div key={step.id} className="app-toolbar" style={{ padding: '8px 0', borderBottom: '1px solid var(--app-border)' }}>
        <div style={{ flex: 1 }}>
          <strong>{step.title}</strong>
          <p className="app-meta">Deadline {step.deadline} · Updated {new Date(step.statusAt).toLocaleString()}</p>
        </div>
        {canEdit && !booking.data?.venueMismatch ? <select className="app-select" aria-label={`${step.title} status`} value={step.status} disabled={busy}
          onChange={(change) => changeStatus(step, change.target.value as EventBookingStep['status'])}>
          <option value="not_started">Not started</option><option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option><option value="complete">Complete</option>
        </select> : <span className="app-meta">{step.status.replace('_', ' ')}</span>}
      </div>)}
      {canEdit ? <Button variant="quiet" busy={busy} onClick={() => {
        if (window.confirm('Archive this booking? Its dated steps remain available to restore.')) {
          void run(() => archiveEventBooking(workspace.id, booking.data!.id, booking.data!.version))
        }
      }}>Archive booking</Button> : null}
    </> : null}
    {archived.data?.length ? <details style={{ marginTop: 16 }}><summary>Archived bookings</summary>
      {archived.data.map((item) => <div key={item.id} className="app-toolbar" style={{ marginTop: 8 }}>
        <span>{item.venueName} · {new Date(item.removedAt!).toLocaleString()}</span>
        {canEdit && !booking.data && venue.data?.venueId === item.venueId ? <Button variant="quiet" busy={busy} onClick={() => void run(() => restoreEventBooking(workspace.id, item.id, item.version))}>Restore</Button> : null}
      </div>)}
    </details> : null}
    {error ? <p className="app-error-text" role="alert">{error}</p> : null}
  </section>
}
