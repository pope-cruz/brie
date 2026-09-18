import { useCallback, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/shadcn/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/shadcn/sheet'
import { Button } from '../../components/ui'
import type { WorkspaceSummary } from '../../data/api'
import { listTeam } from '../../data/api'
import type { EventRecord } from '../../data/types'
import { eventFormDefaults } from '../../lib/eventForm'
import { useNarrow } from '../../lib/useNarrow'
import { EventForm } from './EventFormPage'

/** Closing with typed input asks first; closing an untouched form just closes. */
function useGuardedClose(onClose: () => void) {
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Closing for any reason clears the question, so it never greets the next open.
  const close = useCallback(() => { setConfirming(false); onClose() }, [onClose])
  const request = useCallback(() => {
    if (dirty) setConfirming(true)
    else close()
  }, [dirty, close])
  const confirm = confirming ? (
    <div role="alert" className="app-banner event-discard">
      <p>Discard what you typed?</p>
      <div className="app-toolbar">
        <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Keep editing</Button>
        <Button type="button" variant="danger" onClick={close}>Discard</Button>
      </div>
    </div>
  ) : null
  return { setDirty, request, close, confirm }
}

/** New event: a small popover on the button (a full-screen sheet on phones), then the event page. */
export function QuickCreateButton({ workspace, children = 'New event' }: { workspace: WorkspaceSummary; children?: ReactNode }) {
  const narrow = useNarrow()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const guard = useGuardedClose(close)

  const form = open ? (
    <>
      <EventForm mode="new" layout="embedded" workspaceId={workspace.id} timezoneDefault={workspace.timezone}
        defaultTitle="" defaultDescription="" defaultLocation="" defaultStartDate="" defaultStartTime="" defaultEndDate="" defaultEndTime=""
        defaultStartOffset="" defaultEndOffset="" defaultLead="" defaultStatus="draft" version={1} members={[]}
        onDirtyChange={guard.setDirty} onCancel={guard.request}
        onSaved={(created) => { guard.close(); navigate(`/app/w/${workspace.id}/events/${created.id}`, { state: { focus: 'before' } }) }} />
      {guard.confirm}
    </>
  ) : null

  if (narrow) {
    return <>
      <Button onClick={() => setOpen(true)}>{children}</Button>
      {open ? (
        <Sheet open onOpenChange={(next) => { if (!next) guard.request() }}>
          <SheetContent side="bottom" className="app-task-sheet event-quick-sheet" showCloseButton={false} aria-describedby={undefined}
            onEscapeKeyDown={(event) => { event.preventDefault(); guard.request() }} onInteractOutside={(event) => event.preventDefault()}>
            <SheetHeader><SheetTitle>New event</SheetTitle></SheetHeader>
            <div className="app-panel-body">{form}</div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  }

  return (
    <Popover open={open} onOpenChange={(next) => { if (next) setOpen(true); else guard.request() }}>
      <PopoverTrigger asChild><Button>{children}</Button></PopoverTrigger>
      <PopoverContent align="end" className="event-quick-popover" aria-label="New event"
        onEscapeKeyDown={(event) => { event.preventDefault(); guard.request() }}
        onInteractOutside={(event) => event.preventDefault()}>
        <h2 className="app-section-title">New event</h2>
        {form}
      </PopoverContent>
    </Popover>
  )
}

/** Edit details: a 400px side panel (full screen on phones) with every event field. */
export function DetailsPanel({ workspace, event, onClose }: { workspace: WorkspaceSummary; event: EventRecord; onClose: () => void }) {
  const guard = useGuardedClose(onClose)
  // Freeze what was opened, including its version: a background refetch must not turn a stale
  // edit into a silent overwrite of someone else's save.
  const [defaults] = useState(() => eventFormDefaults(event))
  const team = useQuery({ queryKey: ['team', workspace.id], queryFn: () => listTeam(workspace.id) })
  const members = (team.data?.members ?? []).filter((member) => !member.removedAt)
  return (
    <Sheet open onOpenChange={(next) => { if (!next) guard.request() }}>
      <SheetContent className="app-task-sheet event-details-panel" showCloseButton={false}
        onEscapeKeyDown={(escape) => { escape.preventDefault(); guard.request() }} onInteractOutside={(outside) => outside.preventDefault()}>
        <SheetHeader>
          <div className="app-header-row">
            <SheetTitle>Edit details</SheetTitle>
            <Button variant="quiet" onClick={guard.request}>Close</Button>
          </div>
          <SheetDescription>{event.title}</SheetDescription>
        </SheetHeader>
        <div className="app-panel-body">
          <EventForm mode="edit" layout="embedded" workspaceId={workspace.id} {...defaults}
            members={members} onDirtyChange={guard.setDirty} onCancel={guard.request} onSaved={onClose} />
          {guard.confirm}
        </div>
      </SheetContent>
    </Sheet>
  )
}
