import { useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, ErrorRetry, Field } from '../../components/ui'
import { connectAssistant, listMyWorkspaces } from '../../data/api'
import { getSupabase } from '../../data/client'
import { canManageEvents, type AssistantScope } from '../../data/types'
import { scopeLabel } from '../../lib/assistantAccess'
import { useSession } from './SessionProvider'

const ACCOUNT_PERMISSIONS: Record<string, string> = {
  openid: 'your account identity', email: 'your email address', profile: 'your name and profile',
  phone: 'your phone number', offline_access: 'stay connected between sessions',
}

export function ConnectAssistantPage() {
  const { configured, user, loading } = useSession()
  const [params] = useSearchParams()
  const authorizationId = params.get('authorization_id') ?? ''
  const [workspaceId, setWorkspaceId] = useState('')
  const [scope, setScope] = useState<AssistantScope>('read')
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const details = useQuery({
    queryKey: ['assistant-authorization', user?.id, authorizationId],
    enabled: Boolean(user && authorizationId), retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabase().auth.oauth.getAuthorizationDetails(authorizationId)
      if (error || !data) throw new Error('This connection request has expired or isn’t available. Start again from your assistant.')
      return data
    },
  })
  const workspaces = useQuery({ queryKey: ['workspaces', user?.id], queryFn: listMyWorkspaces, enabled: Boolean(user && authorizationId) })
  const available = workspaces.data?.filter((workspace) => canManageEvents(workspace.role)) ?? []
  const selected = workspaceId || available[0]?.id || ''
  const request = details.data && 'authorization_id' in details.data ? details.data : null

  async function decide(approve: boolean) {
    if (pending.current || !request || (approve && !selected)) return
    pending.current = true; setBusy(approve ? 'approve' : 'deny'); setError(null)
    try {
      if (approve) await connectAssistant(selected, request.client.id, request.client.name.slice(0, 80) || 'Assistant', scope)
      const oauth = getSupabase().auth.oauth
      const { data, error: decisionError } = approve
        ? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
      if (decisionError || !data) throw new Error('Couldn’t finish connecting. Try again, or start a new connection from your assistant.')
      window.location.assign(data.redirect_url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Couldn’t finish connecting. Try again.')
    } finally { pending.current = false; setBusy(null) }
  }

  if (loading) return <div className="app-entry"><p role="status">Loading…</p></div>
  if (configured && authorizationId && !user) {
    return <Navigate to={`/app/sign-in?return=${encodeURIComponent(`/app/connect-assistant?${params.toString()}`)}`} replace />
  }

  return <div className="app-entry"><div className="app-entry-card">
    <Link to="/" className="app-wordmark">brie</Link>
    <h1 className="app-h1">Connect your assistant</h1>
    {!configured ? <p className="app-lede">Sign-in isn’t available for this Brie installation yet.</p>
      : !authorizationId ? <>
        <p className="app-lede">Start the connection in your assistant’s settings. Brie will bring you here to sign in and choose a workspace.</p>
        <Link className="app-text-link" to="/app">Go to Brie</Link>
      </> : details.isPending || workspaces.isPending ? <p role="status">Loading connection details…</p>
        : details.isError || workspaces.isError ? <ErrorRetry
          message={details.isError ? details.error.message : 'Couldn’t load your workspaces. Try again.'}
          onRetry={() => { void details.refetch(); void workspaces.refetch() }} />
          : details.data && 'redirect_url' in details.data ? <>
            <p className="app-lede">You’ve already approved this assistant. Continue to return to it, or open Brie to manage its access.</p>
            <Button onClick={() => window.location.assign(details.data && 'redirect_url' in details.data ? details.data.redirect_url : '/app')}>Continue to assistant</Button>
            <p className="app-meta"><Link to="/app">Manage access in Brie</Link></p>
          </> : request ? <>
            <p className="app-lede"><strong>{request.client.name || 'This assistant'}</strong> wants to connect to Brie.</p>
            <p className="app-meta app-connect-account">Signed in as {user?.email}</p>
            <p className="app-meta app-connect-account">Returns to {request.redirect_uri}</p>
            {request.scope.trim() ? <p className="app-meta">Also requests: {request.scope.trim().split(/\s+/).map((permission) => ACCOUNT_PERMISSIONS[permission] ?? permission).join(', ')}.</p> : null}
            {available.length ? <form onSubmit={(event) => { event.preventDefault(); void decide(true) }}>
              <Field label="Workspace">
                <select className="app-select" value={selected} disabled={Boolean(busy)} onChange={(event) => setWorkspaceId(event.target.value)}>
                  {available.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                </select>
              </Field>
              <Field label="Allow this assistant to">
                <select className="app-select" value={scope} disabled={Boolean(busy)} onChange={(event) => setScope(event.target.value as AssistantScope)}>
                  <option value="read">{scopeLabel('read')}</option>
                  <option value="read_draft">{scopeLabel('read_draft')}</option>
                </select>
              </Field>
              <ul className="app-connect-permissions">
                <li>Read event plans, schedules, venues, and attendance totals in this workspace.</li>
                {scope === 'read_draft' ? <li>Propose draft plans for you to review and accept in Brie.</li> : null}
                <li>Attendee names and contact details stay private.</li>
              </ul>
              <p className="app-meta">Access lasts up to one year. Revoke it anytime under Assistant access. Connecting again replaces this assistant’s previous workspace access.</p>
              {error ? <p className="app-error-text" role="alert">{error}</p> : null}
              <div className="app-toolbar">
                <Button type="submit" busy={busy === 'approve'} busyLabel="Connecting…" disabled={Boolean(busy)}>Connect assistant</Button>
                <Button type="button" variant="secondary" busy={busy === 'deny'} busyLabel="Canceling…" disabled={Boolean(busy)} onClick={() => void decide(false)}>Cancel</Button>
              </div>
            </form> : <>
              <p className="app-lede">You need to be an owner or organizer of a workspace to connect an assistant.</p>
              {error ? <p className="app-error-text" role="alert">{error}</p> : null}
              <Button variant="secondary" busy={busy === 'deny'} onClick={() => void decide(false)}>Cancel connection</Button>
              <p className="app-meta"><Link to="/app">Go to your workspaces</Link></p>
            </>}
          </> : null}
  </div></div>
}
