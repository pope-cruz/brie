import { TimeZonePicker } from '../../components/TimeZonePicker'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ConfirmDialog, Field } from '../../components/ui'
import {
  changeMemberRole,
  createInvitation,
  listTeam,
  removeMember,
  revokeInvitation,
  saveWorkspace,
  transferOwnership,
} from '../../data/api'
import { toAppError } from '../../data/errors'
import { canAdminWorkspace, roleLabel, type MemberRole } from '../../data/types'
import { useCurrentWorkspace } from './workspaceContext'

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
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<MemberRole, 'owner'>>('member')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [transferId, setTransferId] = useState<string | null>(null)

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
              queryClient.invalidateQueries({ queryKey: ['workspace', workspace.id] })
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
          {error ? <p className="app-error-text">{error}</p> : null}
          <Button type="submit" busy={busy}>
            Save
          </Button>
        </form>
      ) : (
        <div>
          <h2 className="app-section-title">Invite teammate</h2>
          <form
            className="app-page-narrow"
            onSubmit={async (event) => {
              event.preventDefault()
              setBusy(true)
              setError(null)
              try {
                const invite = await createInvitation(workspace.id, inviteEmail, inviteRole)
                const url = `${window.location.origin}/app/invite/${invite.token}`
                setInviteLink(url)
                setInviteEmail('')
                queryClient.invalidateQueries({ queryKey: ['team', workspace.id] })
              } catch (caught) {
                setError(toAppError(caught).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            <Field label="Email">
              <input className="app-input" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required />
            </Field>
            <Field label="Role">
              <select
                className="app-select"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as Exclude<MemberRole, 'owner'>)}
              >
                <option value="organizer">Organizer</option>
                <option value="member">Member</option>
              </select>
            </Field>
            <Button type="submit" busy={busy}>
              Create link
            </Button>
          </form>
          {inviteLink ? (
            <p>
              <input className="app-input" readOnly value={inviteLink} />
              <Button
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(inviteLink).catch(() => undefined)}
              >
                Copy
              </Button>
            </p>
          ) : null}
          <h2 className="app-section-title" style={{ marginTop: 32 }}>
            Team
          </h2>
          {members.filter((member) => !member.removedAt).length === 1 ? (
            <p className="app-lede">Add your organizing team.</p>
          ) : null}
          {members
            .filter((member) => !member.removedAt)
            .map((member) => (
              <div key={member.id} className="app-toolbar">
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
                      value={member.role}
                      onChange={async (event) => {
                        await changeMemberRole(workspace.id, member.id, event.target.value as MemberRole, member.version)
                        queryClient.invalidateQueries({ queryKey: ['team', workspace.id] })
                      }}
                    >
                      <option value="organizer">Organizer</option>
                      <option value="member">Member</option>
                    </select>
                    <Button
                      variant="quiet"
                      onClick={async () => {
                        await removeMember(workspace.id, member.id, member.version)
                        queryClient.invalidateQueries({ queryKey: ['team', workspace.id] })
                      }}
                    >
                      Remove
                    </Button>
                    <Button variant="secondary" onClick={() => setTransferId(member.id)}>
                      Make owner
                    </Button>
                  </>
                ) : null}
              </div>
            ))}
          <h2 className="app-section-title" style={{ marginTop: 32 }}>
            Pending invitations
          </h2>
          {invitations.length === 0 ? <p className="app-meta">No pending invitations.</p> : null}
          {invitations.map((invite) => (
            <div key={invite.id} className="app-toolbar">
              <span>
                {invite.email} · {roleLabel(invite.role)} · expires {new Date(invite.expiresAt).toLocaleDateString()}
              </span>
              <Button
                variant="quiet"
                onClick={async () => {
                  await revokeInvitation(invite.id)
                  queryClient.invalidateQueries({ queryKey: ['team', workspace.id] })
                }}
              >
                Revoke
              </Button>
            </div>
          ))}
          {error ? <p className="app-error-text">{error}</p> : null}
          {transferId && owner ? (
            <ConfirmDialog
              title="Transfer ownership?"
              body="You will become an organizer. This teammate will become the only owner."
              actionLabel="Transfer ownership"
              danger
              onCancel={() => setTransferId(null)}
              onConfirm={async () => {
                const target = members.find((member) => member.id === transferId)
                if (!target) return
                await transferOwnership(workspace.id, target.id, owner.version, target.version)
                setTransferId(null)
                queryClient.invalidateQueries({ queryKey: ['workspace'] })
                queryClient.invalidateQueries({ queryKey: ['team'] })
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
