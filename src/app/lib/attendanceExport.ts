import type { AttendanceExportRow, ImportSource } from '../data/types'

function cell(value: string): string {
  // Spreadsheet apps may evaluate imported text as a formula, including after spaces.
  const first = value.trimStart().charAt(0)
  const safe = first !== '' && '=+-@'.includes(first) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

/** Spreadsheet-safe CSV (UTF-8 BOM, CRLF), used for every attendance download. */
export function csvFromLines(lines: string[][]): string {
  return '\uFEFF' + lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** The kept original rows of one import, with their source row numbers first. */
export function importSourceCsv(source: ImportSource): string {
  return csvFromLines([
    ['source_row', ...source.headers],
    ...source.rows.map((row) => [String(row.rowNumber), ...row.values]),
  ])
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
  return csvFromLines(lines)
}

export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
