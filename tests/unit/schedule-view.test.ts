import { describe, expect, it } from 'vitest'
import { filterSchedule, resolveWho, scheduleMarks } from '../../src/app/lib/scheduleView'

// 7:30–10:30 PM EDT on Thursday, Sep 17.
const event = { startsAt: '2026-09-17T23:30:00Z', endsAt: '2026-09-18T02:30:00Z', timezone: 'America/New_York' }
const item = (id: string, startsAt: string, endsAt: string) => ({ id, startsAt, endsAt })
const items = [
  item('doors', '2026-09-17T23:30:00Z', '2026-09-18T00:00:00Z'),
  item('panel', '2026-09-18T00:00:00Z', '2026-09-18T01:00:00Z'),
  item('photos', '2026-09-18T00:30:00Z', '2026-09-18T00:45:00Z'),
  item('cleanup', '2026-09-18T02:30:00Z', '2026-09-18T03:30:00Z'),
]
const marks = (now: string, list = items, ev = event) => Object.fromEntries(scheduleMarks(list, ev, new Date(now)))

describe('scheduleMarks', () => {
  it('marks every running item Now and the next start Next', () => {
    expect(marks('2026-09-18T00:35:00Z')).toEqual({ panel: 'now', photos: 'now', cleanup: 'next' })
  })

  it('treats an item as over at its end time', () => {
    expect(marks('2026-09-18T00:00:00Z')).toEqual({ panel: 'now', photos: 'next' })
  })

  it('shows only Next earlier on the event day and in gaps', () => {
    expect(marks('2026-09-17T14:00:00Z')).toEqual({ doors: 'next' })
    expect(marks('2026-09-18T01:30:00Z')).toEqual({ cleanup: 'next' })
  })

  it('shows nothing before the event day or after the last item', () => {
    expect(marks('2026-09-16T23:00:00Z')).toEqual({})
    expect(marks('2026-09-18T03:30:00Z')).toEqual({})
  })

  it('uses the event zone for the day, not UTC', () => {
    // 11 PM EDT on Sep 16 is already Sep 17 in UTC.
    expect(marks('2026-09-17T03:00:00Z')).toEqual({})
  })

  it('keeps an overnight item Now after midnight', () => {
    const late = [item('afterparty', '2026-09-18T03:30:00Z', '2026-09-18T05:00:00Z')]
    expect(marks('2026-09-18T04:30:00Z', late)).toEqual({ afterparty: 'now' })
  })

  it('reads the clock correctly across the fall-back change', () => {
    // Nov 1, 2026: 1:00–1:59 AM happens twice in New York.
    const dst = { startsAt: '2026-11-01T04:00:00Z', endsAt: '2026-11-01T08:00:00Z', timezone: 'America/New_York' }
    const list = [item('first', '2026-11-01T05:00:00Z', '2026-11-01T05:30:00Z'), item('second', '2026-11-01T06:00:00Z', '2026-11-01T06:30:00Z')]
    expect(marks('2026-11-01T05:40:00Z', list, dst)).toEqual({ second: 'next' })
    expect(marks('2026-11-01T06:10:00Z', list, dst)).toEqual({ second: 'now' })
  })
})

describe('filterSchedule', () => {
  const rows = [{ id: 'a', people: [] }, { id: 'b', people: [{ id: 'me' }] }, { id: 'c', people: [{ id: 'ana' }] }]
  it('keeps Everyone items for Mine and a named person', () => {
    expect(filterSchedule(rows, 'everyone', 'me').map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(filterSchedule(rows, 'mine', 'me').map((row) => row.id)).toEqual(['a', 'b'])
    expect(filterSchedule(rows, 'ana', 'me').map((row) => row.id)).toEqual(['a', 'c'])
  })

  it('includes an item for each of its assigned people', () => {
    const shared = [{ id: 'shared', people: [{ id: 'me' }, { id: 'ana' }] }]
    expect(filterSchedule(shared, 'mine', 'me')).toHaveLength(1)
    expect(filterSchedule(shared, 'ana', 'me')).toHaveLength(1)
  })
})

describe('resolveWho', () => {
  it('prefers the URL, then the stored choice, then the role default', () => {
    expect(resolveWho('ana', 'mine', 'owner', ['ana'])).toBe('ana')
    expect(resolveWho(null, 'mine', 'owner', ['ana'])).toBe('mine')
    expect(resolveWho(null, null, 'owner', ['ana'])).toBe('everyone')
    expect(resolveWho(null, null, 'member', ['ana'])).toBe('mine')
  })

  it('ignores a person who is not an active teammate', () => {
    expect(resolveWho('gone', 'gone', 'member', ['ana'])).toBe('mine')
  })
})
