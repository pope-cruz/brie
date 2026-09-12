import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, ErrorRetry } from '../../components/ui'
import { acceptInvitation, peekInvitation } from '../../data/api'
import { toAppError } from '../../data/errors'
import { roleLabel } from '../../data/types'
import { rememberWorkspace, workspacePath } from '../../lib/paths'
import { useSession } from '../auth/SessionProvider'

export function InvitePage() {
  const { token = '' } = useParams()
  const { user, loading, signOut } = useSession()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const peek = useQuery({
    queryKey: ['invite', token],
    queryFn: () => peekInvitation(token),
    enabled: Boolean(token),
    retry: false,
  })

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const result = await acceptInvitation(token)
      rememberWorkspace(result.workspaceId)
      navigate(workspacePath(result.workspaceId), { replace: true })
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-entry">
      <div className="app-entry-card">
        <Link to="/" className="app-wordmark">
          brie
        </Link>
        <h1 className="app-h1">Join a workspace</h1>
        {peek.isLoading ? <p className="app-lede">Checking this invitation…</p> : null}
        {peek.isError ? (
          <ErrorRetry
            message={toAppError(peek.error).message}
            onRetry={() => peek.refetch()}
          />
        ) : null}
        {peek.data ? (
          <>
            <p className="app-lede">
              You’re invited to {peek.data.workspaceName} as {roleLabel(peek.data.role)}. Invitation
              sent to {peek.data.emailMasked}.
            </p>
            {loading ? <p role="status">Checking your account…</p> : !user ? (
              <Button onClick={() => navigate(`/app/sign-in?return=${encodeURIComponent(`/app/invite/${token}`)}`)}>
                Sign in to accept
              </Button>
            ) : (
              <>
                <p className="app-lede">Signed in as {user.email}.</p>
                {error ? <p role="alert" className="app-error-text">{error}</p> : null}
                <div className="app-toolbar">
                  <Button busy={busy} onClick={accept}>
                    Accept invitation
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => navigate('/app', { replace: true })}>
                    Decline
                  </Button>
                  <Button variant="quiet" disabled={busy} onClick={async () => {
                    setBusy(true)
                    setError(null)
                    try {
                      await signOut()
                      navigate(`/app/sign-in?return=${encodeURIComponent(`/app/invite/${token}`)}`, { replace: true })
                    } catch { setError('Couldn’t switch accounts. Check your connection and try again.') }
                    finally { setBusy(false) }
                  }}>Sign in with another email</Button>
                </div>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
