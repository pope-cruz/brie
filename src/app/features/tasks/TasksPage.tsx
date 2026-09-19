import { useEffect, useId, useRef, useState, type ClipboardEvent, type FocusEvent, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/shadcn/sheet'
import { Button, ConfirmDialog, EmptyState, ErrorRetry, Field, SkeletonRows } from '../../components/ui'
import { listEventTasks, listRemovedTasks, listTeam, removeTask, restoreTask, saveTask, setTaskStatus } from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type EventRecord, type TaskRecord } from '../../data/types'
import { formatDueDate, parseDateInput } from '../../lib/dateInput'
import { clearRequestKey, getRequestKey } from '../../lib/idempotency'
import { sortTodos } from '../../lib/todos'
import { eventLocalDate } from '../../lib/timezone'
import { useNarrow } from '../../lib/useNarrow'

type Member = { id: string; displayName: string }
type Ctx = { workspace: WorkspaceSummary; event: EventRecord; today: string; members: Member[] }
/** What a person types into a row. The date stays as typed until it is read. */
type Draft = { title: string; date: string; assignee: string; notes: string }

function draftFrom(task: TaskRecord | null, today: string): Draft {
  return {
    title: task?.title ?? '',
    date: task?.dueDate ? formatDueDate(task.dueDate, today) : '',
    assignee: task?.assigneeMembershipId ?? '',
    notes: task?.notes ?? '',
  }
}

const same = (a: Draft, b: Draft) => a.title === b.title && a.date === b.date && a.assignee === b.assignee && a.notes === b.notes

/** Every to-do for the event, following pages past the 50-row page size. */
async function listAllEventTasks(workspaceId: string, eventId: string) {
  const first = await listEventTasks(workspaceId, eventId, 'all', 'anyone', 1)
  const rows = [...first.rows]
  for (let page = 2; rows.length < first.total && page <= 20; page += 1) {
    const next = await listEventTasks(workspaceId, eventId, 'all', 'anyone', page)
    if (next.rows.length === 0) break
    rows.push(...next.rows)
  }
  return rows
}

function personLabel(task: TaskRecord) {
  return task.assigneeFormer ? 'Former member' : task.assigneeName || 'Unassigned'
}

export function EventTasksPage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const narrow = useNarrow()
  const params = new URLSearchParams(location.search)
  const mine = params.get('todos') === 'mine'
  const focusId = params.get('task')
  // A just-created event opens here: start typing its first to-do.
  const focusBefore = (location.state as { focus?: string } | null)?.focus === 'before'
  const archived = Boolean(event.archivedAt)
  const manage = canManageEvents(workspace.role) && !archived
  const today = eventLocalDate(new Date().toISOString(), event.timezone)
  const key = ['tasks', workspace.id, 'event', event.id]
  const tasks = useQuery({ queryKey: key, queryFn: () => listAllEventTasks(workspace.id, event.id) })
  const removed = useQuery({
    queryKey: ['removed-tasks', workspace.id, event.id],
    queryFn: () => listRemovedTasks(workspace.id, event.id),
    enabled: manage,
  })
  const team = useQuery({ queryKey: ['team', workspace.id], queryFn: () => listTeam(workspace.id) })
  const members = (team.data?.members ?? []).filter((member) => !member.removedAt)
  const [sheet, setSheet] = useState<'new' | TaskRecord | null>(null)
  const [undo, setUndo] = useState<TaskRecord | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const ctx: Ctx = { workspace, event, today, members }

  useEffect(() => {
    if (focusId && tasks.data) document.getElementById(`todo-${focusId}`)?.scrollIntoView({ block: 'center' })
  }, [focusId, tasks.data])

  function setWho(next: 'everyone' | 'mine') {
    const merged = new URLSearchParams(location.search)
    if (next === 'mine') merged.set('todos', 'mine')
    else merged.delete('todos')
    const search = merged.toString()
    navigate({ search: search ? `?${search}` : '', hash: location.hash }, { replace: true, preventScrollReset: true })
  }

  /** Put a saved to-do into the list right away, then let the event summary catch up. */
  function saved(task: TaskRecord) {
    queryClient.setQueryData<TaskRecord[]>(key, (rows) => {
      if (!rows) return rows
      return rows.some((row) => row.id === task.id) ? rows.map((row) => (row.id === task.id ? task : row)) : [...rows, task]
    })
    void queryClient.invalidateQueries({ queryKey: ['event', workspace.id, event.id] })
    void queryClient.invalidateQueries({ queryKey: ['events'] })
    void queryClient.invalidateQueries({ queryKey: ['home-tasks'] })
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ['removed-tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['event', workspace.id, event.id] }),
    ])
    return queryClient.getQueryData<TaskRecord[]>(key)
  }

  async function remove(task: TaskRecord, version: number) {
    setActionError(null)
    try {
      const result = await removeTask(workspace.id, task.id, version)
      setUndo(result)
      setSheet(null)
    } catch (caught) {
      setActionError(toAppError(caught).message)
    }
    await refresh()
  }

  async function restore(task: TaskRecord) {
    setActionError(null)
    try {
      await restoreTask(workspace.id, task.id, task.version)
      setUndo(null)
    } catch (caught) {
      setActionError(toAppError(caught).message)
    }
    await refresh()
  }

  const all = sortTodos(tasks.data ?? [])
  const shown = mine ? all.filter((task) => task.assigneeMembershipId === workspace.membershipId && !task.assigneeFormer) : all
  const open = shown.filter((task) => task.status !== 'done')
  const done = shown.filter((task) => task.status === 'done')
  const inline = manage && !narrow

  function renderRow(task: TaskRecord) {
    return inline
      ? <EditableRow key={task.id} ctx={ctx} task={task} startOpen={task.id === focusId} onSaved={saved} onRefresh={refresh} onRemove={remove} />
      : <ReadRow key={task.id} ctx={ctx} task={task} startOpen={task.id === focusId} archived={archived}
          onOpen={manage ? () => setSheet(task) : undefined} onSaved={saved} onRefresh={refresh} />
  }

  return (
    <div className="todo-list-wrap">
      <div className="todo-toolbar">
        <div className="todo-who" role="group" aria-label="Show to-dos for">
          <button type="button" aria-pressed={!mine} onClick={() => setWho('everyone')}>Everyone</button>
          <button type="button" aria-pressed={mine} onClick={() => setWho('mine')}>Mine</button>
        </div>
        {manage && narrow ? <Button autoFocus={focusBefore} onClick={() => setSheet('new')}>Add to-do</Button> : null}
      </div>

      {undo ? (
        <p className="app-banner" role="status">
          Removed “{undo.title}”. <button type="button" className="ros-retry-link" onClick={() => restore(undo)}>Undo</button>
        </p>
      ) : null}
      {actionError ? <p className="app-error-text" role="alert">{actionError}</p> : null}
      {tasks.isLoading ? <SkeletonRows count={4} /> : null}
      {tasks.isError ? <ErrorRetry message={toAppError(tasks.error).message} onRetry={() => tasks.refetch()} /> : null}

      {tasks.data && all.length === 0 ? (
        manage ? <p className="todo-empty">Add the work your team needs to do.</p>
          : <EmptyState title="No to-dos yet" body={archived ? undefined : 'Organizers add the work for this event.'} />
      ) : null}
      {tasks.data && all.length > 0 && shown.length === 0 ? (
        <EmptyState title="Nothing assigned to you" action={<Button variant="secondary" onClick={() => setWho('everyone')}>Show everyone</Button>} />
      ) : null}

      {tasks.data && (open.length > 0 || inline) ? (
        <div className="todo-list" role="list" aria-label="To-dos">
          {inline ? <div className="todo-head" aria-hidden="true"><span /><span>To-do</span><span>Date</span><span>Person</span><span /></div> : null}
          {open.map(renderRow)}
          {inline ? <AddRow ctx={ctx} onSaved={saved} autoFocus={focusBefore} /> : null}
        </div>
      ) : null}
      {inline ? <p className="ros-add-hint">Type a date like <kbd>fri</kbd> or <kbd>10/17</kbd>. Enter saves; paste several lines to add several to-dos.</p> : null}

      {done.length > 0 ? (
        <details className="todo-done">
          <summary>Done ({done.length})</summary>
          <div className="todo-list" role="list" aria-label="Done to-dos">{done.map(renderRow)}</div>
        </details>
      ) : null}

      {manage && removed.data && removed.data.length > 0 ? (
        <details className="ros-removed">
          <summary>Removed items ({removed.data.length})</summary>
          {removed.data.map((task) => (
            <div key={task.id} className="ros-removed-row"><span>{task.title}</span>
              <Button variant="secondary" onClick={() => restore(task)}>Restore</Button></div>
          ))}
        </details>
      ) : null}

      {sheet ? (
        <TaskSheet key={sheet === 'new' ? 'new' : sheet.id} ctx={ctx} task={sheet === 'new' ? null : sheet}
          onClose={() => setSheet(null)} onSaved={(task) => { saved(task); setSheet(null) }} onRemove={remove} />
      ) : null}
    </div>
  )
}

/** The done checkbox, shared by every row. */
function useCheck(ctx: Ctx, task: TaskRecord, version: number, onSaved: (task: TaskRecord) => void, onVersion: (version: number) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canCheck = !ctx.event.archivedAt && (canManageEvents(ctx.workspace.role) || task.assigneeMembershipId === ctx.workspace.membershipId)
  async function toggle(checked: boolean) {
    setBusy(true)
    setError(null)
    try {
      const result = await setTaskStatus(ctx.workspace.id, task.id, checked ? 'done' : 'todo', version)
      onVersion(result.version)
      onSaved(result)
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }
  const box = (
    <input type="checkbox" className="todo-check" aria-label={`Done: ${task.title}`} checked={task.status === 'done'}
      disabled={!canCheck || busy} onChange={(change) => toggle(change.target.checked)} />
  )
  return { box, error, retry: () => toggle(task.status !== 'done') }
}

function EditableRow({ ctx, task, startOpen, onSaved, onRefresh, onRemove }: {
  ctx: Ctx
  task: TaskRecord
  startOpen: boolean
  onSaved: (task: TaskRecord) => void
  onRefresh: () => Promise<TaskRecord[] | undefined>
  onRemove: (task: TaskRecord, version: number) => void
}) {
  const [base, setBase] = useState(() => draftFrom(task, ctx.today))
  const [draft, setDraft] = useState(base)
  const [version, setVersion] = useState(task.version)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(startOpen)
  const menu = useRef<HTMLDetailsElement>(null)
  const dirty = !same(draft, base)
  const check = useCheck(ctx, task, version, onSaved, setVersion)
  const label = task.title

  // A newer copy from the server replaces the row unless someone is typing in it.
  if (task.version > version && !dirty) {
    const next = draftFrom(task, ctx.today)
    setVersion(task.version)
    setBase(next)
    setDraft(next)
  }

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }))
    if (state !== 'saving') setState('idle')
    setError(null)
  }

  async function save(current: Draft = draft) {
    if (same(current, base) || state === 'saving') return
    const dueDate = parseDateInput(current.date, ctx.today)
    if (!current.title.trim()) { setState('error'); setError('Enter a to-do.'); return }
    if (dueDate === null) { setState('error'); setError('Enter a date like fri or 10/17.'); return }
    setState('saving')
    setError(null)
    const scope = `save_task:${task.id}`
    try {
      const result = await saveTask({
        workspaceId: ctx.workspace.id, eventId: ctx.event.id, taskId: task.id, title: current.title.trim(), notes: current.notes,
        assigneeMembershipId: current.assignee || null, dueDate: dueDate || null, status: task.status,
        expectedVersion: version, requestKey: getRequestKey(scope),
      })
      clearRequestKey(scope)
      const next = draftFrom(result, ctx.today)
      setVersion(result.version)
      setBase(next)
      setDraft(next)
      setState('saved')
      onSaved(result)
    } catch (caught) {
      const failure = toAppError(caught)
      setState(failure.code === 'CONFLICT' ? 'conflict' : 'error')
      setError(failure.code === 'CONFLICT' ? 'Someone else changed this to-do. Your text is kept.' : failure.message)
    }
  }

  async function reloadLatest() {
    const rows = await onRefresh()
    const latest = rows?.find((row) => row.id === task.id)
    if (!latest) return
    const next = draftFrom(latest, ctx.today)
    setVersion(latest.version)
    setBase(next)
    setDraft(next)
    setState('idle')
    setError(null)
  }

  function onBlur(blur: FocusEvent<HTMLDivElement>) {
    if (!blur.currentTarget.contains(blur.relatedTarget as Node | null)) void save()
  }

  function onKeyDown(key: KeyboardEvent<HTMLDivElement>) {
    const target = key.target as HTMLElement
    if (key.key === 'Escape') {
      key.preventDefault()
      setDraft(base)
      setState('idle')
      setError(null)
      return
    }
    if (key.key !== 'Enter' || target instanceof HTMLButtonElement || target.tagName === 'SUMMARY') return
    if (target instanceof HTMLTextAreaElement && !(key.metaKey || key.ctrlKey)) return
    key.preventDefault()
    void save()
  }

  const parsed = parseDateInput(draft.date, ctx.today)
  const resolved = parsed && draft.date !== formatDueDate(parsed, ctx.today) ? formatDueDate(parsed, ctx.today) : null
  const notesId = `todo-notes-${task.id}`

  return (
    <div id={`todo-${task.id}`} role="listitem" className="todo-row todo-row-edit" data-done={task.status === 'done' ? '' : undefined}
      onBlur={onBlur} onKeyDown={onKeyDown}>
      <div className="todo-cells">
        {check.box}
        <input className="todo-title-input" aria-label={`Title for ${label}`} value={draft.title} maxLength={200} autoComplete="off"
          onChange={(change) => update({ title: change.target.value })} />
        <div className="todo-date-cell">
          <input className="todo-date-input" aria-label={`Date for ${label}`} value={draft.date} placeholder="No date" autoComplete="off"
            onChange={(change) => update({ date: change.target.value })}
            onBlur={() => { if (parsed) update({ date: formatDueDate(parsed, ctx.today) }) }} />
          {resolved ? <span className="todo-resolved">{resolved}</span> : null}
          {task.overdue && task.status !== 'done' && !dirty ? <span className="todo-overdue">Overdue</span> : null}
        </div>
        <select className="todo-person-select" aria-label={`Person for ${label}`} value={draft.assignee}
          onChange={(change) => {
            // A pick is a finished choice, so it saves now (with anything else typed in the row).
            const next = { ...draft, assignee: change.target.value }
            update({ assignee: next.assignee })
            void save(next)
          }}>
          <option value="">Unassigned</option>
          {task.assigneeFormer && draft.assignee === task.assigneeMembershipId ? <option value={draft.assignee}>Former member</option> : null}
          {ctx.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
        </select>
        <div className="todo-row-actions">
          <button type="button" className="todo-notes-toggle" aria-expanded={notesOpen} aria-controls={notesId}
            aria-label={`Notes for ${label}`} data-has-notes={draft.notes ? '' : undefined} onClick={() => setNotesOpen((value) => !value)}>
            Notes
          </button>
          <details ref={menu} className="ros-row-menu"><summary aria-label={`Actions for ${label}`}>•••</summary><div>
            <button type="button" className="ros-danger-action" onClick={() => { menu.current?.removeAttribute('open'); onRemove(task, version) }}>Remove</button>
          </div></details>
        </div>
      </div>
      {notesOpen ? (
        <textarea id={notesId} className="todo-notes-input" aria-label={`Notes text for ${label}`} value={draft.notes} maxLength={2000}
          placeholder="Notes" rows={3} onChange={(change) => update({ notes: change.target.value })} />
      ) : null}
      <div className="todo-row-status" aria-live="polite">
        {state === 'saving' ? <span className="app-meta">Saving…</span> : null}
        {state === 'saved' && !dirty ? <span className="app-meta">Saved</span> : null}
        {error ? (
          <span className="app-error-text" role="alert">
            {error}{' '}
            {state === 'conflict'
              ? <button type="button" className="ros-retry-link" onClick={reloadLatest}>Reload latest</button>
              : draft.title.trim() && parsed !== null ? <button type="button" className="ros-retry-link" onClick={() => save()}>Retry</button> : null}
          </span>
        ) : null}
        {check.error ? <span className="app-error-text" role="alert">{check.error} <button type="button" className="ros-retry-link" onClick={check.retry}>Retry</button></span> : null}
      </div>
    </div>
  )
}

function ReadRow({ ctx, task, startOpen, archived, onOpen, onSaved, onRefresh }: {
  ctx: Ctx
  task: TaskRecord
  startOpen: boolean
  archived: boolean
  onOpen?: () => void
  onSaved: (task: TaskRecord) => void
  onRefresh: () => Promise<TaskRecord[] | undefined>
}) {
  const [notesOpen, setNotesOpen] = useState(startOpen)
  const check = useCheck(ctx, task, task.version, onSaved, () => undefined)
  const notesId = `todo-notes-${task.id}`
  const meta = [personLabel(task), task.dueDate ? formatDueDate(task.dueDate, ctx.today) : null].filter(Boolean).join(' · ')
  return (
    <div id={`todo-${task.id}`} role="listitem" className="todo-row" data-done={task.status === 'done' ? '' : undefined}>
      <div className="todo-read">
        {check.box}
        <div className="todo-read-body">
          {onOpen ? <button type="button" className="todo-title-button" onClick={onOpen}><span className="sr-only">Edit </span>{task.title}</button>
            : task.notes ? <button type="button" className="todo-title-button" aria-expanded={notesOpen} aria-controls={notesId} onClick={() => setNotesOpen((value) => !value)}>{task.title}</button>
              : <span className="todo-title-text">{task.title}</span>}
          <span className="todo-meta">
            {task.overdue && task.status !== 'done' && !archived ? <span className="todo-overdue">Overdue · </span> : null}
            {meta}
          </span>
          {notesOpen || (onOpen && task.notes) ? <p id={notesId} className="todo-notes-text">{task.notes}</p> : null}
        </div>
      </div>
      {check.error ? (
        <p className="app-error-text todo-row-status" role="alert">
          {check.error} <button type="button" className="ros-retry-link" onClick={async () => { await onRefresh(); check.retry() }}>Retry</button>
        </p>
      ) : null}
    </div>
  )
}

function AddRow({ ctx, onSaved, autoFocus = false }: { ctx: Ctx; onSaved: (task: TaskRecord) => void; autoFocus?: boolean }) {
  const blank: Draft = { title: '', date: '', assignee: '', notes: '' }
  const [draft, setDraft] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paste, setPaste] = useState<string[] | null>(null)
  const [batch, setBatch] = useState<{ id: string; lines: string[]; next: number } | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const [refocus, setRefocus] = useState(autoFocus ? 1 : 0)
  const scope = `save_task:${ctx.event.id}`

  // The title is disabled while saving; focus it once it is typeable again.
  useEffect(() => {
    if (refocus) titleRef.current?.focus()
  }, [refocus])
  const parsed = parseDateInput(draft.date, ctx.today)

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setError(null)
  }

  function create(title: string, requestScope: string) {
    return saveTask({
      workspaceId: ctx.workspace.id, eventId: ctx.event.id, taskId: null, title, notes: '',
      assigneeMembershipId: draft.assignee || null, dueDate: parsed || null, status: 'todo', expectedVersion: 1,
      requestKey: getRequestKey(requestScope),
    })
  }

  async function save() {
    if (busy) return
    if (!draft.title.trim()) { setError('Enter a to-do.'); return }
    if (parsed === null) { setError('Enter a date like fri or 10/17.'); return }
    setBusy(true)
    setError(null)
    try {
      const result = await create(draft.title.trim(), scope)
      clearRequestKey(scope)
      onSaved(result)
      // Keep the date and person: the next to-do usually shares them.
      setDraft((current) => ({ ...current, title: '', date: parsed ? formatDueDate(parsed, ctx.today) : '' }))
      setBusy(false)
      setRefocus((count) => count + 1)
    } catch (caught) {
      setError(toAppError(caught).message)
      setBusy(false)
    }
  }

  async function runBatch(run: { id: string; lines: string[]; next: number }) {
    if (parsed === null) { setError('Enter a date like fri or 10/17.'); return }
    setBusy(true)
    setError(null)
    for (let index = run.next; index < run.lines.length; index += 1) {
      setBatch({ ...run, next: index })
      const lineScope = `${scope}:paste:${run.id}:${index}`
      try {
        onSaved(await create(run.lines[index], lineScope))
        clearRequestKey(lineScope)
      } catch (caught) {
        setBatch({ ...run, next: index })
        setError(`Added ${index} of ${run.lines.length}. “${run.lines[index]}” didn’t save: ${toAppError(caught).message}`)
        setBusy(false)
        return
      }
    }
    setBatch(null)
    setBusy(false)
    setDraft((current) => ({ ...current, title: '' }))
    setRefocus((count) => count + 1)
  }

  function onPaste(clip: ClipboardEvent<HTMLInputElement>) {
    const lines = clip.clipboardData.getData('text').split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s+/i, '').trim().slice(0, 200))
      .filter(Boolean)
    if (lines.length < 2) return
    clip.preventDefault()
    setPaste(lines)
  }

  function onKeyDown(key: KeyboardEvent<HTMLDivElement>) {
    if (key.key === 'Escape') { key.preventDefault(); setDraft(blank); setError(null); return }
    if (key.key !== 'Enter' || key.target instanceof HTMLButtonElement) return
    key.preventDefault()
    void save()
  }

  const who = ctx.members.find((member) => member.id === draft.assignee)?.displayName
  const shared = [parsed ? formatDueDate(parsed, ctx.today) : null, who].filter(Boolean).join(' and ')

  return (
    <div role="listitem" className="todo-row todo-row-edit todo-add-row" onKeyDown={onKeyDown}>
      <div className="todo-cells">
        <span className="todo-check" aria-hidden="true" />
        <input ref={titleRef} className="todo-title-input" aria-label="New to-do" value={draft.title} maxLength={200}
          placeholder="Add a to-do" autoComplete="off" disabled={busy} onPaste={onPaste}
          onChange={(change) => update({ title: change.target.value })} />
        <div className="todo-date-cell">
          <input className="todo-date-input" aria-label="Date for new to-do" value={draft.date} placeholder="No date" autoComplete="off" disabled={busy}
            onChange={(change) => update({ date: change.target.value })}
            onBlur={() => { if (parsed) update({ date: formatDueDate(parsed, ctx.today) }) }} />
          {parsed && draft.date !== formatDueDate(parsed, ctx.today) ? <span className="todo-resolved">{formatDueDate(parsed, ctx.today)}</span> : null}
        </div>
        <select className="todo-person-select" aria-label="Person for new to-do" value={draft.assignee} disabled={busy}
          onChange={(change) => update({ assignee: change.target.value })}>
          <option value="">Unassigned</option>
          {ctx.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
        </select>
        <div className="todo-row-actions">
          <Button aria-label="Add to-do" busy={busy && !batch} busyLabel="Adding…" onClick={save}>Add</Button>
        </div>
      </div>
      <div className="todo-row-status" aria-live="polite">
        {batch && busy ? <span className="app-meta">Adding {batch.next + 1} of {batch.lines.length}…</span> : null}
        {error ? (
          <span className="app-error-text" role="alert">
            {error}{' '}
            {batch && !busy ? <button type="button" className="ros-retry-link" onClick={() => runBatch(batch)}>Retry remaining ({batch.lines.length - batch.next})</button> : null}
          </span>
        ) : null}
      </div>
      {paste ? (
        <ConfirmDialog title={`Add ${paste.length} to-dos?`}
          body={`One to-do per pasted line${shared ? `, each with ${shared}` : ''}.`}
          actionLabel={`Add ${paste.length} to-dos`}
          onCancel={() => setPaste(null)}
          onConfirm={() => { const run = { id: crypto.randomUUID(), lines: paste, next: 0 }; setPaste(null); void runBatch(run) }} />
      ) : null}
    </div>
  )
}

/** Phones: organizers edit a to-do in a full-screen sheet. */
function TaskSheet({ ctx, task, onClose, onSaved, onRemove }: {
  ctx: Ctx
  task: TaskRecord | null
  onClose: () => void
  onSaved: (task: TaskRecord) => void
  onRemove: (task: TaskRecord, version: number) => void
}) {
  const formId = useId()
  const [title, setTitle] = useState(task?.title ?? '')
  const [date, setDate] = useState(task?.dueDate ?? '')
  const [assignee, setAssignee] = useState(task?.assigneeMembershipId ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discard, setDiscard] = useState(false)
  const dirty = title !== (task?.title ?? '') || date !== (task?.dueDate ?? '') || assignee !== (task?.assigneeMembershipId ?? '') || notes !== (task?.notes ?? '')
  const scope = task ? `save_task:${task.id}` : `save_task:${ctx.event.id}`

  function requestClose() {
    if (busy) return
    if (dirty) setDiscard(true)
    else onClose()
  }

  async function save(submit: React.FormEvent) {
    submit.preventDefault()
    if (busy) return
    if (!title.trim()) { setError('Enter a to-do.'); return }
    setBusy(true)
    setError(null)
    try {
      const result = await saveTask({
        workspaceId: ctx.workspace.id, eventId: ctx.event.id, taskId: task?.id ?? null, title: title.trim(), notes,
        assigneeMembershipId: assignee || null, dueDate: date || null, status: task?.status ?? 'todo',
        expectedVersion: task?.version ?? 1, requestKey: getRequestKey(scope),
      })
      clearRequestKey(scope)
      onSaved(result)
    } catch (caught) {
      const failure = toAppError(caught)
      setError(failure.code === 'CONFLICT' ? 'Someone else changed this to-do. Close and reopen it to see the latest.' : failure.message)
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) requestClose() }}>
      <SheetContent className="app-task-sheet todo-sheet" showCloseButton={false} onInteractOutside={(event) => event.preventDefault()}>
        <SheetHeader>
          <div className="app-header-row">
            <SheetTitle>{task ? 'Edit to-do' : 'Add to-do'}</SheetTitle>
            <Button variant="quiet" disabled={busy} onClick={requestClose}>Close</Button>
          </div>
          <SheetDescription>{ctx.event.title}</SheetDescription>
        </SheetHeader>
        <form id={formId} className="app-panel-body" onSubmit={save}>
          <Field label="To-do"><input className="app-input" value={title} maxLength={200} disabled={busy} onChange={(change) => setTitle(change.target.value)} /></Field>
          <Field label="Date"><input className="app-input" type="date" value={date} disabled={busy} onChange={(change) => setDate(change.target.value)} /></Field>
          <Field label="Person"><select className="app-select" value={assignee} disabled={busy} onChange={(change) => setAssignee(change.target.value)}>
            <option value="">Unassigned</option>
            {task?.assigneeFormer && assignee === task.assigneeMembershipId ? <option value={assignee}>Former member</option> : null}
            {ctx.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
          </select></Field>
          <Field label="Notes"><textarea className="app-textarea" value={notes} maxLength={2000} disabled={busy} onChange={(change) => setNotes(change.target.value)} /></Field>
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
          {task ? <Button variant="quiet" disabled={busy} onClick={() => onRemove(task, task.version)}>Remove</Button> : null}
          <Button variant="secondary" disabled={busy} onClick={requestClose}>Cancel</Button>
          <Button busy={busy} busyLabel="Saving…" type="submit" form={formId}>{task ? 'Save' : 'Add'}</Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
