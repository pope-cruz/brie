import { describe, expect, it } from 'vitest'
import { nyuRequestChecklist, outsideVenueEmailDraft } from '../../src/app/lib/bookingRequest'

const event = {
  title: 'Founder dinner', description: 'A small dinner for student founders.',
  location: 'West Hall', startsAt: '2026-12-01T18:00:00Z',
  endsAt: '2026-12-01T21:00:00Z', timezone: 'America/New_York', leadName: 'Ana',
}
const venue = {
  name: 'Community Hall', capacity: 80, address: '123 Main Street',
  accessibility: 'Step-free entrance', equipment: 'Projector',
  restrictions: 'No open flames', bookingLink: 'https://example.test/booking',
}

describe('venue request preparation', () => {
  it('builds a manual NYU checklist from event and venue details without inventing attendance', () => {
    const items = nyuRequestChecklist(event, venue)
    expect(items.map((item) => item.key)).toEqual([
      'event_details', 'date_time', 'attendance', 'accessibility',
      'equipment', 'restrictions', 'submit_request',
    ])
    expect(items.find((item) => item.key === 'attendance')?.detail).toContain('Confirm your expected attendance')
    expect(items.find((item) => item.key === 'attendance')?.detail).toContain('Venue capacity: 80')
    expect(items.find((item) => item.key === 'date_time')?.detail).toContain('America/New_York')
  })

  it('builds an editable outside-venue email draft with an explicit attendance placeholder', () => {
    const draft = outsideVenueEmailDraft(event, venue)
    expect(draft).toContain('Subject: Venue inquiry for Founder dinner')
    expect(draft).toContain('Event location: West Hall')
    expect(draft).toContain('Expected attendance: [add number]')
    expect(draft).toContain('A small dinner for student founders.')
    expect(draft).toContain('Ana')
  })
})
