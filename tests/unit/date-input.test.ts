import { describe, expect, it } from 'vitest'
import { formatDueDate, parseDateInput } from '../../src/app/lib/dateInput'

// Friday, September 18, 2026.
const today = '2026-09-18'

describe('parseDateInput', () => {
  it.each([
    ['', ''], ['  ', ''],
    ['today', '2026-09-18'], ['tomorrow', '2026-09-19'], ['tmrw', '2026-09-19'],
    ['fri', '2026-09-18'], ['Friday', '2026-09-18'], ['sat', '2026-09-19'], ['thu', '2026-09-24'], ['wednesday', '2026-09-23'],
    ['10/17', '2026-10-17'], ['9/1', '2026-09-01'], ['1/5', '2027-01-05'], ['10/17/26', '2026-10-17'], ['10/17/2027', '2027-10-17'],
    ['Oct 17', '2026-10-17'], ['17 oct', '2026-10-17'], ['October 17, 2027', '2027-10-17'], ['sept 30', '2026-09-30'],
    ['2026-10-17', '2026-10-17'],
  ])('reads %j as %j', (text, expected) => {
    expect(parseDateInput(text, today)).toBe(expected)
  })

  it.each(['soon', 'fr', '13/1', '2/30', 'Octember 3', '2026-02-30'])('rejects %j', (text) => {
    expect(parseDateInput(text, today)).toBeNull()
  })
})

describe('round trip', () => {
  it.each(['2026-10-19', '2026-09-18', '2027-01-05', '2025-12-31'])('reads back its own label for %s', (date) => {
    expect(parseDateInput(formatDueDate(date, today), today)).toBe(date)
  })
})

describe('formatDueDate', () => {
  it('adds the year only outside this year', () => {
    expect(formatDueDate('2026-10-17', today)).toBe('Sat, Oct 17')
    expect(formatDueDate('2027-01-05', today)).toBe('Tue, Jan 5, 2027')
  })
})
