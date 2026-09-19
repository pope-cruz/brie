import type { EventRecord, MemberRole, SegmentRecord } from '../data/types'
import { clockToMinutes, formatClock } from './timeInput'
import { eventLocalDate, formatInZone, splitInZone } from './timezone'

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

/** Mine and a named person both include Everyone items (no people). */
export function filterSchedule<T extends Pick<SegmentRecord, 'people'>>(items: T[], who: Who, myMembershipId: string) {
  if (who === 'everyone') return items
  const person = who === 'mine' ? myMembershipId : who
  return items.filter((item) => item.people.length === 0 || item.people.some((member) => member.id === person))
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

type MemberName = { id: string; displayName: string }

export function dayLabel(date: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`))
}

/** The people on an item, or null for Everyone. */
export function peopleLabel(segment: SegmentRecord, members: MemberName[]) {
  if (segment.people.length === 0) return null
  return segment.people.map((person) => person.former
    ? 'Former member'
    : members.find((member) => member.id === person.id)?.displayName || person.name).join(', ')
}

export function eventDateLabel(event: Pick<EventRecord, 'startsAt' | 'endsAt' | 'timezone'>) {
  const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: undefined, minute: undefined } as const
  const start = formatInZone(event.startsAt, event.timezone, options)
  if (eventLocalDate(event.startsAt, event.timezone) === eventLocalDate(event.endsAt, event.timezone)) return start
  return `${start} – ${formatInZone(event.endsAt, event.timezone, options)}`
}

export function eventTimeLabel(event: Pick<EventRecord, 'startsAt' | 'endsAt' | 'timezone'>) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: event.timezone, hour: 'numeric', minute: '2-digit' })
  return `${formatter.format(new Date(event.startsAt))}–${formatter.format(new Date(event.endsAt))}`
}

/** "6:30 PM – 7 PM", with the date only when it is not the event's first day. */
export function rowTimeLabel(segment: Pick<SegmentRecord, 'startsAt' | 'endsAt'>, event: Pick<EventRecord, 'startsAt' | 'timezone'>, showDates: boolean) {
  const start = splitInZone(segment.startsAt, event.timezone)
  const end = splitInZone(segment.endsAt, event.timezone)
  const range = `${formatClock(clockToMinutes(start.time))} – ${formatClock(clockToMinutes(end.time))}`
  const dated = showDates || start.date !== eventLocalDate(event.startsAt, event.timezone)
  return { date: dated ? dayLabel(start.date) : null, range: end.date !== start.date ? `${range} next day` : range }
}

export function byTime(a: SegmentRecord, b: SegmentRecord) {
  return a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt) || a.id.localeCompare(b.id)
}
