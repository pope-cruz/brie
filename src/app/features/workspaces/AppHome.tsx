import { ErrorRetry } from '../../components/ui'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listMyWorkspaces } from '../../data/api'
import { lastWorkspace, workspacePath } from '../../lib/paths'
import { useSession } from '../auth/SessionProvider'

export function AppHome() {
  const { user, loading } = useSession()
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: listMyWorkspaces,
    enabled: Boolean(user),
  })

  if (loading || workspaces.isLoading) {
    return (
      <div className="app-entry">
        <p>Loading…</p>
      </div>
    )
  }
  if (!user) return <Navigate to="/app/sign-in?return=/app" replace />
  if (workspaces.isError) return <div className="app-entry"><ErrorRetry
    message="Couldn’t load your workspaces. Check your connection and try again."
    onRetry={() => workspaces.refetch()}
  /></div>
  const rows = workspaces.data ?? []
  if (rows.length === 0) return <Navigate to="/app/new-workspace" replace />
  const remembered = lastWorkspace()
  const chosen = rows.find((row) => row.id === remembered) ?? rows[0]
  return <Navigate to={workspacePath(chosen.id)} replace />
}
