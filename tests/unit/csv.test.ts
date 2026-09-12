import { describe, expect, it } from 'vitest'
import { parseAttendanceCsv } from '../../src/app/lib/csv'

describe('parseAttendanceCsv', () => {
  it('parses quoted commas and keeps row numbers', () => {
    const parsed = parseAttendanceCsv('name,email\n"Lee, Jordan",jordan@example.edu\n')
    if ('error' in parsed) throw new Error(parsed.error.message)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0].rowNumber).toBe(2)
    expect(parsed.rows[0].values[0]).toBe('Lee, Jordan')
  })

  it('counts blank rows separately', () => {
    const parsed = parseAttendanceCsv('name,email\nAlex,alex@example.edu\n,\n')
    if ('error' in parsed) throw new Error(parsed.error.message)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.blankRowCount).toBe(1)
  })

  it('rejects header-only files', () => {
    const parsed = parseAttendanceCsv('name,email\n')
    expect('error' in parsed).toBe(true)
  })

  it('labels repeated headers', () => {
    const parsed = parseAttendanceCsv('email,email\nalex@example.edu,other@example.edu\n')
    if ('error' in parsed) throw new Error(parsed.error.message)
    expect(parsed.headerLabels[1]).toBe('email (2)')
  })
})
