import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { attendanceExportCsv, importSourceCsv } from '../../src/app/lib/attendanceExport'

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

  it('leaves empty cells empty and keeps original rows in source order', () => {
    const csv = importSourceCsv({
      batchId: 'b',
      fileLabel: 'guests.csv',
      headers: ['name', 'email', 'phone'],
      retainedUntil: '2026-12-27T00:00:00Z',
      rows: [
        { rowNumber: 2, values: ['', 'guest.desk@example.test', '+12125550111'] },
        { rowNumber: 9, values: ['Sasha Quinn', '', ''] },
      ],
    })
    expect(Papa.parse<string[]>(csv, { header: false, skipEmptyLines: true }).data).toEqual([
      ['source_row', 'name', 'email', 'phone'],
      ['2', '', 'guest.desk@example.test', "'+12125550111"],
      ['9', 'Sasha Quinn', '', ''],
    ])
    expect(attendanceExportCsv([{ name: null, email: 'a@example.test', sources: [] }])).toContain('"","a@example.test"')
  })
})
