import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ErrorRetry } from '../../components/ui'
import { archiveVenue, getVenue, restoreVenue } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents } from '../../data/types'
import { eventLocalDate } from '../../lib/timezone'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'
import { VenueBookingStepsEditor } from './VenueBookingStepsEditor'

export function VenueDetailPage() {
  const workspace = useCurrentWorkspace()
  const { venueId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const venue = useQuery({ queryKey: ['venue', workspace.id, venueId], queryFn: () => getVenue(workspace.id, venueId) })
  const lifecycle = useMutation({
    mutationFn: ({ archived, version }: { archived: boolean; version: number }) => archived
      ? restoreVenue(workspace.id, venueId, version)
      : archiveVenue(workspace.id, venueId, version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['venues', workspace.id] })
      void queryClient.invalidateQueries({ queryKey: ['venue', workspace.id, venueId] })
    },
  })

  if (venue.isLoading) return <div className="app-page"><h1 className="app-h1">Venue</h1><p>Loading…</p></div>
  if (venue.isError || !venue.data) return <div className="app-page"><ErrorRetry message={toAppError(venue.error).message} onRetry={() => venue.refetch()} /></div>
  const item = venue.data
  const facts = [
    ['Capacity', item.capacity?.toString()], ['Address or location', item.address],
    ['Cost notes', item.costNotes], ['Accessibility', item.accessibility],
    ['Equipment', item.equipment], ['Booking contact', item.bookingContact],
    ['Restrictions', item.restrictions], ['Notes', item.notes],
  ]
  return (
    <div className="app-page">
      <Link to={`/app/w/${workspace.id}/venues`}>Venues</Link>
      <div className="app-header-row">
        <div><h1 className="app-h1">{item.name}</h1><p className="app-meta">{item.venueType === 'nyu_room' ? 'NYU room' : 'Outside venue'}{item.removedAt ? ' · Archived' : ''}</p></div>
        {canManageEvents(workspace.role) ? <div className="app-toolbar">
          {!item.removedAt ? <Link className="app-btn app-btn-secondary" to="edit">Edit venue</Link> : null}
          <Button variant="quiet" busy={lifecycle.isPending} onClick={() => {
            if (window.confirm(item.removedAt ? 'Restore this venue?' : 'Archive this venue? Past event links stay visible.')) {
              lifecycle.mutate({ archived: Boolean(item.removedAt), version: item.version })
            }
          }}>{item.removedAt ? 'Restore' : 'Archive'}</Button>
        </div> : null}
      </div>
      {lifecycle.isError ? <p className="app-error-text" role="alert">{toAppError(lifecycle.error).message}</p> : null}
      {facts.map(([label, value]) => value ? <p key={label}><strong>{label}:</strong> {value}</p> : null)}
      <p><strong>Lead time:</strong> {item.leadTimeDays} days</p>
      {item.bookingLink ? <p><a href={item.bookingLink} target="_blank" rel="noreferrer">Booking link</a></p> : null}
      <h2 className="app-section-title" style={{ marginTop: 24 }}>Past events</h2>
      {item.pastEvents.length === 0 ? <p className="app-meta">No past events linked to this venue.</p> : null}
      {item.pastEvents.map((event) => <p key={event.id}>
        <Link to={`/app/w/${workspace.id}/events/${event.id}`}>{event.title}</Link>
        {' · '}{eventLocalDate(event.startsAt, event.timezone)}
        {event.location ? ` · ${event.location}` : ''}
      </p>)}
      <VenueBookingStepsEditor workspaceId={workspace.id} venueId={item.id} canEdit={canManageEvents(workspace.role) && !item.removedAt} />
      <Button variant="quiet" onClick={() => navigate(`/app/w/${workspace.id}/venues`)}>Back to venues</Button>
    </div>
  )
}
