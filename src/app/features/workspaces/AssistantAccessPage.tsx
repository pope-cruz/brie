import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ConfirmDialog, EmptyState, ErrorRetry, Field, SkeletonRows, StatusBadge } from '../../components/ui'
import { createAssistantToken, listAssistantActions, listAssistantTokens, revokeAssistantToken } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type AssistantScope, type AssistantToken } from '../../data/types'
import {
  KEY_LIFETIMES,
  claudeCodeCommand,
  describeAction,
  mcpServerUrl,
  outcomeLabel,
  scopeLabel,
} from '../../lib/assistantAccess'
import { formatInZone } from '../../lib/timezone'
import { useCurrentWorkspace } from './workspaceContext'

function when(iso: string | null, timeZone: string) {
  return iso ? formatInZone(iso, timeZone) : 'Never'
}

export function AssistantAccessPage() {
  const workspace = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const allowed = canManageEvents(workspace.role)
  const tokens = useQuery({
    queryKey: ['assistant-tokens', workspace.id],
    queryFn: () => listAssistantTokens(workspace.id),
    enabled: allowed,
  })
  const actions = useQuery({
    queryKey: ['assistant-actions', workspace.id],
    queryFn: () => listAssistantActions(workspace.id, 50),
    enabled: allowed,
  })
  const [label, setLabel] = useState('')
  const [scope, setScope] = useState<AssistantScope>('read')
  const [lifetime, setLifetime] = useState(30)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ label: string; secret: string } | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [revoking, setRevoking] = useState<AssistantToken | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  if (!allowed) {
    return (
      <div className="app-page">
        <h1 className="app-h1">This page isn’t available</h1>
      </div>
    )
  }

  const serverUrl = mcpServerUrl(import.meta.env.VITE_SUPABASE_URL ?? '')

  async function create() {
    if (!label.trim()) { setError('Name the key so you can recognize it later.'); return }
    setCreating(true); setError(null); setCopyStatus('')
    try {
      const result = await createAssistantToken(workspace.id, label.trim(), scope, lifetime)
      setCreated({ label: result.label, secret: result.secret })
      setLabel('')
      await queryClient.invalidateQueries({ queryKey: ['assistant-tokens', workspace.id] })
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setCreating(false)
    }
  }

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); setCopyStatus(`${what} copied.`) }
    catch { setCopyStatus('Couldn’t copy automatically. Select the text above and copy it manually.') }
  }

  async function revoke() {
    if (!revoking) return
    setRevokeBusy(true); setRevokeError(null)
    try {
      await revokeAssistantToken(workspace.id, revoking.id)
      setRevoking(null)
      await queryClient.invalidateQueries({ queryKey: ['assistant-tokens', workspace.id] })
    } catch (caught) {
      setRevokeError(toAppError(caught).message)
    } finally {
      setRevokeBusy(false)
    }
  }

  return (
    <div className="app-page">
      <h1 className="app-h1">Assistant access</h1>
      <p className="app-lede">
        Let an AI assistant such as Claude read this workspace’s event plans, schedules, and venues through MCP. Keys never expose attendee names or contact details. An assistant can’t change anything in Brie; with draft access it can propose event plans for you to review.
      </p>

      <section aria-labelledby="new-key" className="app-page-narrow" style={{ marginTop: 24 }}>
        <h2 id="new-key" className="app-section-title">Create a key</h2>
        <p className="app-meta">A key acts as you, with your current role. If you stop being an owner or organizer here, it stops working.</p>
        <Field label="Name">
          <input className="app-input" value={label} maxLength={80} placeholder="e.g. Claude on my laptop" onChange={(change) => setLabel(change.target.value)} />
        </Field>
        <Field label="Access">
          <select className="app-select" value={scope} onChange={(change) => setScope(change.target.value as AssistantScope)}>
            <option value="read">{scopeLabel('read')}</option>
            <option value="read_draft">{scopeLabel('read_draft')}</option>
          </select>
        </Field>
        {scope === 'read_draft' ? <p className="app-meta" style={{ marginTop: -8, marginBottom: 16 }}>Drafts wait under Drafts for an owner or organizer to review. Nothing is created until someone accepts one.</p> : null}
        <Field label="Expires after">
          <select className="app-select" value={lifetime} onChange={(change) => setLifetime(Number(change.target.value))}>
            {KEY_LIFETIMES.map((option) => <option key={option.days} value={option.days}>{option.label}</option>)}
          </select>
        </Field>
        {error ? <p className="app-error-text" role="alert">{error}</p> : null}
        <Button busy={creating} busyLabel="Creating…" onClick={() => void create()}>Create key</Button>
      </section>

      {created ? (
        <section aria-labelledby="new-secret" className="app-assistant-secret" role="region">
          <h2 id="new-secret" className="app-section-title">Copy “{created.label}” now</h2>
          <p className="app-meta">This is the only time Brie shows this key. Store it like a password. If you lose it, revoke it and create another.</p>
          <Field label="Key">
            <input className="app-input app-mono" readOnly value={created.secret} onFocus={(focus) => focus.target.select()} />
          </Field>
          <Field label="Add to Claude Code" hint={`Server: ${serverUrl}`}>
            <textarea className="app-textarea app-mono" readOnly rows={3} value={claudeCodeCommand(serverUrl, created.secret)} onFocus={(focus) => focus.target.select()} />
          </Field>
          <div className="app-toolbar" style={{ marginTop: 0 }}>
            <Button variant="secondary" onClick={() => void copy(created.secret, 'Key')}>Copy key</Button>
            <Button variant="secondary" onClick={() => void copy(claudeCodeCommand(serverUrl, created.secret), 'Command')}>Copy command</Button>
            <Button variant="quiet" onClick={() => { setCreated(null); setCopyStatus('') }}>I’ve saved it</Button>
          </div>
          <p role="status" className="app-meta">{copyStatus}</p>
        </section>
      ) : null}

      <section aria-labelledby="keys" style={{ marginTop: 32 }}>
        <h2 id="keys" className="app-section-title">Keys</h2>
        {workspace.role === 'owner' ? <p className="app-meta">As owner, you see and can revoke every key in this workspace.</p> : null}
        {tokens.isLoading ? <SkeletonRows count={2} /> : null}
        {tokens.isError ? <ErrorRetry message={toAppError(tokens.error).message} onRetry={() => tokens.refetch()} /> : null}
        {tokens.data?.length === 0 ? <EmptyState title="No keys yet" /> : null}
        {tokens.data?.map((token) => (
          <div key={token.id} className="app-assistant-row">
            <div className="app-assistant-row-main">
              <p>
                <strong>{token.label}</strong>{' '}
                <StatusBadge tone={token.status === 'active' ? 'done' : 'neutral'}>
                  {token.status === 'active' ? 'Active' : token.status === 'expired' ? 'Expired' : 'Revoked'}
                </StatusBadge>
              </p>
              <p className="app-meta">
                <span className="app-mono">{token.prefix}…</span> · {scopeLabel(token.scope)} · Created by {token.createdByName}
              </p>
              <p className="app-meta">
                Last used {when(token.lastUsedAt, workspace.timezone)} · {token.status === 'revoked' ? `Revoked ${when(token.revokedAt, workspace.timezone)}` : `${token.status === 'expired' ? 'Expired' : 'Expires'} ${when(token.expiresAt, workspace.timezone)}`}
              </p>
            </div>
            {token.status === 'active' ? (
              <Button variant="secondary" aria-label={`Revoke ${token.label}`} onClick={() => { setRevokeError(null); setRevoking(token) }}>Revoke</Button>
            ) : null}
          </div>
        ))}
      </section>

      <section aria-labelledby="activity" style={{ marginTop: 32 }}>
        <h2 id="activity" className="app-section-title">Recent assistant activity</h2>
        {actions.isLoading ? <SkeletonRows count={3} /> : null}
        {actions.isError ? <ErrorRetry message={toAppError(actions.error).message} onRetry={() => actions.refetch()} /> : null}
        {actions.data?.length === 0 ? <p className="app-meta">No assistant has used a key yet.</p> : null}
        {actions.data?.length ? (
          <ul className="app-assistant-activity">
            {actions.data.map((action) => (
              <li key={action.id}>
                <span>{describeAction(action)}</span>
                <span className="app-meta"> · {action.tokenLabel} · {formatInZone(action.createdAt, workspace.timezone)} · {outcomeLabel(action.outcome)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {revoking ? (
        <ConfirmDialog
          title={`Revoke “${revoking.label}”?`}
          body={revokeError ?? 'Any assistant using this key loses access on its next request. This can’t be undone; create a new key to reconnect.'}
          actionLabel="Revoke key"
          danger
          pending={revokeBusy}
          onCancel={() => setRevoking(null)}
          onConfirm={() => void revoke()}
        />
      ) : null}
    </div>
  )
}
