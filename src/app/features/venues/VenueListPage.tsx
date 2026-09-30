import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { EmptyState, ErrorRetry, SkeletonRows } from '../../components/ui'
import { listVenues } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents } from '../../data/types'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'

export function VenueListPage() {
  const workspace = useCurrentWorkspace()
  const [includeArchived, setIncludeArchived] = useState(false)
  const venues = useQuery({
    queryKey: ['venues', workspace.id, includeArchived],
    queryFn: () => listVenues(workspace.id, includeArchived),
  })
  return (
    <div className="app-page">
      <div className="app-header-row">
        <div>
          <h1 className="app-h1">Venues</h1>
          <p className="app-lede">Places your workspace uses for events.</p>
        </div>
        {canManageEvents(workspace.role) ? <Link className="app-btn app-btn-primary" to="new">Add venue</Link> : null}
      </div>
      <label className="app-meta"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Show archived venues</label>
      {venues.isLoading ? <SkeletonRows /> : null}
      {venues.isError ? <ErrorRetry message={toAppError(venues.error).message} onRetry={() => venues.refetch()} /> : null}
      {venues.data?.length === 0 ? <EmptyState title="No venues yet" /> : null}
      {venues.data?.map((venue) => (
        <div key={venue.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--app-border)' }}>
          <Link to={venue.id}>{venue.name}</Link>
          <p className="app-meta">
            {venue.venueType === 'nyu_room' ? 'NYU room' : 'Outside venue'}
            {venue.capacity != null ? ` · Capacity ${venue.capacity}` : ''}
            {venue.address ? ` · ${venue.address}` : ''}
            {venue.removedAt ? ' · Archived' : ''}
          </p>
        </div>
      ))}
    </div>
  )
}
