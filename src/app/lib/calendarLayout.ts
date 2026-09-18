import type { SegmentRecord } from '../data/types'
import { clockToMinutes } from './timeInput'
import { splitInZone } from './timezone'

type Person = { id: string; displayName: string }

export type CalendarBlock = {
  segment: SegmentRecord
  /** Minutes from midnight of the column's day; can pass 24:00 for items that run overnight. */
  start: number
  end: number
  lane: number
  lanes: number
}

export type CalendarColumn = {
  key: string
  day: string
  /** The person this column is for; null means everyone. */
  personId: string | null
  label: string
  blocks: CalendarBlock[]
}

export type CalendarLayout = { columns: CalendarColumn[]; startMinute: number; endMinute: number }

/**
 * Side-by-side lanes for overlapping items. Items that overlap, directly or through a chain,
 * share the column width equally; an item that overlaps nothing takes the full width.
 */
function assignLanes(blocks: Omit<CalendarBlock, 'lane' | 'lanes'>[]): CalendarBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)
  const placed: CalendarBlock[] = []
  let group: CalendarBlock[] = []
  let groupEnd = -Infinity
  const laneEnds: number[] = []
  const closeGroup = () => {
    const lanes = Math.max(1, ...group.map((block) => block.lane + 1))
    for (const block of group) block.lanes = lanes
    placed.push(...group)
    group = []
    laneEnds.length = 0
  }
  for (const block of sorted) {
    if (block.start >= groupEnd) { closeGroup(); groupEnd = -Infinity }
    let lane = laneEnds.findIndex((end) => end <= block.start)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = block.end
    group.push({ ...block, lane, lanes: 1 })
    groupEnd = Math.max(groupEnd, block.end)
  }
  closeGroup()
  return placed
}

/**
 * Lays out a day's schedule as a time grid: one column per day, or per day and person.
 * Everyone items (no person) repeat in every person column. Hours run from the start of the
 * earliest item's hour to the end of the latest item's hour, not midnight to midnight.
 */
export function layoutCalendar(items: SegmentRecord[], options: {
  timezone: string
  days: string[]
  byPerson: boolean
  people: Person[]
}): CalendarLayout {
  const positioned = items.map((segment) => {
    const start = splitInZone(segment.startsAt, options.timezone)
    const startMinute = clockToMinutes(start.time)
    const length = Math.max(1, Math.round((Date.parse(segment.endsAt) - Date.parse(segment.startsAt)) / 60_000))
    return { segment, day: start.date, start: startMinute, end: startMinute + length }
  })
  const days = [...new Set([...options.days, ...positioned.map((item) => item.day)])].sort()

  const owners = options.byPerson
    ? options.people.filter((person) => positioned.some((item) => item.segment.ownerMembershipId === person.id))
    : []
  // Items for people who aren't listed (a former member) still need a column.
  const others = options.byPerson
    ? [...new Set(positioned.map((item) => item.segment.ownerMembershipId).filter((id): id is string => Boolean(id) && !owners.some((person) => person.id === id)))]
    : []
  const personColumns: Array<{ id: string | null; label: string }> = options.byPerson && owners.length + others.length > 0
    ? [...owners.map((person) => ({ id: person.id, label: person.displayName })), ...others.map((id) => ({ id, label: 'Former member' }))]
    : [{ id: null, label: 'Everyone' }]

  const columns: CalendarColumn[] = []
  for (const day of days) {
    for (const person of personColumns) {
      const mine = positioned.filter((item) => item.day === day && (person.id === null || !item.segment.ownerMembershipId || item.segment.ownerMembershipId === person.id))
      columns.push({
        key: `${day}:${person.id ?? 'everyone'}`,
        day,
        personId: person.id,
        label: person.label,
        blocks: assignLanes(mine.map(({ segment, start, end }) => ({ segment, start, end }))),
      })
    }
  }

  const starts = positioned.map((item) => item.start)
  const ends = positioned.map((item) => item.end)
  const startMinute = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 17 * 60
  const endMinute = ends.length ? Math.max(startMinute + 60, Math.ceil(Math.max(...ends) / 60) * 60) : 22 * 60
  return { columns, startMinute, endMinute }
}

/** A buffer is an item named "Buffer"; it is drawn dashed. */
export function isBuffer(segment: Pick<SegmentRecord, 'title'>) {
  return /^buffer\b/i.test(segment.title.trim())
}
