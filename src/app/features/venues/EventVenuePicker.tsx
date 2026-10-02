import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui'
import { getEventVenue, listVenues, setEventVenue } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type EventRecord } from '../../data/types'
import type { WorkspaceSummary } from '../../data/api'

export function EventVenuePicker({ workspace, event }: { workspace: WorkspaceSummary; event: EventRecord }) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useQuery({
    queryKey: ['event-venue', workspace.id, event.id],
    queryFn: () => getEventVenue(workspace.id, event.id),
  })
  const editable = canManageEvents(workspace.role) && !event.archivedAt
  const venues = useQuery({
    queryKey: ['venues', workspace.id, true],
    queryFn: () => listVenues(workspace.id, true),
    enabled: editable,
  })
  const value = selected ?? current.data?.venueId ?? ''

  async function save() {
    if (!current.data) return
    setBusy(true)
    setError(null)
    try {
      await setEventVenue(workspace.id, event.id, value || null, current.data.version)
      setSelected(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['event-venue', workspace.id, event.id] }),
        queryClient.invalidateQueries({ queryKey: ['event', workspace.id, event.id] }),
        queryClient.invalidateQueries({ queryKey: ['venue', workspace.id] }),
      ])
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  const linked = current.data?.venueId
    ? <Link to={`/app/w/${workspace.id}/venues/${current.data.venueId}`}>{current.data.venueName}</Link>
    : null
  const changed = value !== (current.data?.venueId ?? '')

  return (
    <div className="event-venue">
      <div className="event-venue-row">
        <span className="event-venue-label">Venue</span>
        {editable ? <>
          <select className="app-select event-venue-select" aria-label="Event venue" value={value} onChange={(change) => setSelected(change.target.value)}>
            <option value="">No venue</option>
            {venues.data?.map((venue) => <option key={venue.id} value={venue.id} disabled={Boolean(venue.removedAt)}>
              {venue.name}{venue.removedAt ? ' (archived)' : ''}
            </option>)}
          </select>
          {changed ? <Button variant="secondary" busy={busy} onClick={() => void save()}>Save venue</Button> : null}
          {!changed && linked ? <Link className="app-btn app-btn-quiet" to={`/app/w/${workspace.id}/venues/${current.data?.venueId}`}>View venue</Link> : null}
          {!changed && !linked ? <Link className="app-btn app-btn-quiet" to={`/app/w/${workspace.id}/venues?event=${event.id}`}>Find a venue</Link> : null}
        </> : <span>{linked ?? 'None linked'}</span>}
      </div>
      {error ? <p className="app-error-text" role="alert">{error}</p> : null}
      {current.isError ? <p className="app-error-text" role="alert">{toAppError(current.error).message}</p> : null}
    </div>
  )
}
