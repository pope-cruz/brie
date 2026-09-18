import { describe, expect, it } from 'vitest'
import { formatClock, formatDuration, parseDurationInput, parseTimeInput } from '../../src/app/lib/timeInput'

const at = (hour: number, minute = 0) => hour * 60 + minute

describe('parseTimeInput', () => {
  it('reads explicit AM and PM in several spellings', () => {
    expect(parseTimeInput('6:30p')).toBe(at(18, 30))
    expect(parseTimeInput('6:30 PM')).toBe(at(18, 30))
    expect(parseTimeInput('6:30 p.m.')).toBe(at(18, 30))
    expect(parseTimeInput('12am')).toBe(at(0))
    expect(parseTimeInput('12pm')).toBe(at(12))
    expect(parseTimeInput('7a')).toBe(at(7))
  })

  it('reads 24-hour and compact times', () => {
    expect(parseTimeInput('18:30')).toBe(at(18, 30))
    expect(parseTimeInput('1830')).toBe(at(18, 30))
    expect(parseTimeInput('630', at(17))).toBe(at(18, 30))
    expect(parseTimeInput('06:00')).toBe(at(6))
    expect(parseTimeInput('0:15')).toBe(at(0, 15))
    expect(parseTimeInput('noon')).toBe(at(12))
    expect(parseTimeInput('midnight')).toBe(at(0))
  })

  it('picks AM or PM for a bare hour from the nearby schedule', () => {
    expect(parseTimeInput('6', at(17, 30))).toBe(at(18))
    expect(parseTimeInput('9', at(8))).toBe(at(9))
    expect(parseTimeInput('1', at(23, 30))).toBe(at(1))
    expect(parseTimeInput('11:30', at(9))).toBe(at(11, 30))
  })

  it('rejects what is not a time', () => {
    for (const value of ['', 'soon', '25:00', '13pm', '6:75', '0am']) expect(parseTimeInput(value)).toBeNull()
  })
})

describe('parseDurationInput', () => {
  it('reads minutes and hours', () => {
    expect(parseDurationInput('30')).toBe(30)
    expect(parseDurationInput('45m')).toBe(45)
    expect(parseDurationInput('45 min')).toBe(45)
    expect(parseDurationInput('1h')).toBe(60)
    expect(parseDurationInput('1 hr 30 min')).toBe(90)
    expect(parseDurationInput('1h30')).toBe(90)
    expect(parseDurationInput('1:30')).toBe(90)
    expect(parseDurationInput('1.5h')).toBe(90)
    expect(parseDurationInput('2 hours')).toBe(120)
  })

  it('rejects empty, zero, and nonsense lengths', () => {
    for (const value of ['', '0', 'long', '1:75', '-5']) expect(parseDurationInput(value)).toBeNull()
  })
})

describe('formatting', () => {
  it('writes clocks and lengths the way people say them', () => {
    expect(formatClock(at(18, 30))).toBe('6:30 PM')
    expect(formatClock(at(0))).toBe('12 AM')
    expect(formatClock(at(12, 5))).toBe('12:05 PM')
    expect(formatDuration(30)).toBe('30 min')
    expect(formatDuration(60)).toBe('1 hr')
    expect(formatDuration(95)).toBe('1 hr 35 min')
  })

  it('round-trips formatted values through the parsers', () => {
    expect(parseTimeInput(formatClock(at(18, 30)))).toBe(at(18, 30))
    expect(parseDurationInput(formatDuration(95))).toBe(95)
  })
})
