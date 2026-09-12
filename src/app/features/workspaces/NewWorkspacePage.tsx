import { TimeZonePicker } from '../../components/TimeZonePicker'
import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button, Field } from '../../components/ui'
import { createWorkspace } from '../../data/api'
import { toAppError } from '../../data/errors'
import { useSession } from '../auth/SessionProvider'
import { clearRequestKey, getRequestKey } from '../../lib/idempotency'
import { rememberWorkspace, workspacePath } from '../../lib/paths'
import { defaultTimeZone } from '../../lib/timezone'

export function NewWorkspacePage() {
  const { user, loading } = useSession()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState(
    () => user?.user_metadata?.display_name || user?.email?.split('@')[0] || '',
  )
  const [timezone, setTimezone] = useState(defaultTimeZone)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  if (loading) return <div className="app-entry"><p role="status">Loading…</p></div>

  if (!user) {
    return <Navigate to="/app/sign-in?return=/app/new-workspace" replace />
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const result = await createWorkspace({
        name,
        timezone,
        displayName,
        requestKey: getRequestKey('create_workspace'),
      })
      clearRequestKey('create_workspace')
      rememberWorkspace(result.workspace.id)
      navigate(workspacePath(result.workspace.id))
    } catch (caught) {
      const appError = toAppError(caught)
      setErrors({ form: appError.message, ...appError.fields })
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
        <h1 className="app-h1">Create a workspace</h1>
        <p className="app-lede">Name the organizing team and choose the default time zone. Joining an existing team? Open the invitation link from its owner.</p>
        <form onSubmit={onSubmit}>
          <Field label="Workspace name" error={errors.name}>
            <input className="app-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
          </Field>
          <Field label="Your display name" error={errors.displayName}>
            <input
              className="app-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              required
            />
          </Field>
          <Field label="Default time zone" error={errors.timezone}>
            <TimeZonePicker value={timezone} onChange={setTimezone} />
          </Field>
          {errors.form ? <p className="app-error-text">{errors.form}</p> : null}
          <Button type="submit" busy={busy}>
            Create workspace
          </Button>
        </form>
      </div>
    </div>
  )
}
