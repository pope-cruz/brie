import { describe, expect, it } from 'vitest'
import { eventLocalDate, resolveLocalDateTime, formatTimeRange, listTimeZones } from '../../src/app/lib/timezone'

describe('resolveLocalDateTime', () => {
  it('rejects the spring-forward gap in New York', () => {
    const result = resolveLocalDateTime('2026-03-08', '02:30', 'America/New_York')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('nonexistent')
  })

  it('requires an offset for the fall-back hour', () => {
    const result = resolveLocalDateTime('2026-11-01', '01:30', 'America/New_York')
    expect(result.ok).toBe(false)
    if (!result.ok && result.reason === 'ambiguous') {
      expect(result.options.length).toBe(2)
      const chosen = resolveLocalDateTime('2026-11-01', '01:30', 'America/New_York', result.options[0].offset)
      expect(chosen.ok).toBe(true)
    }
  })

  it('accepts an ordinary local time', () => {
    const result = resolveLocalDateTime('2026-06-12', '18:00', 'America/New_York')
    expect(result.ok).toBe(true)
  })

  it.each([
    ['', '18:00'],
    ['2026-06-12', ''],
    ['275761-01-01', '18:00'],
    ['2026-02-31', '18:00'],
    ['2026-06-12', '25:00'],
  ])('rejects incomplete or invalid input without throwing (%s %s)', (date, time) => {
    expect(() => resolveLocalDateTime(date, time, 'America/New_York')).not.toThrow()
    expect(resolveLocalDateTime(date, time, 'America/New_York')).toEqual({
      ok: false,
      reason: 'nonexistent',
    })
  })

  it('reads the event-local date from a UTC instant', () => {
    expect(eventLocalDate('2026-06-13T02:00:00.000Z', 'America/New_York')).toBe('2026-06-12')
  })
})

describe('schedule timezone regressions', () => {
  it('uses event-local clock time rather than interpreting it as UTC', () => {
    expect(resolveLocalDateTime('2026-09-17', '19:30', 'America/New_York')).toMatchObject({ ok: true, iso: '2026-09-17T23:30:00.000Z' })
  })
  it('detects the half-hour repeated time on Lord Howe Island', () => {
    const result = resolveLocalDateTime('2026-04-05', '01:45', 'Australia/Lord_Howe')
    expect(result).toMatchObject({ ok: false, reason: 'ambiguous' })
    if (!result.ok && result.reason === 'ambiguous') {
      expect(result.options.map((option) => option.offset)).toEqual(['+11:00', '+10:30'])
    }
  })
  it('rejects unsupported zones without crashing a form', () => {
    expect(resolveLocalDateTime('2026-09-17', '19:30', 'Not/AZone')).toEqual({ ok: false, reason: 'nonexistent' })
  })
})

it('shows both offsets when a schedule crosses daylight saving', () => {
  const range = formatTimeRange('2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', 'America/New_York')
  expect(range).toContain('UTC-04:00')
  expect(range).toContain('UTC-05:00')
})
it('includes UTC in the timezone picker', () => expect(listTimeZones()).toContain('UTC'))
