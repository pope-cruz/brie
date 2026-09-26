import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Field } from '../../components/ui'
import { sendInvitation, type InvitationDelivery } from '../../data/api'
import { toAppError } from '../../data/errors'
import type { MemberRole } from '../../data/types'

type InviteRole = Exclude<MemberRole, 'owner'>

export type InviteResult = {
  link: string
  recipient: string
  delivery: InvitationDelivery
  replaced: boolean
}

export function useInvitation(workspaceId: string) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<InviteResult | null>(null)

  async function send(email: string, role: InviteRole, replaced = false) {
    if (busy) return false
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const invite = await sendInvitation(workspaceId, email, role)
      setResult({
        link: `${window.location.origin}/app/invite/${invite.token}`,
        recipient: invite.email,
        delivery: invite.delivery,
        replaced,
      })
      await queryClient.invalidateQueries({ queryKey: ['team', workspaceId] })
      return true
    } catch (caught) {
      setError(toAppError(caught).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return { send, busy, error, result, clear: () => setResult(null) }
}

export function InviteFields({
  invitation,
  submitLabel = 'Send invite',
}: {
  invitation: ReturnType<typeof useInvitation>
  submitLabel?: string
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('organizer')
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        if (await invitation.send(email, role)) setEmail('')
      }}
    >
      <Field label="Email">
        <input className="app-input" type="email" value={email} onChange={(event) => { setEmail(event.target.value); invitation.clear() }} required />
      </Field>
      <Field label="Role" hint={role === 'organizer' ? 'Organizers manage events, tasks, schedules, and attendance. Only the owner manages the team.' : 'Members read event plans and update their own assigned tasks. They cannot see attendee details.'}>
        <select
          className="app-select"
          value={role}
          onChange={(event) => { setRole(event.target.value as InviteRole); invitation.clear() }}
        >
          <option value="organizer">Organizer</option>
          <option value="member">Member</option>
        </select>
      </Field>
      <Button type="submit" busy={invitation.busy}>
        {submitLabel}
      </Button>
    </form>
  )
}

export function deliveryMessage(result: InviteResult): string {
  const { recipient, delivery, replaced } = result
  const earlier = replaced ? ' The earlier link no longer works.' : ''
  if (delivery === 'sent') return `Invitation emailed to ${recipient}.${earlier}`
  if (delivery === 'rate_limited') return `You’ve sent a lot of invitations this hour, so this one wasn’t emailed. Share the link below with ${recipient}.${earlier}`
  if (delivery === 'failed') return `Couldn’t email ${recipient}. Share the link below with them yourself.${earlier}`
  return `Brie can’t send email yet. Share the link below with ${recipient}.${earlier}`
}

export function InviteLink({ result }: { result: InviteResult }) {
  const [copyStatus, setCopyStatus] = useState('')
  return (
    <div style={{ marginTop: 16 }}>
      <p role="status" className={result.delivery === 'sent' ? 'app-banner' : 'app-meta'}>{deliveryMessage(result)}</p>
      <Field label="Invitation link" hint={`They must sign in with ${result.recipient} to join. The link works for 7 days.`}>
        <input className="app-input" readOnly value={result.link} onFocus={(event) => event.target.select()} />
      </Field>
      <Button variant="secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(result.link); setCopyStatus('Link copied.') }
        catch { setCopyStatus('Couldn’t copy automatically. Select the link above and copy it manually.') }
      }}>Copy invitation link</Button>
      <p role="status" className="app-meta">{copyStatus}</p>
    </div>
  )
}
