import type { EventRecord } from '../data/types'
import { eventLocalDate } from './timezone'

export type EventSectionId = 'before' | 'day-of' | 'after'

/** Where the event is in time, from the wall clock in the event's zone. */
export function eventPhase(
  event: Pick<EventRecord, 'startsAt' | 'endsAt' | 'timezone'>,
  seesAttendance: boolean,
  now = new Date(),
): EventSectionId {
  const today = eventLocalDate(now.toISOString(), event.timezone)
  if (today < eventLocalDate(event.startsAt, event.timezone)) return 'before'
  if (now > new Date(event.endsAt)) return seesAttendance ? 'after' : 'day-of'
  return 'day-of'
}
