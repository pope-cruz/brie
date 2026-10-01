import type { PlanDraft, PlanDraftChanges } from '../data/types'
import { eventLocalDate, formatInZone } from './timezone'

/** Adds whole days to a calendar date (YYYY-MM-DD) without a time-zone shift. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

export type DraftPreview = {
  todos: Array<{ dueDate: string | null }>
  schedule: Array<{ startsAt: string; endsAt: string; outsideEvent: boolean }>
}

/**
 * Where each proposed to-do and schedule item lands for a given start, the
 * same way accepting computes it: due dates count back from the event's local
 * day; schedule items are minutes from the start.
 */
export function previewDraft(draft: Pick<PlanDraft, 'todos' | 'schedule'>, startsAt: string, endsAt: string, timezone: string): DraftPreview {
  const startDay = eventLocalDate(startsAt, timezone)
  const start = Date.parse(startsAt)
  const end = Date.parse(endsAt)
  return {
    todos: draft.todos.map((todo) => ({ dueDate: todo.dueDaysBeforeEvent == null ? null : addDays(startDay, -todo.dueDaysBeforeEvent) })),
    schedule: draft.schedule.map((item) => {
      const itemStart = start + item.minutesFromStart * 60_000
      const itemEnd = itemStart + item.durationMinutes * 60_000
      return {
        startsAt: new Date(itemStart).toISOString(),
        endsAt: new Date(itemEnd).toISOString(),
        outsideEvent: itemStart < start || itemEnd > end,
      }
    }),
  }
}

export type DraftEdits = {
  title: string
  startsAt: string
  endsAt: string
  timezone: string
  includeVenue: boolean
  keptTodos: Set<number>
  keptSchedule: Set<number>
}

export function initialEdits(draft: PlanDraft): DraftEdits {
  return {
    title: draft.title,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    timezone: draft.timezone,
    includeVenue: Boolean(draft.venue && !draft.venue.archived),
    keptTodos: new Set(draft.todos.map((_, index) => index)),
    keptSchedule: new Set(draft.schedule.map((_, index) => index)),
  }
}

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b)

/** Only what the organizer changed, so accepting an untouched draft sends `{}`. */
export function acceptChanges(draft: PlanDraft, edits: DraftEdits): PlanDraftChanges {
  const changes: PlanDraftChanges = {}
  if (edits.title.trim() !== draft.title) changes.title = edits.title.trim()
  if (!sameInstant(edits.startsAt, draft.startsAt)) changes.startsAt = edits.startsAt
  if (!sameInstant(edits.endsAt, draft.endsAt)) changes.endsAt = edits.endsAt
  if (edits.timezone !== draft.timezone) changes.timezone = edits.timezone
  if (draft.venue && edits.includeVenue !== !draft.venue.archived) changes.includeVenue = edits.includeVenue
  if (edits.keptTodos.size !== draft.todos.length) changes.todoIndexes = [...edits.keptTodos].sort((a, b) => a - b)
  if (edits.keptSchedule.size !== draft.schedule.length) changes.scheduleIndexes = [...edits.keptSchedule].sort((a, b) => a - b)
  return changes
}

export function dueLabel(days: number | null) {
  if (days == null) return 'No due date'
  if (days === 0) return 'Due on the event day'
  if (days < 0) return `Due ${-days} day${days === -1 ? '' : 's'} after`
  return `Due ${days} day${days === 1 ? '' : 's'} before`
}

export function timeLabel(iso: string, timezone: string) {
  return formatInZone(iso, timezone, { month: undefined, day: undefined, year: undefined })
}
