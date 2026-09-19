import { describe, expect, it } from 'vitest'
import { parseSchedulePaste } from '../../src/app/lib/schedulePaste'

const event = {
  startsAt: '2026-10-20T22:00:00Z', endsAt: '2026-10-21T02:00:00Z', timezone: 'America/New_York',
}
const members = [{ id: 'sam', displayName: 'Sam' }, { id: 'ana', displayName: 'Ana' }]

describe('parseSchedulePaste', () => {
  it('previews tab rows, multiple people, and a typed length', () => {
    const result = parseSchedulePaste('time\ttitle\tpeople\tnotes\n6:30p + 45m\tDoors open\tSam; Ana\tGreet guests', event, members, [])
    expect(result.error).toBeNull()
    expect(result.rows).toEqual([expect.objectContaining({
      rowNumber: 2, title: 'Doors open', personIds: ['sam', 'ana'],
      startsAt: '2026-10-20T22:30:00.000Z', endsAt: '2026-10-20T23:15:00.000Z', errors: [], warnings: [],
    })])
  })

  it('flags unmatched people and overlaps before saving', () => {
    const result = parseSchedulePaste('6:30p,Photos,Unknown,Bring camera\n6:30p,Welcome,Everyone,', event, members,
      [{ startsAt: '2026-10-20T22:00:00Z', endsAt: '2026-10-20T22:45:00Z' }])
    expect(result.rows[0].errors).toContain('Unmatched person: Unknown.')
    expect(result.rows[0].warnings).toContain('Overlaps another item')
    expect(result.rows[1].warnings).toContain('Overlaps another item')
  })

  it('does not silently resolve a repeated fall-back time', () => {
    const fall = { startsAt: '2026-11-01T04:00:00Z', endsAt: '2026-11-01T08:00:00Z', timezone: 'America/New_York' }
    expect(parseSchedulePaste('1:30a,Check-in,Sam,', fall, members, []).rows[0].errors)
      .toContain('Choose an unambiguous time for the clock change.')
  })
})
