import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { EmptyState, ErrorRetry, SkeletonRows, StatusBadge } from '../../components/ui'
import { listPlanDrafts } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type PlanDraft } from '../../data/types'
import { formatInZone, formatTimeRange } from '../../lib/timezone'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'

export function DraftStatus({ status }: { status: PlanDraft['status'] }) {
  if (status === 'pending') return <StatusBadge tone="warning">Waiting for review</StatusBadge>
  if (status === 'accepted') return <StatusBadge tone="done">Accepted</StatusBadge>
  return <StatusBadge>Discarded</StatusBadge>
}

export function DraftListPage() {
  const workspace = useCurrentWorkspace()
  const [params, setParams] = useSearchParams()
  const includeDecided = params.get('all') === '1'
  const allowed = canManageEvents(workspace.role)
  const drafts = useQuery({
    queryKey: ['plan-drafts', workspace.id, includeDecided],
    queryFn: () => listPlanDrafts(workspace.id, includeDecided),
    enabled: allowed,
  })

  if (!allowed) {
    return <div className="app-page"><h1 className="app-h1">This page isn’t available</h1></div>
  }

  return (
    <div className="app-page">
      <h1 className="app-h1">Drafts</h1>
      <p className="app-lede">Event plans proposed by assistants. Nothing is added to your events until you review and accept a draft.</p>
      <div className="app-toolbar">
        <label className="app-meta">
          <input type="checkbox" checked={includeDecided} onChange={(change) => setParams(change.target.checked ? { all: '1' } : {}, { replace: true })} /> Show reviewed drafts
        </label>
        <Link className="app-meta" to={`/app/w/${workspace.id}/assistant`}>Assistant access</Link>
      </div>
      {drafts.isLoading ? <SkeletonRows count={3} /> : null}
      {drafts.isError ? <ErrorRetry message={toAppError(drafts.error).message} onRetry={() => drafts.refetch()} /> : null}
      {drafts.data?.length === 0 ? (
        <EmptyState
          title={includeDecided ? 'No drafts yet' : 'No drafts waiting for review'}
          body="Create an assistant key that can propose drafts, then ask your assistant to plan an event from your past ones."
        />
      ) : null}
      {drafts.data?.map((draft) => (
        <div key={draft.id} className="app-draft-row">
          <div className="app-draft-row-main">
            <p className="app-draft-title"><Link to={draft.id}>{draft.title}</Link> <DraftStatus status={draft.status} /></p>
            <p className="app-meta app-tabular">{formatTimeRange(draft.startsAt, draft.endsAt, draft.timezone)}</p>
            <p className="app-meta">
              {draft.todos.length} to-dos · {draft.schedule.length} schedule items · {draft.assumptions.length} assumption{draft.assumptions.length === 1 ? '' : 's'} to check
              {draft.citedEvents.length ? ` · based on ${draft.citedEvents.length} past event${draft.citedEvents.length === 1 ? '' : 's'}` : ''}
            </p>
            <p className="app-meta">Proposed {formatInZone(draft.createdAt, workspace.timezone)} with “{draft.keyLabel}” ({draft.proposedByName})</p>
          </div>
        </div>
      ))}
    </div>
  )
}
