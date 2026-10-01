import type { VenueComparison } from '../data/types'

export type VenueFilters = {
  query: string
  type: 'all' | VenueComparison['venueType']
  minCapacity: number | null
  sort: 'name' | 'capacity' | 'lastUsed'
}

export const DEFAULT_VENUE_FILTERS: VenueFilters = { query: '', type: 'all', minCapacity: null, sort: 'name' }

export const MAX_COMPARED_VENUES = 4

/** Reads filters from the list URL so a filtered list can be shared or reloaded. */
export function readVenueFilters(params: URLSearchParams): VenueFilters {
  const type = params.get('type')
  const sort = params.get('sort')
  return {
    query: params.get('q') ?? '',
    type: type === 'nyu_room' || type === 'outside' ? type : 'all',
    minCapacity: parseHeadcount(params.get('min') ?? ''),
    sort: sort === 'capacity' || sort === 'lastUsed' ? sort : 'name',
  }
}

/** A whole, non-negative number of people, or null for blank or unreadable input. */
export function parseHeadcount(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d{1,6}$/.test(trimmed)) return null
  return Number(trimmed)
}

function matchesQuery(venue: VenueComparison, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [venue.name, venue.address, venue.accessibility, venue.equipment, venue.restrictions, venue.notes]
    .some((field) => field.toLowerCase().includes(needle))
}

export function filterVenues(venues: VenueComparison[], filters: VenueFilters): VenueComparison[] {
  const kept = venues.filter((venue) =>
    matchesQuery(venue, filters.query)
    && (filters.type === 'all' || venue.venueType === filters.type)
    // An unknown capacity is kept: it might fit, and hiding it would hide the venue.
    && (filters.minCapacity == null || venue.capacity == null || venue.capacity >= filters.minCapacity))
  const byName = (a: VenueComparison, b: VenueComparison) => a.name.localeCompare(b.name)
  if (filters.sort === 'capacity') {
    return kept.sort((a, b) => (b.capacity ?? -1) - (a.capacity ?? -1) || byName(a, b))
  }
  if (filters.sort === 'lastUsed') {
    return kept.sort((a, b) => (b.usage.lastUsedOn ?? '').localeCompare(a.usage.lastUsedOn ?? '') || byName(a, b))
  }
  return kept.sort(byName)
}

export type VenueFit = {
  /** False when something rules the venue out; problems are listed, not hidden. */
  suitable: boolean
  problems: string[]
  notes: string[]
}

/** Why a venue does or doesn't suit one event. Needs a venue compared for that event. */
export function assessVenueFit(venue: VenueComparison, headcount: number | null): VenueFit {
  const problems: string[] = []
  const notes: string[] = []
  if (venue.removedAt) problems.push('Archived')
  if (headcount != null) {
    if (venue.capacity == null) notes.push('Capacity not recorded')
    else if (venue.capacity < headcount) problems.push(`Too small: holds ${venue.capacity}, need ${headcount}`)
    else notes.push(`Holds ${venue.capacity}`)
  }
  if (venue.fit) {
    const conflicts = venue.fit.conflicts
    if (conflicts.length === 1) problems.push(`Also linked to ${conflicts[0].title} at the same time`)
    else if (conflicts.length > 1) problems.push(`Also linked to ${conflicts.length} other events at the same time`)
    if (venue.leadTimeDays > 0) {
      if (venue.fit.requestByPassed) problems.push(`Needed a request by ${formatDay(venue.fit.requestBy)} (${plural(venue.leadTimeDays, 'day')} ahead)`)
      else notes.push(`Request by ${formatDay(venue.fit.requestBy)}`)
    }
  }
  return { suitable: problems.length === 0, problems, notes }
}

/** Suitable venues first, keeping the chosen sort within each group. */
export function rankByFit(venues: VenueComparison[], headcount: number | null) {
  const assessed = venues.map((venue) => ({ venue, fit: assessVenueFit(venue, headcount) }))
  return [...assessed.filter((row) => row.fit.suitable), ...assessed.filter((row) => !row.fit.suitable)]
}

export function venueTypeLabel(type: VenueComparison['venueType']) {
  return type === 'nyu_room' ? 'NYU room' : 'Outside venue'
}

export function lastUsedLabel(venue: VenueComparison) {
  const { pastEventCount: count, lastUsedOn, largestAttendance } = venue.usage
  if (!lastUsedOn) return 'Not used yet'
  return `${plural(count, 'past event')} · last ${formatDay(lastUsedOn)}${largestAttendance ? ` · up to ${largestAttendance} attended` : ''}`
}

/** Formats a calendar date (YYYY-MM-DD) without shifting it through a time zone. */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, date)))
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}
