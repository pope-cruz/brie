import { describe, expect, it } from 'vitest'
import { isBuffer, layoutCalendar } from '../../src/app/lib/calendarLayout'

const zone = 'America/New_York'
// Times are EDT (UTC-4) on Tuesday, Oct 20.
function item(id: string, start: string, end: string, owner: string | null = null) {
  return {
    id, workspaceId: 'w', eventId: 'e', title: id, startsAt: `2026-10-${start}:00Z`, endsAt: `2026-10-${end}:00Z`,
    ownerMembershipId: owner, ownerName: null, ownerFormer: false, instructions: '', removedAt: null, version: 1, overlaps: false, outOfRange: false,
  }
}
const people = [{ id: 'sam', displayName: 'Sam' }, { id: 'ana', displayName: 'Ana' }, { id: 'bo', displayName: 'Bo' }]
const summary = (layout: ReturnType<typeof layoutCalendar>) => layout.columns.map((column) => ({
  label: column.label, day: column.day,
  blocks: column.blocks.map((block) => `${block.segment.id} ${block.start}-${block.end} ${block.lane}/${block.lanes}`),
}))

describe('layoutCalendar', () => {
  it('runs hours from the earliest item to the latest, and sizes blocks by duration', () => {
    const layout = layoutCalendar([item('doors', '20T22:15', '20T23:00'), item('panel', '20T23:00', '21T00:45')], { timezone: zone, days: ['2026-10-20'], byPerson: false, people })
    expect(layout.startMinute).toBe(18 * 60)
    expect(layout.endMinute).toBe(21 * 60)
    expect(summary(layout)).toEqual([{ label: 'Everyone', day: '2026-10-20', blocks: ['doors 1095-1140 0/1', 'panel 1140-1245 0/1'] }])
  })

  it('shares width among overlapping items and gives back full width after', () => {
    const layout = layoutCalendar([
      item('a', '20T22:00', '20T23:00'), item('b', '20T22:30', '20T23:30'), item('c', '20T23:00', '20T23:15'), item('d', '21T00:00', '21T00:30'),
    ], { timezone: zone, days: ['2026-10-20'], byPerson: false, people })
    expect(summary(layout)[0].blocks).toEqual(['a 1080-1140 0/2', 'b 1110-1170 1/2', 'c 1140-1155 0/2', 'd 1200-1230 0/1'])
  })

  it('makes a column per person with items, repeating Everyone items in each', () => {
    const layout = layoutCalendar([
      item('doors', '20T22:00', '20T22:30'), item('desk', '20T22:00', '20T23:00', 'sam'), item('panel', '20T23:00', '21T00:00', 'ana'),
    ], { timezone: zone, days: ['2026-10-20'], byPerson: true, people })
    expect(summary(layout)).toEqual([
      { label: 'Sam', day: '2026-10-20', blocks: ['doors 1080-1110 0/2', 'desk 1080-1140 1/2'] },
      { label: 'Ana', day: '2026-10-20', blocks: ['doors 1080-1110 0/1', 'panel 1140-1200 0/1'] },
    ])
  })

  it('keeps one Everyone column when nobody is assigned', () => {
    const layout = layoutCalendar([item('doors', '20T22:00', '20T22:30')], { timezone: zone, days: ['2026-10-20'], byPerson: true, people })
    expect(layout.columns.map((column) => column.label)).toEqual(['Everyone'])
  })

  it('gives a former member their own column', () => {
    const layout = layoutCalendar([item('desk', '20T22:00', '20T23:00', 'gone')], { timezone: zone, days: ['2026-10-20'], byPerson: true, people })
    expect(layout.columns.map((column) => column.label)).toEqual(['Former member'])
  })

  it('puts each day in its own column and runs an overnight item past midnight', () => {
    const layout = layoutCalendar([item('late', '21T03:30', '21T05:00'), item('brunch', '21T15:00', '21T16:00')], { timezone: zone, days: ['2026-10-20', '2026-10-21'], byPerson: false, people })
    expect(summary(layout).map((column) => [column.day, column.blocks])).toEqual([
      ['2026-10-20', ['late 1410-1500 0/1']],
      ['2026-10-21', ['brunch 660-720 0/1']],
    ])
    expect(layout.endMinute).toBe(25 * 60)
  })

  it('sizes by real duration across the fall-back hour', () => {
    // Nov 1: 1:00–2:00 AM EDT, then 1:00 AM EST again. 12:30 AM EDT to 1:30 AM EST is two hours.
    const layout = layoutCalendar([{ ...item('x', '20T00:00', '20T00:00'), startsAt: '2026-11-01T04:30:00Z', endsAt: '2026-11-01T06:30:00Z' }], { timezone: zone, days: ['2026-11-01'], byPerson: false, people })
    expect(summary(layout)[0].blocks).toEqual(['x 30-150 0/1'])
  })

  it('shows a default evening when there is nothing yet', () => {
    const layout = layoutCalendar([], { timezone: zone, days: ['2026-10-20'], byPerson: false, people })
    expect([layout.startMinute, layout.endMinute, layout.columns.length]).toEqual([17 * 60, 22 * 60, 1])
  })

  it('lays out 200 items quickly', () => {
    const many = Array.from({ length: 200 }, (_, index) => {
      const start = new Date(Date.parse('2026-10-20T14:00:00Z') + index * 5 * 60_000)
      return { ...item(`i${index}`, '20T00:00', '20T00:00'), startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 20 * 60_000).toISOString(), ownerMembershipId: people[index % 3].id }
    })
    const began = performance.now()
    const layout = layoutCalendar(many, { timezone: zone, days: ['2026-10-20'], byPerson: true, people })
    expect(performance.now() - began).toBeLessThan(200)
    expect(layout.columns.reduce((sum, column) => sum + column.blocks.length, 0)).toBe(200)
  })
})

describe('isBuffer', () => {
  it('matches items named Buffer', () => {
    expect([isBuffer({ title: 'Buffer' }), isBuffer({ title: 'buffer before panel' }), isBuffer({ title: 'Buffet' })]).toEqual([true, true, false])
  })
})
