import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { EmptyState, ErrorRetry, SkeletonRows } from '../../components/ui'
import { compareVenues } from '../../data/api'
import { toAppError } from '../../data/errors'
import type { VenueComparison } from '../../data/types'
import { MAX_COMPARED_VENUES, assessVenueFit, formatDay, lastUsedLabel, parseHeadcount, venueTypeLabel } from '../../lib/venueFit'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'

type Row = { label: string; value: (venue: VenueComparison) => ReactNode }

const text = (value: string) => value.trim() ? <span className="app-venue-compare-text">{value}</span> : <span className="app-meta">Not recorded</span>

const ROWS: Row[] = [
  { label: 'Type', value: (venue) => venueTypeLabel(venue.venueType) },
  { label: 'Capacity', value: (venue) => venue.capacity ?? <span className="app-meta">Not recorded</span> },
  { label: 'Lead time', value: (venue) => venue.leadTimeDays ? `${venue.leadTimeDays} days` : 'None' },
  { label: 'Cost', value: (venue) => text(venue.costNotes) },
  { label: 'Accessibility', value: (venue) => text(venue.accessibility) },
  { label: 'Equipment', value: (venue) => text(venue.equipment) },
  { label: 'Restrictions', value: (venue) => text(venue.restrictions) },
  { label: 'Address', value: (venue) => text(venue.address) },
  { label: 'Booking', value: (venue) => text([venue.bookingContact, venue.bookingLink].filter(Boolean).join('\n')) },
  { label: 'Past use', value: (venue) => lastUsedLabel(venue) },
  { label: 'Notes', value: (venue) => text(venue.notes) },
]

export function VenueComparePage() {
  const workspace = useCurrentWorkspace()
  const [params] = useSearchParams()
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, MAX_COMPARED_VENUES)
  const eventId = params.get('event')
  const headcount = parseHeadcount(params.get('people') ?? '')
  const venues = useQuery({
    queryKey: ['venues', workspace.id, 'compare', true, eventId],
    queryFn: () => compareVenues(workspace.id, true, eventId),
  })
  const chosen = ids.map((id) => venues.data?.find((venue) => venue.id === id)).filter((venue): venue is VenueComparison => Boolean(venue))
  const backParams = new URLSearchParams()
  if (eventId) backParams.set('event', eventId)
  if (headcount != null) backParams.set('people', String(headcount))
  const back = `/app/w/${workspace.id}/venues${backParams.size ? `?${backParams}` : ''}`

  const requestDates = chosen.filter((venue) => venue.fit && venue.leadTimeDays > 0).map((venue) => venue.fit!.requestBy).sort()
  const rows: Row[] = eventId ? [{
    label: 'For this event',
    value: (venue) => {
      const fit = assessVenueFit(venue, headcount)
      return (
        <ul className="app-venue-reasons">
          <li>{venue.fit?.linkedToEvent ? 'Linked to this event' : fit.suitable ? 'Suitable' : 'Check first'}</li>
          {fit.problems.map((problem) => <li key={problem}>{problem}</li>)}
          {fit.notes.map((note) => <li key={note} className="app-meta">{note}</li>)}
        </ul>
      )
    },
  }, ...ROWS] : ROWS

  return (
    <div className="app-page">
      <p className="app-meta"><Link to={back}>← Back to venues</Link></p>
      <h1 className="app-h1">Compare venues</h1>
      {venues.isLoading ? <SkeletonRows count={4} /> : null}
      {venues.isError ? <ErrorRetry message={toAppError(venues.error).message} onRetry={() => venues.refetch()} /> : null}
      {venues.data && chosen.length < 2 ? (
        <EmptyState title="Choose at least two venues" body="Select venues from the list, then choose Compare." action={<Link className="app-btn app-btn-secondary" to={back}>Choose venues</Link>} />
      ) : null}
      {chosen.length >= 2 ? (
        <>
          {eventId && headcount != null ? <p className="app-lede">Checked for {headcount} people.</p> : null}
          <div className="app-table-wrap app-table-desktop app-venue-compare">
            <table className="app-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Detail</span></th>
                  {chosen.map((venue) => (
                    <th key={venue.id} scope="col">
                      <Link to={`/app/w/${workspace.id}/venues/${venue.id}`}>{venue.name}</Link>
                      {venue.removedAt ? <span className="app-meta"> · Archived</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {chosen.map((venue) => <td key={venue.id}>{row.value(venue)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="app-stack-mobile">
            {rows.map((row) => (
              <section key={row.label} className="app-venue-compare-section" aria-label={row.label}>
                <h2 className="app-section-title">{row.label}</h2>
                <dl>
                  {chosen.map((venue) => (
                    <div key={venue.id} className="app-venue-compare-item">
                      <dt className="app-meta">{venue.name}</dt>
                      <dd>{row.value(venue)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          {requestDates.length ? (
            <p className="app-meta">Request-by dates count back each venue’s lead time from the event day. Earliest: {formatDay(requestDates[0])}.</p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
