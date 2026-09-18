import { describe, expect, it } from 'vitest'
import { eventPhase } from '../../src/app/lib/eventPhase'

// 6–9 PM on Oct 20 in New York (EDT, UTC−4).
const event = { startsAt: '2026-10-20T22:00:00Z', endsAt: '2026-10-21T01:00:00Z', timezone: 'America/New_York' }

describe('eventPhase', () => {
  it('is before until the event date begins in the event zone', () => {
    expect(eventPhase(event, true, new Date('2026-10-20T03:59:00Z'))).toBe('before')
  })

  it('is day of from midnight in the event zone, even while the UTC date differs', () => {
    expect(eventPhase(event, true, new Date('2026-10-20T04:00:00Z'))).toBe('day-of')
    expect(eventPhase(event, true, new Date('2026-10-21T00:30:00Z'))).toBe('day-of')
  })

  it('is after once the event ends for people who manage attendance', () => {
    expect(eventPhase(event, true, new Date('2026-10-21T01:01:00Z'))).toBe('after')
  })

  it('keeps members on day of after the event ends', () => {
    expect(eventPhase(event, false, new Date('2026-10-22T12:00:00Z'))).toBe('day-of')
  })
})
