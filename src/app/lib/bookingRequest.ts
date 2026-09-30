import type { BookingRequestItemKey, EventRecord, Venue } from '../data/types'
import { formatTimeRange } from './timezone'

type EventDetails = Pick<EventRecord, 'title' | 'description' | 'location' | 'startsAt' | 'endsAt' | 'timezone' | 'leadName'>
type VenueDetails = Pick<Venue, 'name' | 'capacity' | 'address' | 'accessibility' | 'equipment' | 'restrictions' | 'bookingLink'>

export function nyuRequestChecklist(event: EventDetails, venue: VenueDetails): Array<{
  key: BookingRequestItemKey; label: string; detail: string
}> {
  return [
    { key: 'event_details', label: 'Event details', detail: `${event.title}. ${event.description || 'Add a description for the request.'} Lead: ${event.leadName || 'Assign a lead.'}` },
    { key: 'date_time', label: 'Date and time', detail: `${formatTimeRange(event.startsAt, event.endsAt, event.timezone)} · ${event.timezone}` },
    { key: 'attendance', label: 'Expected attendance', detail: `Confirm your expected attendance. ${venue.capacity == null ? 'Venue capacity is not recorded.' : `Venue capacity: ${venue.capacity}.`}` },
    { key: 'accessibility', label: 'Accessibility needs', detail: venue.accessibility || 'Confirm accessibility needs and available features.' },
    { key: 'equipment', label: 'Equipment needs', detail: venue.equipment || 'Confirm the equipment needed for this event.' },
    { key: 'restrictions', label: 'Room rules and location', detail: [venue.address || event.location, venue.restrictions].filter(Boolean).join(' · ') || 'Confirm room restrictions and location.' },
    { key: 'submit_request', label: 'Submit the request manually', detail: venue.bookingLink ? 'Open the booking link from the venue page and submit the request.' : 'Use the NYU room request process, then record the response here.' },
  ]
}

export function outsideVenueEmailDraft(event: EventDetails, venue: VenueDetails): string {
  const when = `${formatTimeRange(event.startsAt, event.endsAt, event.timezone)} (${event.timezone})`
  return [
    `Subject: Venue inquiry for ${event.title}`,
    '',
    'Hello,',
    '',
    `I’m planning ${event.title} and would like to ask about availability at ${venue.name}.`,
    `Date and time: ${when}`,
    `Event location: ${event.location || venue.address || 'To be confirmed'}`,
    event.description ? `Event details: ${event.description}` : '',
    'Expected attendance: [add number]',
    '',
    'Could you share availability, pricing, accessibility details, equipment, and the process for a hold?',
    '',
    'Thank you,',
    event.leadName || '[your name]',
  ].filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== '')).join('\n')
}
