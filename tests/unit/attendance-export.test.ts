import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { attendanceExportCsv, workspaceAttendanceExportCsv } from '../../src/app/lib/attendanceExport'

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

describe('workspaceAttendanceExportCsv', () => {
  it('exports only selected columns, in selected order, with distinct event facts', () => {
    const csv = workspaceAttendanceExportCsv([{
      name: 'Ana', email: 'ana@example.test', eventsAttended: 2,
      firstAttended: '2026-01-01', lastAttended: '2026-02-01',
      eventTitles: ['Dinner', 'Workshop'],
      sources: [{ fileLabel: 'dinner.csv', rowNumber: 2 }, { fileLabel: 'workshop.csv', rowNumber: 9 }],
    }], ['email', 'eventsAttended', 'eventTitles', 'sources'])
    expect(Papa.parse<string[]>(csv, { skipEmptyLines: true }).data).toEqual([
      ['Email', 'Number of events attended', 'Event titles', 'Sources (file and row)'],
      ['ana@example.test', '2', 'Dinner; Workshop', 'dinner.csv (row 2); workshop.csv (row 9)'],
    ])
  })

  it('quotes commas and line breaks and guards each exported cell against formulas', () => {
    const csv = workspaceAttendanceExportCsv([{
      name: '  =HYPERLINK("bad")',
      eventTitles: ['+SUM(1,2)', 'Dinner'],
      sources: [{ fileLabel: '@evil,\nfile.csv', rowNumber: 3 }],
    }], ['name', 'eventTitles', 'sources'])
    expect(Papa.parse<string[]>(csv).data[1]).toEqual([
      "'  =HYPERLINK(\"bad\")",
      "'+SUM(1,2); Dinner",
      "'@evil,\nfile.csv (row 3)",
    ])
  })
})
