import type { AttendanceExportRow } from '../data/types'

function cell(value: string): string {
  // Spreadsheet apps may evaluate imported text as a formula, including after spaces.
  const first = value.trimStart().charAt(0)
  const safe = first !== '' && '=+-@'.includes(first) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function attendanceExportCsv(rows: AttendanceExportRow[]): string {
  const lines = [['name', 'email', 'attendance_status', 'sources']]
  for (const row of rows) {
    lines.push([
      row.name ?? '',
      row.email,
      'attended',
      row.sources.map((source) => `${source.fileLabel} (row ${source.rowNumber})`).join('; '),
    ])
  }
  return '\uFEFF' + lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}

// An import's kept original rows, as a CSV with the original headers.
export function sourceRowsCsv(headers: string[], rows: string[][]): string {
  return '\uFEFF' + [headers, ...rows].map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}
