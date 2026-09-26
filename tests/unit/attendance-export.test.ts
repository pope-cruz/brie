import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { attendanceExportCsv } from '../../src/app/lib/attendanceExport'

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
