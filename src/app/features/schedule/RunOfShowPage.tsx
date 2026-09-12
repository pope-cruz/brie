import { DateTimeRange } from '../../components/DateTimeRange'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../../components/shadcn/sheet'
import { Input } from '../../components/shadcn/input'
import { Checkbox } from '../../components/shadcn/checkbox'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, EmptyState, Field } from '../../components/ui'
import { listSegments, listTeam, removeSegment, restoreSegment, saveSegment } from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type EventRecord, type SegmentRecord } from '../../data/types'
import { clearRequestKey, getRequestKey } from '../../lib/idempotency'
import { formatTimeRange, resolveLocalDateTime, splitInZone, timeZoneLabel } from '../../lib/timezone'

export function RunOfShowPage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<SegmentRecord | 'new' | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const manage = canManageEvents(workspace.role)
  const segments = useQuery({
    queryKey: ['segments', workspace.id, event.id],
    queryFn: () => listSegments(workspace.id, event.id, manage),
    refetchOnWindowFocus: true,
  })
  const team = useQuery({
    queryKey: ['team', workspace.id],
    queryFn: () => listTeam(workspace.id),
  })
  const visible = (segments.data ?? []).filter((segment) => !segment.removedAt)
  const removed = (segments.data ?? []).filter((segment) => segment.removedAt)

  return (
    <div>
      <div className="app-header-row" style={{ marginTop: 16 }}>
        <div>
          <h2 className="app-section-title">Run of show</h2>
          <p className="app-meta">
            {timeZoneLabel(event.timezone, event.startsAt)} · {segments.isFetching ? 'Refreshing…' : 'Times shown in the event’s zone'}
          </p>
        </div>
        <div className="app-toolbar">
          <Button variant="secondary" onClick={() => segments.refetch()}>
            Refresh
          </Button>
          {manage ? <Button onClick={() => setEditing('new')}>Add segment</Button> : null}
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          title={manage ? 'Build the schedule for event day' : 'The schedule hasn’t been added yet.'}
          body={manage ? 'Include setup, program, and cleanup.' : undefined}
          action={manage ? <Button onClick={() => setEditing('new')}>Add segment</Button> : null}
        />
      ) : (
          visible.map((segment) => {
          return (
            <div key={segment.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--app-border)' }}>
              <p className="app-tabular">
                {formatTimeRange(segment.startsAt, segment.endsAt, event.timezone)}
              </p>
              <button className="app-btn app-btn-quiet" onClick={() => setExpanded(expanded === segment.id ? null : segment.id)}>
                {segment.title}
              </button>
              <p className="app-meta">
                {segment.ownerFormer ? 'Former member' : segment.ownerName || 'Unassigned'}
                {segment.overlaps ? ' · Overlaps another segment' : ''}
                {segment.outOfRange ? ' · Outside event time' : ''}
              </p>
              {expanded === segment.id ? <p>{segment.instructions || 'No instructions.'}</p> : null}
              {manage ? (
                <div className="app-toolbar">
                  <Button variant="quiet" onClick={() => setEditing(segment)}>
                    Edit
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={async () => {
                      await removeSegment(workspace.id, segment.id, segment.version)
                      queryClient.invalidateQueries({ queryKey: ['segments'] })
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })
      )}
      {removed.length > 0 ? (
        <details style={{ marginTop: 24 }}>
          <summary>Removed items</summary>
          {removed.map((segment) => (
            <div key={segment.id} className="app-toolbar">
              <span>{segment.title}</span>
              <Button
                variant="secondary"
                onClick={async () => {
                  await restoreSegment(workspace.id, segment.id, segment.version)
                  queryClient.invalidateQueries({ queryKey: ['segments'] })
                }}
              >
                Restore
              </Button>
            </div>
          ))}
        </details>
      ) : null}
      {editing ? (
        <SegmentPanel
          workspace={workspace}
          event={event}
          segment={editing === 'new' ? null : editing}
          members={(team.data?.members ?? []).filter((member) => !member.removedAt)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            queryClient.invalidateQueries({ queryKey: ['segments'] })
          }}
        />
      ) : null}
    </div>
  )
}

function SegmentPanel({
  workspace,
  event,
  segment,
  members,
  onClose,
  onSaved,
}: {
  workspace: WorkspaceSummary
  event: EventRecord
  segment: SegmentRecord | null
  members: Array<{ id: string; displayName: string }>
  onClose: () => void
  onSaved: () => void
}) {
  const start = splitInZone(segment?.startsAt ?? event.startsAt, event.timezone)
  const end = splitInZone(segment?.endsAt ?? event.endsAt, event.timezone)
  const [title, setTitle] = useState(segment?.title || '')
  const [startDate, setStartDate] = useState(start.date)
  const [startTime, setStartTime] = useState(start.time)
  const [endDate, setEndDate] = useState(end.date)
  const [endTime, setEndTime] = useState(end.time)
  const [startOffset, setStartOffset] = useState(start.offset)
  const [endOffset, setEndOffset] = useState(end.offset)
  const [warning, setWarning] = useState(false)
  const [owner, setOwner] = useState(segment?.ownerMembershipId || '')
  const [instructions, setInstructions] = useState(segment?.instructions || '')
  const [ack, setAck] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const previewStart = resolveLocalDateTime(startDate, startTime, event.timezone, startOffset)
  const previewEnd = resolveLocalDateTime(endDate, endTime, event.timezone, endOffset)
  const outsideEvent = previewStart.ok && previewEnd.ok && (
    new Date(previewStart.iso) < new Date(event.startsAt) || new Date(previewEnd.iso) > new Date(event.endsAt)
  )

  async function save(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    const startResolved = resolveLocalDateTime(startDate, startTime, event.timezone, startOffset)
    const endResolved = resolveLocalDateTime(endDate, endTime, event.timezone, endOffset)
    if (!startResolved.ok || !endResolved.ok) {
      setError('Check the start and end, including any daylight-saving time choice.')
      return
    }
    if (new Date(endResolved.iso) <= new Date(startResolved.iso)) { setError('End must be after start.'); return }
    setBusy(true)
    setError(null)
    try {
      await saveSegment({
        workspaceId: workspace.id,
        eventId: event.id,
        segmentId: segment?.id ?? null,
        title,
        startsAt: startResolved.iso,
        endsAt: endResolved.iso,
        ownerMembershipId: owner || null,
        instructions,
        ackWarnings: ack,
        expectedVersion: segment?.version ?? 1,
        requestKey: getRequestKey(`save_segment:${event.id}`),
      })
      clearRequestKey(`save_segment:${event.id}`)
      onSaved()
    } catch (caught) {
      const appError = toAppError(caught)
      if (appError.fields.warnings) { setWarning(true); setAck(false) }
      setError(appError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <SheetContent showCloseButton={!busy} onInteractOutside={(event) => event.preventDefault()}>
      <SheetHeader>
        <SheetTitle>{segment ? 'Edit segment' : 'Add segment'}</SheetTitle>
        <SheetDescription>
          {timeZoneLabel(event.timezone, event.startsAt)}. Event: {formatTimeRange(event.startsAt, event.endsAt, event.timezone)}.
        </SheetDescription>
      </SheetHeader>
      <form id="segment-form" onSubmit={save}>
        <Field label="Title">
          <Input value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <DateTimeRange startDate={startDate} endDate={endDate} startTime={startTime} endTime={endTime}
          startOffset={startOffset} endOffset={endOffset} timezone={event.timezone} onStartDate={(v) => { setStartDate(v); setAck(false) }} onEndDate={(v) => { setEndDate(v); setAck(false) }} onStartTime={(v) => { setStartTime(v); setAck(false) }} onEndTime={(v) => { setEndTime(v); setAck(false) }} onStartOffset={(v) => { setStartOffset(v); setAck(false) }} onEndOffset={(v) => { setEndOffset(v); setAck(false) }} />
        <Field label="Owner">
          <select className="app-select" value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Instructions">
          <textarea className="app-textarea" value={instructions} maxLength={4000} onChange={(event) => setInstructions(event.target.value)} />
        </Field>
        {outsideEvent ? <p className="app-banner">This segment is outside the event’s scheduled hours. Check the times, or confirm below if this is setup or cleanup.</p> : null}
        {warning || outsideEvent ? (
          <label className="app-meta">
            <Checkbox checked={ack} onCheckedChange={(checked) => setAck(checked === true)} /> Save anyway despite
            overlap or out-of-range warning
          </label>
        ) : null}
        {error ? <p className="app-error-text">{error}</p> : null}
      </form>
      <div className="app-panel-footer">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button busy={busy} type="submit" form="segment-form">
          Save
        </Button>
      </div>
      </SheetContent>
    </Sheet>
  )
}
