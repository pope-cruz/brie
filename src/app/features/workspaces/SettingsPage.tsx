import { TimeZonePicker } from '../../components/TimeZonePicker'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ConfirmDialog, ErrorRetry, Field, SkeletonRows } from '../../components/ui'
import {
  changeMemberRole,
  listTeam,
  removeMember,
  revokeInvitation,
  saveWorkspace,
  transferOwnership,
} from '../../data/api'
import { toAppError } from '../../data/errors'
import { canAdminWorkspace, roleLabel, type MemberRole } from '../../data/types'
import { useCurrentWorkspace } from './workspaceContext'
import { InviteFields, InviteLink, useInvitation } from './InviteForm'

export function SettingsPage() {
  const workspace = useCurrentWorkspace()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'team' ? 'team' : 'general'
  const team = useQuery({
    queryKey: ['team', workspace.id],
    queryFn: () => listTeam(workspace.id),
    enabled: canAdminWorkspace(workspace.role),
  })
  const [name, setName] = useState(workspace.name)
  const [timezone, setTimezone] = useState(workspace.timezone)
  const invitation = useInvitation(workspace.id)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [transferId, setTransferId] = useState<string | null>(null)

  async function teamAction(action: () => Promise<unknown>, success: string) {
    if (busy) return false
    setBusy(true); setError(null); setNotice('')
    try {
      await action()
      setNotice(success)
      await Promise.all(['team', 'workspace', 'workspaces'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
      return true
    } catch (caught) { setError(toAppError(caught).message); return false }
    finally { setBusy(false) }
  }

  if (!canAdminWorkspace(workspace.role)) {
    return (
      <div className="app-page">
        <h1 className="app-h1">This page isn’t available</h1>
      </div>
    )
  }

  const members = team.data?.members ?? []
  const invitations = team.data?.invitations ?? []
  const owner = members.find((member) => member.role === 'owner' && !member.removedAt)

  return (
    <div className="app-page">
      <h1 className="app-h1">Settings</h1>
      {notice ? <p role="status" className="app-banner">{notice}</p> : null}
      <div className="app-tabs">
        <button className="app-tab" aria-selected={tab === 'general'} onClick={() => setParams({ tab: 'general' })}>
          General
        </button>
        <button className="app-tab" aria-selected={tab === 'team'} onClick={() => setParams({ tab: 'team' })}>
          Team
        </button>
      </div>
      {tab === 'general' ? (
        <form
          className="app-page-narrow"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError(null)
            try {
              await saveWorkspace(workspace.id, name, timezone, workspace.version)
              setNotice('Workspace settings saved.')
              queryClient.invalidateQueries({ queryKey: ['workspace', workspace.id] })
              queryClient.invalidateQueries({ queryKey: ['workspaces'] })
            } catch (caught) {
              setError(toAppError(caught).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field label="Workspace name">
            <input className="app-input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Default time zone" hint="This only affects events created after you save.">
            <TimeZonePicker value={timezone} onChange={setTimezone} />
          </Field>
          {error ? <p className="app-error-text" role="alert">{error}</p> : null}
          <Button type="submit" busy={busy}>
            Save
          </Button>
        </form>
      ) : (
        <div>
          <h2 className="app-section-title">Invite teammate</h2>
          <p className="app-lede">Brie emails your teammate a link to join. You can also copy the link and share it yourself.</p>
          <div className="app-page-narrow">
            <InviteFields invitation={invitation} />
            {invitation.error ? <p className="app-error-text" role="alert">{invitation.error}</p> : null}
            {invitation.result ? <InviteLink key={invitation.result.link} result={invitation.result} /> : null}
          </div>
          {team.isLoading ? <SkeletonRows count={3} /> : null}
          {team.isError ? <ErrorRetry message="Couldn’t load the team. Retry to see current members and invitations." onRetry={() => team.refetch()} /> : null}
          <h2 className="app-section-title" style={{ marginTop: 32 }}>
            Team
          </h2>
          {team.data && members.filter((member) => !member.removedAt).length === 1 ? (
            <p className="app-lede">Add your organizing team.</p>
          ) : null}
          {members
            .filter((member) => !member.removedAt)
            .map((member) => (
              <div key={member.id} className="app-toolbar app-team-row">
                <div>
                  <strong>{member.displayName}</strong>
                  <p className="app-meta">
                    {member.email} · {roleLabel(member.role)}
                  </p>
                </div>
                {member.role !== 'owner' ? (
                  <>
                    <select
                      className="app-select"
                      style={{ maxWidth: 160 }}
                      aria-label={`Role for ${member.displayName}`}
                      disabled={busy}
                      value={member.role}
                      onChange={async (event) => {
                        const role = event.target.value as MemberRole
                        await teamAction(() => changeMemberRole(workspace.id, member.id, role, member.version), `${member.displayName} is now ${roleLabel(role)}.`)
                      }}
                    >
                      <option value="organizer">Organizer</option>
                      <option value="member">Member</option>
                    </select>
                    <Button
                      variant="quiet"
                      disabled={busy}
                      onClick={() => { setError(null); setRemoveId(member.id) }}
                    >
                      Remove
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => { setError(null); setTransferId(member.id) }}>
                      Make owner
                    </Button>
                  </>
                ) : null}
              </div>
            ))}
          <h2 className="app-section-title" style={{ marginTop: 32 }}>
            Invitations
          </h2>
          {team.data && invitations.length === 0 ? <p className="app-meta">No invitations waiting for a response.</p> : null}
          {invitations.map((invite) => (
            <div key={invite.id} className="app-toolbar app-team-row">
              <span>
                {invite.email} · {roleLabel(invite.role)} · {invite.expired ? 'Expired' : `expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
              </span>
              <div className="app-toolbar">
                <Button variant="secondary" disabled={busy || invitation.busy} onClick={() => { setNotice(''); void invitation.send(invite.email, invite.role, true) }}>
                  Resend
                </Button>
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => teamAction(() => revokeInvitation(invite.id), `Invitation for ${invite.email} revoked.`)}
                >
                  Revoke
                </Button>
              </div>
            </div>
          ))}
          {error ? <p className="app-error-text" role="alert">{error}</p> : null}
          {removeId ? <ConfirmDialog title="Remove teammate?"
            body={`${members.find((member) => member.id === removeId)?.displayName || 'This teammate'} will lose access to this workspace. Their previous assignments remain in its history.${error ? ` ${error}` : ''}`}
            actionLabel="Remove teammate" danger pending={busy} onCancel={() => setRemoveId(null)}
            onConfirm={async () => {
              const member = members.find((item) => item.id === removeId)
              if (member && await teamAction(() => removeMember(workspace.id, member.id, member.version), 'Teammate removed.')) setRemoveId(null)
            }} /> : null}
          {transferId && owner ? (
            <ConfirmDialog
              title="Transfer ownership?"
              body={`You will become an organizer. This teammate will become the only owner.${error ? ` ${error}` : ''}`}
              pending={busy}
              actionLabel="Transfer ownership"
              danger
              onCancel={() => setTransferId(null)}
              onConfirm={async () => {
                const target = members.find((member) => member.id === transferId)
                if (!target) return
                if (await teamAction(() => transferOwnership(workspace.id, target.id, owner.version, target.version), 'Ownership transferred.')) setTransferId(null)
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
