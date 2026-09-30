import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, EmptyState, ErrorRetry, SkeletonRows, StatusBadge } from '../../components/ui'
import { compareVenues, getEvent, getEventVenue, setEventVenue } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type VenueComparison } from '../../data/types'
import { formatTimeRange } from '../../lib/timezone'
import {
  MAX_COMPARED_VENUES,
  filterVenues,
  lastUsedLabel,
  parseHeadcount,
  rankByFit,
  readVenueFilters,
  venueTypeLabel,
  type VenueFit,
} from '../../lib/venueFit'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'

export function VenueListPage() {
  const workspace = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const filters = readVenueFilters(params)
  const includeArchived = params.get('archived') === '1'
  const eventId = params.get('event')
  const headcountText = params.get('people') ?? ''
  const headcount = parseHeadcount(headcountText)
  const [selected, setSelected] = useState<string[]>([])
  const [linking, setLinking] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const venues = useQuery({
    queryKey: ['venues', workspace.id, 'compare', includeArchived, eventId],
    queryFn: () => compareVenues(workspace.id, includeArchived, eventId),
  })
  const event = useQuery({
    queryKey: ['event', workspace.id, eventId],
    queryFn: () => getEvent(workspace.id, eventId!),
    enabled: Boolean(eventId),
  })
  const eventVenue = useQuery({
    queryKey: ['event-venue', workspace.id, eventId],
    queryFn: () => getEventVenue(workspace.id, eventId!),
    enabled: Boolean(eventId),
  })
  const canLink = Boolean(eventId) && canManageEvents(workspace.role) && Boolean(event.data && !event.data.archivedAt)

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  function toggle(id: string) {
    setSelected((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length >= MAX_COMPARED_VENUES ? current : [...current, id])
  }

  async function linkToEvent(venueId: string) {
    if (!eventId || !eventVenue.data) return
    setLinking(venueId)
    setLinkError(null)
    try {
      await setEventVenue(workspace.id, eventId, venueId, eventVenue.data.version)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['event-venue', workspace.id, eventId] }),
        queryClient.invalidateQueries({ queryKey: ['event', workspace.id, eventId] }),
        queryClient.invalidateQueries({ queryKey: ['venues', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['venue', workspace.id] }),
      ])
    } catch (caught) {
      setLinkError(toAppError(caught).message)
    } finally {
      setLinking(null)
    }
  }

  const shown = venues.data ? filterVenues(venues.data, filters) : []
  const rows: Array<{ venue: VenueComparison; fit: VenueFit | null }> = eventId
    ? rankByFit(shown, headcount)
    : shown.map((venue) => ({ venue, fit: null }))
  const filtered = Boolean(filters.query || filters.type !== 'all' || filters.minCapacity != null)
  const compareHref = `compare?ids=${selected.join(',')}${eventId ? `&event=${eventId}` : ''}${headcount != null ? `&people=${headcount}` : ''}`
  const eventPath = eventId ? `/app/w/${workspace.id}/events/${eventId}` : ''

  function fitSummary(venue: VenueComparison, fit: VenueFit | null) {
    if (!fit) return null
    const linked = venue.fit?.linkedToEvent
    return (
      <div className="app-venue-fit">
        {linked ? <StatusBadge tone="done">Linked to this event</StatusBadge>
          : fit.suitable ? <StatusBadge tone="done">Suitable</StatusBadge>
          : <StatusBadge tone="warning">Check first</StatusBadge>}
        {[...fit.problems, ...fit.notes].length ? (
          <ul className="app-meta app-venue-reasons">
            {fit.problems.map((problem) => <li key={problem}>{problem}</li>)}
            {fit.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        ) : null}
      </div>
    )
  }

  function linkAction(venue: VenueComparison, variant: 'quiet' | 'secondary') {
    if (!canLink || venue.fit?.linkedToEvent || venue.removedAt) return null
    return (
      <Button variant={variant} busy={linking === venue.id} busyLabel="Linking…" disabled={Boolean(linking) || !eventVenue.data}
        onClick={() => void linkToEvent(venue.id)} aria-label={`Use ${venue.name} for this event`}>
        Use for this event
      </Button>
    )
  }

  function selectBox(venue: VenueComparison) {
    const checked = selected.includes(venue.id)
    return (
      <input type="checkbox" checked={checked} aria-label={`Compare ${venue.name}`}
        disabled={!checked && selected.length >= MAX_COMPARED_VENUES} onChange={() => toggle(venue.id)} />
    )
  }

  return (
    <div className="app-page">
      <div className="app-header-row">
        <div>
          {eventId ? <p className="app-meta"><Link to={eventPath}>← {event.data?.title ?? 'Back to event'}</Link></p> : null}
          <h1 className="app-h1">{eventId ? 'Find a venue' : 'Venues'}</h1>
          <p className="app-lede">
            {eventId && event.data
              ? `For ${event.data.title}, ${formatTimeRange(event.data.startsAt, event.data.endsAt, event.data.timezone)}. Venues that need checking stay listed with the reason.`
              : 'Places your workspace uses for events.'}
          </p>
        </div>
        {!eventId && canManageEvents(workspace.role) ? <Link className="app-btn app-btn-primary" to="new">Add venue</Link> : null}
      </div>
      {event.isError ? <p className="app-error-text" role="alert">{toAppError(event.error).message}</p> : null}

      <div className="app-toolbar app-venue-filters" role="search" aria-label="Filter venues">
        {eventId ? (
          <label className="app-venue-filter">
            <span className="app-label">People expected</span>
            <input className="app-input" inputMode="numeric" value={headcountText} placeholder="e.g. 40"
              aria-invalid={headcountText !== '' && headcount == null ? true : undefined}
              onChange={(change) => setParam('people', change.target.value)} />
          </label>
        ) : null}
        <label className="app-venue-filter app-venue-filter-wide">
          <span className="app-label">Search</span>
          <input className="app-input" type="search" value={filters.query} placeholder="Name, address, access, equipment"
            onChange={(change) => setParam('q', change.target.value)} />
        </label>
        <label className="app-venue-filter">
          <span className="app-label">Type</span>
          <select className="app-select" value={filters.type} onChange={(change) => setParam('type', change.target.value === 'all' ? '' : change.target.value)}>
            <option value="all">All types</option>
            <option value="nyu_room">NYU rooms</option>
            <option value="outside">Outside venues</option>
          </select>
        </label>
        {!eventId ? (
          <label className="app-venue-filter">
            <span className="app-label">Holds at least</span>
            <input className="app-input" inputMode="numeric" value={params.get('min') ?? ''} placeholder="Any"
              onChange={(change) => setParam('min', change.target.value)} />
          </label>
        ) : null}
        <label className="app-venue-filter">
          <span className="app-label">Sort by</span>
          <select className="app-select" value={filters.sort} onChange={(change) => setParam('sort', change.target.value === 'name' ? '' : change.target.value)}>
            <option value="name">Name</option>
            <option value="capacity">Capacity</option>
            <option value="lastUsed">Recently used</option>
          </select>
        </label>
      </div>
      {headcountText !== '' && headcount == null ? <p className="app-field-error" role="alert">Enter a whole number of people.</p> : null}

      <div className="app-toolbar app-venue-compare-bar">
        <label className="app-meta">
          <input type="checkbox" checked={includeArchived} onChange={(change) => setParam('archived', change.target.checked ? '1' : '')} /> Show archived venues
        </label>
        <span className="app-meta" aria-live="polite">
          {selected.length === 0 ? `Select up to ${MAX_COMPARED_VENUES} venues to compare.` : `${selected.length} selected`}
        </span>
        {selected.length >= 2 ? <Link className="app-btn app-btn-secondary" to={compareHref}>Compare {selected.length} venues</Link> : null}
        {selected.length ? <Button variant="quiet" onClick={() => setSelected([])}>Clear selection</Button> : null}
      </div>
      {linkError ? <p className="app-error-text" role="alert">{linkError}</p> : null}

      {venues.isLoading ? <SkeletonRows /> : null}
      {venues.isError ? <ErrorRetry message={toAppError(venues.error).message} onRetry={() => venues.refetch()} /> : null}
      {venues.data?.length === 0 ? <EmptyState title="No venues yet" body={canManageEvents(workspace.role) ? 'Add the places your team books so you can compare them next time.' : undefined} /> : null}
      {venues.data && venues.data.length > 0 && rows.length === 0 ? (
        <EmptyState title="No venues match these filters" action={filtered ? (
          <Button variant="secondary" onClick={() => {
            const next = new URLSearchParams(params)
            for (const key of ['q', 'type', 'min']) next.delete(key)
            setParams(next, { replace: true })
          }}>Clear filters</Button>
        ) : undefined} />
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="app-table-wrap app-table-desktop app-venue-list">
            <table className="app-table">
              <thead>
                <tr>
                  <th><span className="sr-only">Compare</span></th>
                  <th>Venue</th>
                  <th>Capacity</th>
                  <th>Lead time</th>
                  <th>Past use</th>
                  {eventId ? <th>For this event</th> : null}
                  {canLink ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ venue, fit }) => (
                  <tr key={venue.id}>
                    <td>{selectBox(venue)}</td>
                    <td>
                      <Link to={venue.id}>{venue.name}</Link>
                      <div className="app-meta">
                        {venueTypeLabel(venue.venueType)}{venue.address ? ` · ${venue.address}` : ''}{venue.removedAt ? ' · Archived' : ''}
                      </div>
                    </td>
                    <td className="app-tabular">{venue.capacity ?? '—'}</td>
                    <td className="app-tabular">{venue.leadTimeDays ? `${venue.leadTimeDays} days` : 'None'}</td>
                    <td className="app-meta">{lastUsedLabel(venue)}</td>
                    {eventId ? <td>{fitSummary(venue, fit)}</td> : null}
                    {canLink ? <td>{linkAction(venue, 'quiet')}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="app-stack-mobile">
            {rows.map(({ venue, fit }) => (
              <div key={venue.id} className="app-venue-card">
                <div className="app-venue-card-head">
                  {selectBox(venue)}
                  <Link to={venue.id}>{venue.name}</Link>
                </div>
                <p className="app-meta">
                  {venueTypeLabel(venue.venueType)}
                  {venue.capacity != null ? ` · Holds ${venue.capacity}` : ''}
                  {venue.leadTimeDays ? ` · ${venue.leadTimeDays} days lead time` : ''}
                  {venue.removedAt ? ' · Archived' : ''}
                </p>
                {venue.address ? <p className="app-meta">{venue.address}</p> : null}
                <p className="app-meta">{lastUsedLabel(venue)}</p>
                {fitSummary(venue, fit)}
                {linkAction(venue, 'secondary')}
              </div>
            ))}
            {selected.length >= 2 ? (
              <div className="app-venue-compare-sticky">
                <Link className="app-btn app-btn-primary" to={compareHref}>Compare {selected.length} venues</Link>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {eventId && !venues.isLoading && headcount == null && headcountText === '' ? (
        <p className="app-meta">Enter how many people you expect to check capacity.</p>
      ) : null}
    </div>
  )
}

