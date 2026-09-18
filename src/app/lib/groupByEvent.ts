import type { TaskRecord } from '../data/types'

/** Tasks arrive overdue first, then by date; group by event in the order each event first appears. */
export function groupByEvent(rows: TaskRecord[]) {
  const groups = new Map<string, { eventId: string; eventTitle: string; tasks: TaskRecord[] }>()
  for (const row of rows) {
    const group = groups.get(row.eventId) ?? { eventId: row.eventId, eventTitle: row.eventTitle, tasks: [] }
    group.tasks.push(row)
    groups.set(row.eventId, group)
  }
  return [...groups.values()]
}
