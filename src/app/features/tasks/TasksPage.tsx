import { useId, useRef, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../../components/shadcn/sheet'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, EmptyState, ErrorRetry, Field, Pagination, SkeletonRows, StatusBadge } from '../../components/ui'
import {
  listEventTasks,
  listRemovedTasks,
  listTeam,
  listWorkspaceTasks,
  removeTask,
  restoreTask,
  saveTask,
  setTaskStatus,
} from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type EventRecord, type TaskRecord, type TaskStatus } from '../../data/types'
import { clearRequestKey, getRequestKey } from '../../lib/idempotency'
import { useCurrentWorkspace } from '../workspaces/workspaceContext'

export function EventTasksPage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  return <TasksView workspace={workspace} eventId={event.id} eventTitle={event.title} archived={Boolean(event.archivedAt)} scope="event" />
}

export function WorkspaceTasksPage() {
  const workspace = useCurrentWorkspace()
  return <TasksView workspace={workspace} scope="workspace" />
}

function TasksView({
  workspace,
  eventId,
  eventTitle,
  scope,
  archived = false,
}: {
  workspace: WorkspaceSummary
  eventId?: string
  eventTitle?: string
  scope: 'event' | 'workspace'
  archived?: boolean
}) {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || (scope === 'workspace' ? 'open' : 'all')
  const assignee = params.get('assignee') || (scope === 'workspace' ? 'me' : 'anyone')
  const includeClosed = params.get('closed') === '1'
  const page = Number(params.get('page') || '1')
  const selectedId = params.get('task')
  const [panel, setPanel] = useState<'new' | TaskRecord | null>(selectedId === 'new' ? 'new' : null)
  const [toast, setToast] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const manage = canManageEvents(workspace.role) && !archived
  const opener = useRef<HTMLElement | null>(null)
  const statusFilter = useRef<HTMLSelectElement>(null)

  function openPanel(value: 'new' | TaskRecord) {
    opener.current = document.activeElement as HTMLElement
    setToast(null)
    setPanel(value)
  }
  function closePanel() {
    setPanel(null)
    const next = new URLSearchParams(params)
    next.delete('task')
    setParams(next, { replace: true })
  }
  function refreshTasks() {
    return Promise.all(['tasks', 'removed-tasks', 'event', 'events'].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] })))
  }

  const list = useQuery({
    queryKey: ['tasks', workspace.id, scope, eventId, status, assignee, includeClosed, page],
    queryFn: () =>
      scope === 'event' && eventId
        ? listEventTasks(workspace.id, eventId, status, assignee, page)
        : listWorkspaceTasks(workspace.id, status, assignee, includeClosed, page),
  })
  const removed = useQuery({
    queryKey: ['removed-tasks', workspace.id, eventId],
    queryFn: () => listRemovedTasks(workspace.id, eventId!),
    enabled: Boolean(manage && eventId),
  })
  const team = useQuery({
    queryKey: ['team', workspace.id],
    queryFn: () => listTeam(workspace.id),
  })

  const selected = panel === 'new' ? (manage && eventId ? 'new' : null) : panel || list.data?.rows.find((row) => row.id === selectedId) || null

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    next.set(key, value)
    next.set('page', '1')
    setParams(next)
  }

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: TaskStatus; version: number }) =>
      setTaskStatus(workspace.id, input.id, input.status, input.version),
    onMutate: () => setActionError(null),
    onError: (error) => setActionError(toAppError(error).message),
    onSuccess: () => setToast('Task status saved.'),
    onSettled: refreshTasks,
  })

  return (
    <div className={scope === 'workspace' ? 'app-page' : undefined}>
      {scope === 'workspace' ? (
        <>
          <h1 className="app-h1">Tasks</h1>
          <p className="app-lede">Work assigned across this workspace.</p>
        </>
      ) : (
        manage ? (
          <div className="app-header-row">
            <Button onClick={() => openPanel('new')}>Add to-do</Button>
          </div>
        ) : null
      )}
      <div className="app-toolbar">
        <select ref={statusFilter} aria-label="Filter by task status" className="app-select" style={{ maxWidth: 160 }} value={status} onChange={(event) => setParam('status', event.target.value)}>
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="done">Done</option>
        </select>
        <select aria-label="Filter by assignee" className="app-select" style={{ maxWidth: 200 }} value={assignee} onChange={(event) => setParam('assignee', event.target.value)}>
          <option value="anyone">Anyone</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {(team.data?.members ?? [])
            .filter((member) => !member.removedAt)
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
        </select>
        {scope === 'workspace' ? (
          <label className="app-meta">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(event) => setParam('closed', event.target.checked ? '1' : '0')}
            />{' '}
            Include closed events
          </label>
        ) : null}
      </div>
      {toast ? <p className="app-banner" role="status">{toast}</p> : null}
      {actionError ? (
        <p className="app-error-text" role="alert">
          {actionError}
        </p>
      ) : null}
      {list.isLoading ? <SkeletonRows /> : null}
      {list.isError ? <ErrorRetry message={toAppError(list.error).message} onRetry={() => list.refetch()} /> : null}
      {list.data && list.data.rows.length === 0 ? (
        <EmptyState
          title={assignee === 'me' ? (status === 'done' ? 'No completed tasks assigned to you' : status === 'open' ? 'No open tasks assigned to you' : 'No tasks assigned to you') : status !== 'all' || assignee !== 'anyone' ? 'No tasks match these filters' : 'No tasks yet'}
          body={!manage && scope === 'event' ? (archived ? 'This event is archived. Ask an organizer to restore it before making changes.' : 'Ask an organizer to add or assign work. You can update the status of your own assignments.') : undefined}
          action={
            assignee === 'me' ? (
              <Button variant="secondary" onClick={() => {
                const next = new URLSearchParams(params)
                next.set('assignee', 'anyone')
                next.set('status', 'all')
                next.set('page', '1')
                setParams(next)
              }}>
                Show all tasks
              </Button>
            ) : manage && eventId ? (
              <Button onClick={() => openPanel('new')}>Add task</Button>
            ) : null
          }
        />
      ) : null}
      {list.data?.rows.map((task) => (
        <div key={task.id} className="app-task-row">
          <div className="app-task-content">
            <button className="app-task-title" onClick={() => openPanel(task)}>{task.title}</button>
            {scope === 'workspace' ? <Link className="app-meta" to={`/app/w/${workspace.id}/events/${task.eventId}`}>{task.eventTitle}</Link> : null}
            <p className="app-meta">
              {task.assigneeFormer ? 'Former member' : task.assigneeName || 'Unassigned'}
              {task.dueDate ? ` · Due ${task.dueDate}` : ''}
              {task.eventArchived || archived ? ' · Archived event' : ''}
            </p>
            {task.overdue ? <StatusBadge tone="warning">Overdue</StatusBadge> : null}
          </div>
          <select className="app-select app-task-status" aria-label={`Status for ${task.title}`}
            value={task.status}
            disabled={archived || task.eventArchived || statusMutation.isPending || (workspace.role === 'member' && task.assigneeMembershipId !== workspace.membershipId)}
            onChange={(event) => statusMutation.mutate({ id: task.id, status: event.target.value as TaskStatus, version: task.version })}>
            <option value="todo">Todo</option><option value="in_progress">In progress</option><option value="done">Done</option>
          </select>
        </div>
      ))}
      {list.data ? (
        <Pagination
          page={list.data.page}
          total={list.data.total}
          onPage={(next) => {
            const nextParams = new URLSearchParams(params)
            nextParams.set('page', String(next))
            setParams(nextParams)
          }}
        />
      ) : null}
      {manage && removed.data && removed.data.length > 0 ? (
        <details style={{ marginTop: 24 }}>
          <summary>Removed items</summary>
          {removed.data.map((task) => (
            <div key={task.id} className="app-toolbar">
              <span>{task.title}</span>
              <Button
                variant="secondary"
                onClick={async () => {
                  setActionError(null)
                  try {
                    await restoreTask(workspace.id, task.id, task.version)
                  } catch (caught) {
                    setActionError(toAppError(caught).message)
                  } finally {
                    refreshTasks()
                  }
                }}
              >
                Restore
              </Button>
            </div>
          ))}
        </details>
      ) : null}
      {selected ? (
        <TaskPanel
          key={selected === 'new' ? 'new' : selected.id}
          workspace={workspace}
          archived={archived}
          returnFocus={() => (opener.current?.isConnected ? opener.current : statusFilter.current)?.focus()}
          eventId={eventId}
          eventTitle={eventTitle}
          task={selected === 'new' ? null : selected}
          members={(team.data?.members ?? []).filter((member) => !member.removedAt)}
          onClose={closePanel}
          onSaved={() => {
            closePanel()
            setToast('Task saved.')
            refreshTasks()
          }}
          onRemoved={() => {
            closePanel()
            setToast('Task removed. Restore it under Removed items in the event’s Tasks tab.')
            refreshTasks()
          }}
        />
      ) : null}
    </div>
  )
}

function TaskPanel({ workspace, eventId, eventTitle, task, members, archived, returnFocus, onClose, onSaved, onRemoved }: {
  workspace: WorkspaceSummary
  eventId?: string
  eventTitle?: string
  task: TaskRecord | null
  members: Array<{ id: string; displayName: string }>
  archived: boolean
  returnFocus: () => void
  onClose: () => void
  onSaved: () => void
  onRemoved: () => void
}) {
  const readOnly = archived || Boolean(task?.eventArchived)
  const manage = canManageEvents(workspace.role) && !readOnly
  const canUpdate = !readOnly && (manage || Boolean(task && task.assigneeMembershipId === workspace.membershipId))
  const formId = useId()
  const [title, setTitle] = useState(task?.title || '')
  const [notes, setNotes] = useState(task?.notes || '')
  const [assignee, setAssignee] = useState(task?.assigneeMembershipId || '')
  const [dueDate, setDueDate] = useState(task?.dueDate || '')
  const [status, setStatus] = useState<TaskStatus>(task?.status || 'todo')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState(false)
  const chosenEventId = eventId || task?.eventId || ''
  const dirty = title !== (task?.title || '') || notes !== (task?.notes || '') || assignee !== (task?.assigneeMembershipId || '') || dueDate !== (task?.dueDate || '') || status !== (task?.status || 'todo')
  function requestClose() {
    if (busy) return
    if (dirty && canUpdate) setDiscard(true)
    else onClose()
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !canUpdate) return
    setBusy(true)
    setError(null)
    try {
      if (!manage && task) {
        await setTaskStatus(workspace.id, task.id, status, task.version)
      } else {
        await saveTask({ workspaceId: workspace.id, eventId: chosenEventId, taskId: task?.id ?? null,
          title, notes, assigneeMembershipId: assignee || null, dueDate: dueDate || null, status,
          expectedVersion: task?.version ?? 1, requestKey: getRequestKey(`save_task:${chosenEventId}`) })
        clearRequestKey(`save_task:${chosenEventId}`)
      }
      onSaved()
    } catch (caught) { setError(toAppError(caught).message) }
    finally { setBusy(false) }
  }
  return (
    <Sheet open onOpenChange={(open) => { if (!open) requestClose() }}>
      <SheetContent className="app-task-sheet" showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus() }}>
        <SheetHeader>
          <div className="app-header-row">
            <SheetTitle>{task ? 'Task details' : 'Add task'}</SheetTitle>
            <Button variant="quiet" disabled={busy} onClick={requestClose}>Close</Button>
          </div>
          <SheetDescription>{eventTitle || task?.eventTitle || 'Assign work for this event.'}</SheetDescription>
        </SheetHeader>
        <form id={formId} className="app-panel-body" onSubmit={save}>
          {manage ? <>
            <Field label="Title"><input className="app-input" value={title} maxLength={200} required disabled={busy} onChange={(event) => setTitle(event.target.value)} /></Field>
            <Field label="Notes"><textarea className="app-textarea" value={notes} maxLength={2000} disabled={busy} onChange={(event) => setNotes(event.target.value)} /></Field>
            <Field label="Assignee"><select className="app-select" value={assignee} disabled={busy} onChange={(event) => setAssignee(event.target.value)}>
              <option value="">Unassigned</option>
              {task?.assigneeFormer && assignee === task.assigneeMembershipId ? <option value={assignee}>Former member</option> : null}
              {members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
            </select></Field>
            <Field label="Due date"><input className="app-input" type="date" value={dueDate} disabled={busy} onChange={(event) => setDueDate(event.target.value)} /></Field>
          </> : <>
            <h3 className="app-section-title app-task-copy">{title}</h3>
            <p className="app-task-copy">{notes || 'No additional notes.'}</p>
            <p className="app-meta">Assigned to {task?.assigneeFormer ? 'Former member' : task?.assigneeName || 'Unassigned'}{dueDate ? ` · Due ${dueDate}` : ''}</p>
            <p className="app-meta">{readOnly ? 'This event is archived. Ask an organizer to restore it before making changes.' : canUpdate ? 'You can update your task’s status. Ask an organizer to change its details.' : 'You can read this task. Only its assignee or an organizer can update it.'}</p>
          </>}
          <Field label="Status"><select className="app-select" value={status} disabled={!canUpdate || busy} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
            <option value="todo">Todo</option><option value="in_progress">In progress</option><option value="done">Done</option>
          </select></Field>
          {error ? <p className="app-error-text" role="alert">{error}</p> : null}
          {discard ? <div role="alert" className="app-banner">
            <p>Discard your unsaved changes?</p>
            <div className="app-toolbar">
              <Button type="button" variant="secondary" onClick={() => setDiscard(false)}>Keep editing</Button>
              <Button type="button" variant="danger" onClick={onClose}>Discard changes</Button>
            </div>
          </div> : null}
        </form>
        <div className="app-panel-footer">
          {task && manage ? <Button variant="quiet" disabled={busy} onClick={async () => {
            setBusy(true); setError(null)
            try { await removeTask(workspace.id, task.id, task.version); onRemoved() }
            catch (caught) { setError(toAppError(caught).message) }
            finally { setBusy(false) }
          }}>Remove</Button> : null}
          <Button variant="secondary" disabled={busy} onClick={requestClose}>{canUpdate ? 'Cancel' : 'Done'}</Button>
          {canUpdate ? <Button busy={busy} busyLabel="Saving…" type="submit" form={formId}>{manage ? 'Save task' : 'Save status'}</Button> : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
