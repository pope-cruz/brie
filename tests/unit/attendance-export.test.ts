import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { attendanceExportCsv, sourceRowsCsv } from '../../src/app/lib/attendanceExport'

describe('attendanceExportCsv', () => {
  it('exports distinct attendance with source rows and quotes spreadsheet formulas', () => {
    const csv = attendanceExportCsv([{
      name: '=HYPERLINK("https://example.test")',
      email: 'ana@example.test',
      sources: [
        { fileLabel: 'Check-in, Friday.csv', rowNumber: 3, recordedAt: '2026-09-26T12:00:00Z' },
        { fileLabel: 'Follow-up.csv', rowNumber: 8, recordedAt: '2026-09-27T12:00:00Z' },
      ],
    }])
    const parsed = Papa.parse<string[]>(csv, { header: false })
    expect(parsed.data[1]).toEqual([
      "'=HYPERLINK(\"https://example.test\")",
      'ana@example.test',
      'attended',
      'Check-in, Friday.csv (row 3); Follow-up.csv (row 8)',
    ])
  })
})

describe('blank cells', () => {
  it('exports a person without a name as an empty cell, not a quote mark', () => {
    const csv = attendanceExportCsv([{ name: null, email: 'guest.desk@example.test', sources: [] }])
    const parsed = Papa.parse<string[]>(csv.slice(1), { header: false, skipEmptyLines: true })
    expect(parsed.data[1]).toEqual(['', 'guest.desk@example.test', 'attended', ''])
  })
})

describe('sourceRowsCsv', () => {
  it('rebuilds kept rows under their original headers and quotes spreadsheet formulas', () => {
    const csv = sourceRowsCsv(
      ['name', 'email', 'checked_in_at'],
      [
        ['Sasha Quinn', '', '2026-09-12 18:30:00'],
        ['Lee, "Jo"', 'jo@example.test', '+1 212'],
      ],
    )
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const parsed = Papa.parse<string[]>(csv.slice(1), { header: false, skipEmptyLines: true })
    expect(parsed.data).toEqual([
      ['name', 'email', 'checked_in_at'],
      ['Sasha Quinn', '', '2026-09-12 18:30:00'],
      ['Lee, "Jo"', 'jo@example.test', "'+1 212"],
    ])
  })
})
