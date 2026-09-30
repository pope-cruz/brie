import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ErrorRetry, Field } from '../../components/ui'
import { getVenue, saveVenue } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type Venue } from '../../data/types'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'

type VenueInput = Omit<Venue, 'id' | 'workspaceId' | 'removedAt' | 'version'>

const blankVenue: VenueInput = {
  name: '', venueType: 'outside', capacity: null, address: '', costNotes: '',
  accessibility: '', equipment: '', bookingContact: '', bookingLink: '',
  leadTimeDays: 0, restrictions: '', notes: '',
}

export function VenueFormPage() {
  const workspace = useCurrentWorkspace()
  const { venueId } = useParams()
  const detail = useQuery({
    queryKey: ['venue', workspace.id, venueId],
    queryFn: () => getVenue(workspace.id, venueId!),
    enabled: Boolean(venueId),
  })
  if (!canManageEvents(workspace.role)) return <div className="app-page"><h1 className="app-h1">This page isn’t available</h1></div>
  if (venueId && detail.isLoading) return <div className="app-page"><p>Loading venue…</p></div>
  if (venueId && (detail.isError || !detail.data)) return <div className="app-page"><ErrorRetry message={toAppError(detail.error).message} onRetry={() => detail.refetch()} /></div>
  return <VenueForm key={venueId ?? 'new'} workspaceId={workspace.id} venue={detail.data ?? null} />
}

function VenueForm({ workspaceId, venue }: { workspaceId: string; venue: Venue | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<VenueInput>(venue ? {
    name: venue.name, venueType: venue.venueType, capacity: venue.capacity,
    address: venue.address, costNotes: venue.costNotes, accessibility: venue.accessibility,
    equipment: venue.equipment, bookingContact: venue.bookingContact,
    bookingLink: venue.bookingLink, leadTimeDays: venue.leadTimeDays,
    restrictions: venue.restrictions, notes: venue.notes,
  } : blankVenue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = (key: keyof VenueInput, value: string | number | null) => setDraft((current) => ({ ...current, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await saveVenue(workspaceId, venue?.id ?? null, draft, venue?.version ?? null)
      void queryClient.invalidateQueries({ queryKey: ['venues', workspaceId] })
      void queryClient.invalidateQueries({ queryKey: ['venue', workspaceId, saved.id] })
      navigate(`/app/w/${workspaceId}/venues/${saved.id}`)
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-page app-page-narrow">
      <Link to={venue ? `/app/w/${workspaceId}/venues/${venue.id}` : `/app/w/${workspaceId}/venues`}>Venues</Link>
      <h1 className="app-h1">{venue ? 'Edit venue' : 'Add venue'}</h1>
      <form onSubmit={(event) => void submit(event)}>
        <Field label="Name"><input className="app-input" required maxLength={120} value={draft.name} onChange={(event) => update('name', event.target.value)} /></Field>
        <Field label="Venue type"><select className="app-select" value={draft.venueType} onChange={(event) => update('venueType', event.target.value)}>
          <option value="outside">Outside venue</option><option value="nyu_room">NYU room</option>
        </select></Field>
        <Field label="Capacity"><input className="app-input" type="number" min="0" value={draft.capacity ?? ''} onChange={(event) => update('capacity', event.target.value === '' ? null : Number(event.target.value))} /></Field>
        <Field label="Address or location"><input className="app-input" maxLength={300} value={draft.address} onChange={(event) => update('address', event.target.value)} /></Field>
        <Field label="Cost notes"><textarea className="app-textarea" maxLength={2000} value={draft.costNotes} onChange={(event) => update('costNotes', event.target.value)} /></Field>
        <Field label="Accessibility"><textarea className="app-textarea" maxLength={2000} value={draft.accessibility} onChange={(event) => update('accessibility', event.target.value)} /></Field>
        <Field label="Equipment"><textarea className="app-textarea" maxLength={2000} value={draft.equipment} onChange={(event) => update('equipment', event.target.value)} /></Field>
        <Field label="Booking contact"><input className="app-input" maxLength={300} value={draft.bookingContact} onChange={(event) => update('bookingContact', event.target.value)} /></Field>
        <Field label="Booking link"><input className="app-input" type="url" maxLength={500} value={draft.bookingLink} onChange={(event) => update('bookingLink', event.target.value)} /></Field>
        <Field label="Lead time in days"><input className="app-input" type="number" min="0" max="730" required value={draft.leadTimeDays} onChange={(event) => update('leadTimeDays', Number(event.target.value))} /></Field>
        <Field label="Restrictions"><textarea className="app-textarea" maxLength={2000} value={draft.restrictions} onChange={(event) => update('restrictions', event.target.value)} /></Field>
        <Field label="Notes"><textarea className="app-textarea" maxLength={4000} value={draft.notes} onChange={(event) => update('notes', event.target.value)} /></Field>
        {error ? <p className="app-error-text" role="alert">{error}</p> : null}
        <div className="app-toolbar">
          <Button type="submit" busy={busy} busyLabel="Saving…">Save venue</Button>
          <Link className="app-btn app-btn-quiet" to={venue ? `/app/w/${workspaceId}/venues/${venue.id}` : `/app/w/${workspaceId}/venues`}>Cancel</Link>
        </div>
      </form>
    </div>
  )
}
