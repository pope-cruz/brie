import type { EventRecord, MemberRole, SegmentRecord } from '../data/types'
import { eventLocalDate } from './timezone'

/** Everyone, the signed-in person's items, or one person's membership id. */
export type Who = 'everyone' | 'mine' | (string & {})

type Timed = Pick<SegmentRecord, 'id' | 'startsAt' | 'endsAt'>

/**
 * "Now" on every item running at `now`, "Next" on the first item to start after it.
 * Labels only appear on a day the schedule covers, in the event's zone, so an
 * event weeks away never shows "Next".
 */
export function scheduleMarks(
  items: Timed[],
  event: Pick<EventRecord, 'startsAt' | 'endsAt' | 'timezone'>,
  now = new Date(),
): Map<string, 'now' | 'next'> {
  const marks = new Map<string, 'now' | 'next'>()
  if (items.length === 0) return marks
  const zone = event.timezone
  const firstIso = items.reduce((min, item) => (item.startsAt < min ? item.startsAt : min), event.startsAt)
  const lastIso = items.reduce((max, item) => (item.endsAt > max ? item.endsAt : max), event.endsAt)
  const today = eventLocalDate(now.toISOString(), zone)
  if (today < eventLocalDate(firstIso, zone) || today > eventLocalDate(lastIso, zone)) return marks

  const at = now.getTime()
  let next: Timed | null = null
  for (const item of items) {
    const start = new Date(item.startsAt).getTime()
    if (start <= at && at < new Date(item.endsAt).getTime()) marks.set(item.id, 'now')
    else if (start > at && (!next || start < new Date(next.startsAt).getTime())) next = item
  }
  if (next) marks.set(next.id, 'next')
  return marks
}

/** Mine and a named person both include Everyone items (no owner). */
export function filterSchedule<T extends Pick<SegmentRecord, 'ownerMembershipId'>>(items: T[], who: Who, myMembershipId: string) {
  if (who === 'everyone') return items
  const person = who === 'mine' ? myMembershipId : who
  return items.filter((item) => !item.ownerMembershipId || item.ownerMembershipId === person)
}

export function defaultWho(role: MemberRole): Who {
  return role === 'member' ? 'mine' : 'everyone'
}

/** URL first, then the last choice in this workspace, then the role default. Unknown people fall back. */
export function resolveWho(fromUrl: string | null, stored: string | null, role: MemberRole, personIds: string[]): Who {
  const valid = (value: string | null): value is Who =>
    value === 'everyone' || value === 'mine' || (value !== null && personIds.includes(value))
  if (valid(fromUrl)) return fromUrl
  if (valid(stored)) return stored
  return defaultWho(role)
}

const storageKey = (workspaceId: string) => `brie:schedule-who:${workspaceId}`

export function readStoredWho(workspaceId: string) {
  try { return localStorage.getItem(storageKey(workspaceId)) } catch { return null }
}

export function storeWho(workspaceId: string, who: Who) {
  try { localStorage.setItem(storageKey(workspaceId), who) } catch { /* private mode: the URL still carries it */ }
}
