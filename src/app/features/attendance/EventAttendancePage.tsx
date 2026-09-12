import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, EmptyState, Pagination, SkeletonRows, StatusBadge } from '../../components/ui'
import { listEventImports, listEventPeople } from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { canSeeAttendance, type EventRecord } from '../../data/types'
import { SEARCH_DEBOUNCE_MS } from '../../lib/search'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { useState } from 'react'

export function EventAttendancePage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'imports' ? 'imports' : 'people'
  const query = params.get('q') || ''
  const page = Number(params.get('page') || '1')
  const [draft, setDraft] = useState(query)
  const debounced = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS)

  const allowed = canSeeAttendance(workspace.role)
  const people = useQuery({
    queryKey: ['event-people', workspace.id, event.id, debounced, page],
    queryFn: () => listEventPeople(workspace.id, event.id, debounced, page),
    enabled: allowed && view === 'people',
  })
  const imports = useQuery({
    queryKey: ['event-imports', workspace.id, event.id],
    queryFn: () => listEventImports(workspace.id, event.id),
    enabled: allowed && view === 'imports',
  })

  if (!allowed) {
    return <p className="app-lede">Ask an organizer to manage attendance.</p>
  }

  return (
    <div>
      <div className="app-header-row" style={{ marginTop: 16 }}>
        <div>
          <h2 className="app-section-title">Attendance</h2>
          <p className="app-meta">
            {event.attendanceCount ?? 0} distinct attendees recorded
          </p>
        </div>
        <Link className="app-btn app-btn-primary" to={`/app/w/${workspace.id}/events/${event.id}/attendance/import`}>
          Import CSV
        </Link>
      </div>
      <div className="app-toolbar">
        <Button variant={view === 'people' ? 'primary' : 'secondary'} onClick={() => setParams({ view: 'people' })}>
          People
        </Button>
        <Button variant={view === 'imports' ? 'primary' : 'secondary'} onClick={() => setParams({ view: 'imports' })}>
          Imports
        </Button>
        {view === 'people' ? (
          <input
            className="app-input"
            style={{ maxWidth: 260 }}
            value={draft}
            placeholder="Search names or emails"
            onChange={(event) => {
              setDraft(event.target.value)
              setParams({ view: 'people', q: event.target.value, page: '1' })
            }}
          />
        ) : null}
      </div>
      {view === 'people' && people.isLoading ? <SkeletonRows /> : null}
      {view === 'people' && people.data?.rows.length === 0 ? (
        <EmptyState
          title={query ? 'No attendance matches these filters' : 'No attendance recorded'}
          action={
            query ? (
              <Button variant="secondary" onClick={() => setParams({ view: 'people' })}>
                Clear search
              </Button>
            ) : (
              <Link className="app-btn app-btn-primary" to={`/app/w/${workspace.id}/events/${event.id}/attendance/import`}>
                Import CSV
              </Link>
            )
          }
        />
      ) : null}
      {view === 'people'
        ? people.data?.rows.map((person) => (
            <div key={person.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--app-border)' }}>
              <Link to={`/app/w/${workspace.id}/attendance/${person.id}`}>
                {person.name || 'Name not provided'}
              </Link>
              <p className="app-meta">{person.email}</p>
            </div>
          ))
        : null}
      {view === 'people' && people.data ? (
        <Pagination
          page={people.data.page}
          total={people.data.total}
          onPage={(next) => setParams({ view: 'people', q: query, page: String(next) })}
        />
      ) : null}
      {view === 'imports' && imports.data?.length === 0 ? (
        <EmptyState title="Your imports will appear here." />
      ) : null}
      {view === 'imports'
        ? imports.data?.map((batch) => (
            <div key={batch.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--app-border)' }}>
              <Link to={`/app/w/${workspace.id}/events/${event.id}/attendance/imports/${batch.id}`}>
                {batch.fileLabel}
              </Link>
              <p className="app-meta">
                {new Date(batch.committedAt).toLocaleString()} · {batch.importedBy} · {batch.added} added
              </p>
              <StatusBadge tone={batch.status === 'reverted' ? 'warning' : 'done'}>
                {batch.status === 'reverted' ? 'Reverted' : 'Active'}
              </StatusBadge>
            </div>
          ))
        : null}
    </div>
  )
}
