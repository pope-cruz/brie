import type { TaskRecord } from '../data/types'

/** Not done: overdue, then by date, then undated in list (creation) order. Done goes last. */
export function sortTodos(rows: TaskRecord[]) {
  const rank = (task: TaskRecord) => (task.status === 'done' ? 3 : task.overdue ? 0 : task.dueDate ? 1 : 2)
  return rows
    .map((task, index) => ({ task, index }))
    .sort((a, b) => rank(a.task) - rank(b.task) || (a.task.dueDate ?? '').localeCompare(b.task.dueDate ?? '') || a.index - b.index)
    .map((item) => item.task)
}
