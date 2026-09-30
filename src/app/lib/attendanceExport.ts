import type { AttendanceExportRow, WorkspaceAttendanceField, WorkspaceAttendanceRow } from '../data/types'

function cell(value: string): string {
  // Spreadsheet apps may evaluate imported text as a formula, including after spaces.
  const safe = '=+-@'.includes(value.trimStart().charAt(0)) ? `'${value}` : value
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

export const workspaceAttendanceFieldOptions: Array<{ key: WorkspaceAttendanceField; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'eventsAttended', label: 'Number of events attended' },
  { key: 'firstAttended', label: 'First attended date' },
  { key: 'lastAttended', label: 'Last attended date' },
  { key: 'eventTitles', label: 'Event titles' },
  { key: 'sources', label: 'Sources (file and row)' },
]

export function workspaceAttendanceExportCsv(rows: WorkspaceAttendanceRow[], fields: WorkspaceAttendanceField[]): string {
  const value = (row: WorkspaceAttendanceRow, field: WorkspaceAttendanceField): string => {
    if (field === 'eventTitles') return (row.eventTitles ?? []).join('; ')
    if (field === 'sources') return (row.sources ?? []).map((source) => `${source.fileLabel} (row ${source.rowNumber})`).join('; ')
    return String(row[field] ?? '')
  }
  const lines = [fields.map((field) => workspaceAttendanceFieldOptions.find((option) => option.key === field)?.label ?? field)]
  for (const row of rows) lines.push(fields.map((field) => value(row, field)))
  return '\uFEFF' + lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}
