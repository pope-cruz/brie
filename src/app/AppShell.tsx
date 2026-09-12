import { useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getWorkspace, listMyWorkspaces } from './data/api'
import { toAppError } from './data/errors'
import { canAdminWorkspace, canSeeAttendance } from './data/types'
import { useSession } from './features/auth/SessionProvider'
import { rememberWorkspace, workspacePath } from './lib/paths'
import { Button, ErrorRetry } from './components/ui'

export function AppShell() {
  const { workspaceId = '' } = useParams()
  const { user, loading, signOut } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  async function leave() {
    setSigningOut(true)
    setSignOutError(null)
    try { await signOut(); navigate('/app/sign-in', { replace: true }) }
    catch { setSignOutError('Couldn’t sign out. Check your connection and try again.') }
    finally { setSigningOut(false) }
  }
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(user && workspaceId),
    retry: false,
  })
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: listMyWorkspaces,
    enabled: Boolean(user),
  })

  if (loading) {
    return (
      <div className="app-shell">
        <div className="app-page">Loading workspace…</div>
      </div>
    )
  }
  if (!user) {
    return <Navigate to={`/app/sign-in?return=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />
  }
  if (workspace.isError) {
    return (
      <div className="app-page">
        <h1 className="app-h1">This page isn’t available</h1>
        <p className="app-lede">{toAppError(workspace.error).message}</p>
        <ErrorRetry message="Reload workspace or choose another one." onRetry={() => workspace.refetch()} />
        <Button variant="secondary" onClick={() => navigate('/app')}>
          Go to events
        </Button>
      </div>
    )
  }
  if (!workspace.data) {
    return (
      <div className="app-shell">
        <aside className="app-sidebar" aria-busy>
          <div className="app-skeleton" />
        </aside>
      </div>
    )
  }

  const role = workspace.data.role
  rememberWorkspace(workspace.data.id)

  function goToWorkspace(id: string) {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'workspaces' })
    rememberWorkspace(id)
    setMenuOpen(false)
    navigate(workspacePath(id))
  }

  const nav = (
    <>
      <div className="app-sidebar-brand">
        <Link to="/" className="app-wordmark">
          brie
        </Link>
        <label className="app-meta" htmlFor="workspace-switcher">
          Workspace
        </label>
        <select
          id="workspace-switcher"
          className="app-select"
          value={workspace.data.id}
          onChange={(event) => {
            if (event.target.value === '__create') {
              navigate('/app/new-workspace')
              return
            }
            goToWorkspace(event.target.value)
          }}
        >
          {(workspaces.data ?? [workspace.data]).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
          <option value="__create">Create workspace</option>
        </select>
      </div>
      <nav className="app-nav" aria-label="Workspace">
        <NavLink className="app-nav-item" to={workspacePath(workspaceId, 'events')}>
          Events
        </NavLink>
        <NavLink className="app-nav-item" to={workspacePath(workspaceId, 'tasks')}>
          Tasks
        </NavLink>
        {canSeeAttendance(role) ? (
          <NavLink className="app-nav-item" to={workspacePath(workspaceId, 'attendance')}>
            Attendance
          </NavLink>
        ) : null}
      </nav>
      <div className="app-sidebar-footer">
        {canAdminWorkspace(role) ? (
          <NavLink className="app-nav-item" to={workspacePath(workspaceId, 'settings')}>
            Settings
          </NavLink>
        ) : null}
        <p className="app-meta" style={{ padding: '8px' }}>
          {workspace.data.displayName || user.email}
        </p>
        <button
          className="app-account-button"
          disabled={signingOut}
          onClick={leave}
        >
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="app-shell">
      {menuOpen ? <div className="app-drawer-backdrop" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={`app-sidebar${menuOpen ? ' app-sidebar-open' : ''}`}>{nav}</aside>
      <div className="app-main">
        <div className="app-mobile-bar">
          <Button variant="quiet" onClick={() => setMenuOpen(true)}>
            Menu
          </Button>
          <strong>{workspace.data.name}</strong>
          <Button
            variant="quiet"
            busy={signingOut}
            onClick={leave}
          >
            Sign out
          </Button>
        </div>
        {signOutError ? <p className="app-banner" role="alert">{signOutError}</p> : null}
        <Outlet context={workspace.data} />
      </div>
    </div>
  )
}
