import { useState } from 'react'
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
  return <TasksView workspace={workspace} eventId={event.id} eventTitle={event.title} scope="event" />
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
}: {
  workspace: WorkspaceSummary
  eventId?: string
  eventTitle?: string
  scope: 'event' | 'workspace'
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
  const manage = canManageEvents(workspace.role)

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

  const selected = panel === 'new' ? 'new' : panel || list.data?.rows.find((row) => row.id === selectedId) || null

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    next.set(key, value)
    next.set('page', '1')
    setParams(next)
  }

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: TaskStatus; version: number }) =>
      setTaskStatus(workspace.id, input.id, input.status, input.version),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })

  return (
    <div className={scope === 'workspace' ? 'app-page' : undefined}>
      {scope === 'workspace' ? (
        <>
          <h1 className="app-h1">Tasks</h1>
          <p className="app-lede">Work assigned across this workspace.</p>
        </>
      ) : (
        <div className="app-header-row" style={{ marginTop: 16 }}>
          <h2 className="app-section-title">Tasks</h2>
          {manage ? (
            <Button onClick={() => setPanel('new')}>Add task</Button>
          ) : null}
        </div>
      )}
      <div className="app-toolbar">
        <select className="app-select" style={{ maxWidth: 160 }} value={status} onChange={(event) => setParam('status', event.target.value)}>
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="done">Done</option>
        </select>
        <select className="app-select" style={{ maxWidth: 200 }} value={assignee} onChange={(event) => setParam('assignee', event.target.value)}>
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
      {list.isLoading ? <SkeletonRows /> : null}
      {list.isError ? <ErrorRetry message={toAppError(list.error).message} onRetry={() => list.refetch()} /> : null}
      {list.data && list.data.rows.length === 0 ? (
        <EmptyState
          title={assignee === 'me' ? 'No open tasks assigned to you' : 'No tasks yet'}
          action={
            assignee === 'me' ? (
              <Button variant="secondary" onClick={() => setParam('assignee', 'anyone')}>
                Show all tasks
              </Button>
            ) : manage && eventId ? (
              <Button onClick={() => setPanel('new')}>Add task</Button>
            ) : null
          }
        />
      ) : null}
      {list.data?.rows.map((task) => (
        <div key={task.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--app-border)' }}>
          <select
            className="app-select"
            style={{ maxWidth: 140 }}
            value={task.status}
            disabled={workspace.role === 'member' && task.assigneeMembershipId !== workspace.membershipId}
            onChange={(event) =>
              statusMutation.mutate({ id: task.id, status: event.target.value as TaskStatus, version: task.version })
            }
          >
            <option value="todo">Todo</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
          <button className="app-btn app-btn-quiet" onClick={() => setPanel(task)}>
            {task.title}
          </button>
          {scope === 'workspace' ? (
            <Link className="app-meta" to={`/app/w/${workspace.id}/events/${task.eventId}`}>
              {task.eventTitle}
            </Link>
          ) : null}
          <span className="app-meta">
            {task.assigneeFormer ? 'Former member' : task.assigneeName || 'Unassigned'}
            {task.dueDate ? ` · ${task.dueDate}` : ''}
            {task.overdue ? ' · Overdue' : ''}
          </span>
          {task.overdue ? <StatusBadge tone="warning">Overdue</StatusBadge> : null}
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
      {removed.data && removed.data.length > 0 ? (
        <details style={{ marginTop: 24 }}>
          <summary>Removed items</summary>
          {removed.data.map((task) => (
            <div key={task.id} className="app-toolbar">
              <span>{task.title}</span>
              <Button
                variant="secondary"
                onClick={async () => {
                  await restoreTask(workspace.id, task.id, task.version)
                  queryClient.invalidateQueries({ queryKey: ['tasks'] })
                  queryClient.invalidateQueries({ queryKey: ['removed-tasks'] })
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
          workspace={workspace}
          eventId={eventId}
          eventTitle={eventTitle}
          task={selected === 'new' ? null : selected}
          members={(team.data?.members ?? []).filter((member) => !member.removedAt)}
          onClose={() => setPanel(null)}
          onSaved={() => {
            setPanel(null)
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
          }}
          onRemoved={() => {
            setPanel(null)
            setToast('Task removed. Undo is available under Removed items.')
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            queryClient.invalidateQueries({ queryKey: ['removed-tasks'] })
          }}
        />
      ) : null}
      {toast ? <div className="app-toast">{toast}</div> : null}
    </div>
  )
}

function TaskPanel({
  workspace,
  eventId,
  eventTitle,
  task,
  members,
  onClose,
  onSaved,
  onRemoved,
}: {
  workspace: WorkspaceSummary
  eventId?: string
  eventTitle?: string
  task: TaskRecord | null
  members: Array<{ id: string; displayName: string }>
  onClose: () => void
  onSaved: () => void
  onRemoved: () => void
}) {
  const manage = canManageEvents(workspace.role)
  const [title, setTitle] = useState(task?.title || '')
  const [notes, setNotes] = useState(task?.notes || '')
  const [assignee, setAssignee] = useState(task?.assigneeMembershipId || '')
  const [dueDate, setDueDate] = useState(task?.dueDate || '')
  const [status, setStatus] = useState<TaskStatus>(task?.status || 'todo')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const chosenEventId = eventId || task?.eventId || ''

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await saveTask({
        workspaceId: workspace.id,
        eventId: chosenEventId,
        taskId: task?.id ?? null,
        title,
        notes,
        assigneeMembershipId: assignee || null,
        dueDate: dueDate || null,
        status,
        expectedVersion: task?.version ?? 1,
        requestKey: getRequestKey(`save_task:${chosenEventId}`),
      })
      clearRequestKey(`save_task:${chosenEventId}`)
      onSaved()
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-panel" role="dialog" aria-label={task ? task.title : 'Add task'}>
      <div className="app-panel-header">
        <h2 className="app-section-title">{task ? 'Task' : 'Add task'}</h2>
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
      </div>
      <form className="app-panel-body" onSubmit={save}>
        {eventTitle ? <p className="app-meta">{eventTitle}</p> : null}
        <Field label="Title">
          <input className="app-input" value={title} maxLength={200} required disabled={!manage && Boolean(task)} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="app-textarea" value={notes} maxLength={2000} disabled={!manage && Boolean(task)} onChange={(event) => setNotes(event.target.value)} />
        </Field>
        <Field label="Assignee">
          <select className="app-select" value={assignee} disabled={!manage} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due date">
          <input className="app-input" type="date" value={dueDate} disabled={!manage} onChange={(event) => setDueDate(event.target.value)} />
        </Field>
        <Field label="Status">
          <select className="app-select" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
            <option value="todo">Todo</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
        </Field>
        {error ? <p className="app-error-text">{error}</p> : null}
      </form>
      <div className="app-panel-footer">
        {task && manage ? (
          <Button
            variant="quiet"
            onClick={async () => {
              await removeTask(workspace.id, task.id, task.version)
              onRemoved()
            }}
          >
            Remove
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button busy={busy} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  )
}
