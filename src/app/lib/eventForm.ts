import type { EventRecord } from '../data/types'
import { splitInZone } from './timezone'

/** Form values for an existing event, for the details panel. */
export function eventFormDefaults(event: EventRecord) {
  const start = splitInZone(event.startsAt, event.timezone)
  const end = splitInZone(event.endsAt, event.timezone)
  return {
    timezoneDefault: event.timezone, defaultTitle: event.title, defaultDescription: event.description || '',
    defaultLocation: event.location || '', defaultStartDate: start.date, defaultStartTime: start.time,
    defaultEndDate: end.date, defaultEndTime: end.time, defaultStartOffset: start.offset, defaultEndOffset: end.offset,
    defaultLead: event.leadMembershipId || '', defaultStatus: event.status, version: event.version, sourceId: event.id,
  }
}
