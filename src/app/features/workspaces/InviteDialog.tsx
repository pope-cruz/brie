import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { workspacePath } from '../../lib/paths'
import { InviteFields, InviteLink, useInvitation } from './InviteForm'

export function InviteDialog({
  workspaceId,
  workspaceName,
  onClose,
}: {
  workspaceId: string
  workspaceName: string
  onClose: () => void
}) {
  const invitation = useInvitation(workspaceId)
  const opener = useRef(document.activeElement as HTMLElement | null)
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open && !invitation.busy) onClose() }}>
      <DialogPrimitive.Portal container={document.querySelector<HTMLElement>('.brie-app')}>
        <DialogPrimitive.Overlay className="app-dialog-backdrop" />
        <DialogPrimitive.Content className="app-dialog app-confirm-dialog"
          onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus() }}
          onEscapeKeyDown={(event) => { if (invitation.busy) event.preventDefault() }}>
          <DialogPrimitive.Title className="app-section-title">Invite to {workspaceName}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="app-lede" style={{ marginBottom: 16 }}>
            Brie emails your teammate a link. They sign in with that email to join.
          </DialogPrimitive.Description>
          <InviteFields invitation={invitation} />
          {invitation.error ? <p className="app-error-text" role="alert">{invitation.error}</p> : null}
          {invitation.result ? <InviteLink key={invitation.result.link} result={invitation.result} /> : null}
          <div className="app-toolbar" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <Link className="app-meta" to={`${workspacePath(workspaceId, 'settings')}?tab=team`} onClick={onClose}>
              Manage team
            </Link>
            <button className="app-btn app-btn-secondary" onClick={onClose} disabled={invitation.busy}>Done</button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
