import { describe, expect, it } from 'vitest'
import type { VenueComparison } from '../../src/app/data/types'
import {
  DEFAULT_VENUE_FILTERS,
  assessVenueFit,
  filterVenues,
  formatDay,
  lastUsedLabel,
  parseHeadcount,
  rankByFit,
  readVenueFilters,
  venueTypeLabel,
} from '../../src/app/lib/venueFit'

function venue(overrides: Partial<VenueComparison>): VenueComparison {
  return {
    id: overrides.name ?? 'venue', workspaceId: 'w', name: 'Venue', venueType: 'outside',
    capacity: 50, address: '', costNotes: '', accessibility: '', equipment: '',
    bookingContact: '', bookingLink: '', leadTimeDays: 0, restrictions: '', notes: '',
    removedAt: null, version: 1,
    usage: { pastEventCount: 0, lastUsedOn: null, largestAttendance: null },
    fit: null,
    ...overrides,
  }
}

const fit = (overrides: Partial<NonNullable<VenueComparison['fit']>> = {}) => ({
  requestBy: '2026-10-20', requestByPassed: false, linkedToEvent: false, conflicts: [], ...overrides,
})

describe('venue filters', () => {
  const venues = [
    venue({ name: 'Atrium', venueType: 'nyu_room', capacity: 80, accessibility: 'Step-free entrance', usage: { pastEventCount: 2, lastUsedOn: '2026-05-01', largestAttendance: 61 } }),
    venue({ name: 'Back room', capacity: 20, usage: { pastEventCount: 1, lastUsedOn: '2026-09-01', largestAttendance: 12 } }),
    venue({ name: 'Unknown size', capacity: null, equipment: 'Projector' }),
  ]

  it('searches text fields, filters type, and keeps unknown capacities', () => {
    expect(filterVenues(venues, { ...DEFAULT_VENUE_FILTERS, query: 'step-free' }).map((v) => v.name)).toEqual(['Atrium'])
    expect(filterVenues(venues, { ...DEFAULT_VENUE_FILTERS, query: 'projector' }).map((v) => v.name)).toEqual(['Unknown size'])
    expect(filterVenues(venues, { ...DEFAULT_VENUE_FILTERS, type: 'outside' }).map((v) => v.name)).toEqual(['Back room', 'Unknown size'])
    expect(filterVenues(venues, { ...DEFAULT_VENUE_FILTERS, minCapacity: 40 }).map((v) => v.name)).toEqual(['Atrium', 'Unknown size'])
  })

  it('sorts by capacity or most recent use, falling back to name', () => {
    expect(filterVenues(venues, { ...DEFAULT_VENUE_FILTERS, sort: 'capacity' }).map((v) => v.name)).toEqual(['Atrium', 'Back room', 'Unknown size'])
    expect(filterVenues(venues, { ...DEFAULT_VENUE_FILTERS, sort: 'lastUsed' }).map((v) => v.name)).toEqual(['Back room', 'Atrium', 'Unknown size'])
  })

  it('reads filters from the URL and ignores unknown values', () => {
    expect(readVenueFilters(new URLSearchParams('q=hall&type=nyu_room&min=40&sort=capacity'))).toEqual({ query: 'hall', type: 'nyu_room', minCapacity: 40, sort: 'capacity' })
    expect(readVenueFilters(new URLSearchParams('type=castle&min=-3&sort=price'))).toEqual(DEFAULT_VENUE_FILTERS)
  })

  it('accepts only whole headcounts', () => {
    expect(parseHeadcount(' 40 ')).toBe(40)
    expect(parseHeadcount('')).toBeNull()
    expect(parseHeadcount('4.5')).toBeNull()
    expect(parseHeadcount('forty')).toBeNull()
  })
})

describe('venue fit for an event', () => {
  it('explains a venue that fits', () => {
    expect(assessVenueFit(venue({ capacity: 60, leadTimeDays: 14, fit: fit() }), 40)).toEqual({
      suitable: true, problems: [], notes: ['Holds 60', 'Request by Oct 20, 2026'],
    })
  })

  it('lists every reason a venue does not fit instead of hiding it', () => {
    const result = assessVenueFit(venue({
      capacity: 20, leadTimeDays: 30, removedAt: '2026-09-01T00:00:00Z',
      fit: fit({ requestByPassed: true, conflicts: [{ id: 'e', title: 'Mixer', startsAt: '', endsAt: '', timezone: 'UTC' }] }),
    }), 40)
    expect(result.suitable).toBe(false)
    expect(result.problems).toEqual([
      'Archived',
      'Too small: holds 20, need 40',
      'Also linked to Mixer at the same time',
      'Needed a request by Oct 20, 2026 (30 days ahead)',
    ])
  })

  it('does not rule out an unknown capacity or judge capacity without a headcount', () => {
    expect(assessVenueFit(venue({ capacity: null, fit: fit() }), 40)).toEqual({ suitable: true, problems: [], notes: ['Capacity not recorded'] })
    expect(assessVenueFit(venue({ capacity: 5, fit: fit() }), null).suitable).toBe(true)
  })

  it('counts several conflicts and skips request dates when no lead time is needed', () => {
    const conflict = { id: 'e', title: 'x', startsAt: '', endsAt: '', timezone: 'UTC' }
    const result = assessVenueFit(venue({ leadTimeDays: 0, fit: fit({ requestByPassed: true, conflicts: [conflict, { ...conflict, id: 'f' }] }) }), null)
    expect(result.problems).toEqual(['Also linked to 2 other events at the same time'])
    expect(result.notes).toEqual([])
  })

  it('puts suitable venues first and keeps order within each group', () => {
    const ranked = rankByFit([
      venue({ name: 'A', capacity: 10, fit: fit() }),
      venue({ name: 'B', capacity: 90, fit: fit() }),
      venue({ name: 'C', capacity: 5, fit: fit() }),
      venue({ name: 'D', capacity: 70, fit: fit() }),
    ], 40)
    expect(ranked.map((row) => row.venue.name)).toEqual(['B', 'D', 'A', 'C'])
  })

  it('formats calendar dates without a time-zone shift', () => {
    expect(formatDay('2026-01-01')).toBe('Jan 1, 2026')
  })

  it('labels venue type and past use', () => {
    expect(venueTypeLabel('nyu_room')).toBe('NYU room')
    expect(lastUsedLabel(venue({}))).toBe('Not used yet')
    expect(lastUsedLabel(venue({ usage: { pastEventCount: 1, lastUsedOn: '2026-05-01', largestAttendance: 30 } }))).toBe('1 past event · last May 1, 2026 · up to 30 attended')
    expect(lastUsedLabel(venue({ usage: { pastEventCount: 3, lastUsedOn: '2026-05-01', largestAttendance: 0 } }))).toBe('3 past events · last May 1, 2026')
  })
})
