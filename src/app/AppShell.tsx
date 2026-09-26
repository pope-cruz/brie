import { Sheet, SheetContent, SheetTitle } from './components/shadcn/sheet'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getWorkspace, listMyWorkspaces, type WorkspaceSummary } from './data/api'
import { toAppError } from './data/errors'
import { canAdminWorkspace, canSeeAttendance } from './data/types'
import { useSession } from './features/auth/SessionProvider'
import { InviteDialog } from './features/workspaces/InviteDialog'
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
  const [inviteOpen, setInviteOpen] = useState(false)
  const menuTrigger = useRef<HTMLElement | null>(null)
  const lastMembership = useRef<{ workspaceId: string; role: string } | null>(null)
  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(user && workspaceId),
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: 'always',
  })
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: listMyWorkspaces,
    enabled: Boolean(user),
  })

  useEffect(() => {
    if (!workspace.data || workspace.isError) return
    const previous = lastMembership.current
    if (previous?.workspaceId === workspaceId && previous.role !== workspace.data.role) {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'workspace' && query.queryKey.includes(workspaceId) })
      if ((!canAdminWorkspace(workspace.data.role) && location.pathname.endsWith('/settings'))
        || (!canSeeAttendance(workspace.data.role) && location.pathname.includes('/people'))) {
        navigate(workspacePath(workspaceId), { replace: true })
      }
    }
    lastMembership.current = { workspaceId, role: workspace.data.role }
  }, [workspace.data, workspace.isError, workspaceId, queryClient, location.pathname, navigate])

  useEffect(() => {
    if (!workspace.isError || lastMembership.current?.workspaceId !== workspaceId) return
    const error = toAppError(workspace.error)
    if (error.code !== 'UNAVAILABLE' || error.message !== 'This page isn’t available.') return
    lastMembership.current = null
    queryClient.removeQueries({ predicate: (query) => query.queryKey.includes(workspaceId) })
    queryClient.setQueryData<WorkspaceSummary[]>(['workspaces'], (rows) => rows?.filter((row) => row.id !== workspaceId))
    void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    if (localStorage.getItem('brie:last-workspace') === workspaceId) localStorage.removeItem('brie:last-workspace')
    navigate('/app', { replace: true })
  }, [workspace.isError, workspace.error, workspaceId, queryClient, navigate])

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
          Go to workspaces
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
  const workspaceOptions = (workspaces.data ?? []).some((item) => item.id === workspace.data.id)
    ? workspaces.data!
    : [...(workspaces.data ?? []), workspace.data]
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
              setMenuOpen(false)
              navigate('/app/new-workspace')
              return
            }
            goToWorkspace(event.target.value)
          }}
        >
          {workspaceOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
          <option value="__create">Create workspace</option>
        </select>
        {canAdminWorkspace(role) ? (
          <Button variant="secondary" onClick={() => { setMenuOpen(false); setInviteOpen(true) }}>
            Invite teammate
          </Button>
        ) : null}
      </div>
      <nav className="app-nav" aria-label="Workspace">
        <NavLink className="app-nav-item" to={workspacePath(workspaceId, 'home')}>
          Home
        </NavLink>
        <NavLink className="app-nav-item" to={workspacePath(workspaceId, 'events')}>
          Events
        </NavLink>
        {canSeeAttendance(role) ? (
          <NavLink className="app-nav-item" to={workspacePath(workspaceId, 'people')}>
            People
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
      {inviteOpen ? <InviteDialog workspaceId={workspace.data.id} workspaceName={workspace.data.name} onClose={() => setInviteOpen(false)} /> : null}
      {!menuOpen ? <aside className="app-sidebar">{nav}</aside> : null}
      {menuOpen ? <Sheet open onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="app-mobile-navigation" aria-describedby={undefined} showCloseButton={false}
          onCloseAutoFocus={(event) => { event.preventDefault(); menuTrigger.current?.focus() }}>
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <Button variant="quiet" onClick={() => setMenuOpen(false)}>Close menu</Button>
          <div className="app-navigation-content" onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) setMenuOpen(false)
          }}>{nav}</div>
        </SheetContent>
      </Sheet> : null}
      <div className="app-main">
        <div className="app-mobile-bar">
          <Button variant="quiet" aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => { menuTrigger.current = document.activeElement as HTMLElement; setMenuOpen(true) }}>
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
