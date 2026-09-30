import { isValidEmail, normalizeEmail } from './email'

// Mirrors the database rules in 0027_mixed_attendance_statuses.sql so the mapping
// step can show what a status map will do. The server stays authoritative: the
// review step shows its staged rows, not this classification.

export type RsvpStatus = 'yes' | 'no' | 'unknown'
export type AttendanceStatus = 'attended' | 'no_show' | 'unknown'

// Shape sent to prepare_mixed_attendance_import. Keys are source values; the
// server compares them trimmed and lower-cased. otherNonBlank applies to any
// non-blank value not listed. Blank is always unknown.
export type StatusRule<S extends string> = {
  values: Record<string, S>
  otherNonBlank: S | null
}

export type StatusMap = {
  rsvp: StatusRule<RsvpStatus> | null
  attendance: StatusRule<AttendanceStatus> | null
}

export type ColumnMapping = {
  email: number | null
  name: number | null
  rsvp: number | null
  attendance: number | null
  timestamp: number | null
  phone: number | null
  affiliation: number | null
}

export type MixedOutcome = 'new' | 'not_counted' | 'duplicate' | 'invalid' | 'unresolved'

// Review groups, as in preview_group (0029). Only will-count rows are recorded.
export type PreviewGroup = 'will-count' | 'wont-count' | 'needs-review' | 'duplicate'

export const PREVIEW_GROUPS: PreviewGroup[] = ['will-count', 'wont-count', 'needs-review', 'duplicate']

export function previewGroup(outcome: string): PreviewGroup {
  if (outcome === 'new' || outcome === 'already_recorded') return 'will-count'
  if (outcome === 'not_counted') return 'wont-count'
  if (outcome === 'duplicate') return 'duplicate'
  return 'needs-review'
}

export type ClassifiedRow = {
  rowNumber: number
  email: string
  name: string
  rsvp: RsvpStatus
  attendance: AttendanceStatus
  outcome: MixedOutcome
  group: PreviewGroup
  contributes: boolean
}

type Row = { rowNumber: number; values: string[] }

// At most this many distinct values get their own status choice; the rest share
// one "other values" choice. The server accepts up to 200.
export const MAX_LISTED_VALUES = 12

const GUESSES: Array<[keyof ColumnMapping, RegExp]> = [
  ['email', /^e-?mail$/],
  ['email', /e-?mail/],
  ['name', /^(name|full name|guest name|attendee name)$/],
  ['rsvp', /\brsvp\b|approval|registration status|will you attend|are you (coming|attending)|\bgoing\b/],
  ['attendance', /check(ed)?[\s_-]?in|\battended\b|\battendance\b|no[\s_-]?show|\bpresent\b/],
  ['timestamp', /timestamp|created[\s_-]?at|submitted|registered[\s_-]?at|registration (date|time)|^date$/],
  ['phone', /phone|mobile|\bcell\b/],
  ['affiliation', /school|organi[sz]ation|company|affiliation|university|college|employer/],
]

export function guessColumns(labels: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    email: null,
    name: null,
    rsvp: null,
    attendance: null,
    timestamp: null,
    phone: null,
    affiliation: null,
  }
  const used = new Set<number>()
  for (const [field, pattern] of GUESSES) {
    if (mapping[field] != null) continue
    const index = labels.findIndex((label, i) => !used.has(i) && pattern.test(label.trim().toLowerCase()))
    if (index >= 0) {
      mapping[field] = index
      used.add(index)
    }
  }
  return mapping
}

// The server keeps at most 200 characters of a status cell, then compares it
// trimmed and lower-cased.
export function sourceValue(value: string): string {
  return value.trim().slice(0, 200).trim()
}

export function statusKey(value: string): string {
  return sourceValue(value).toLowerCase()
}

export function cellAt(row: Row, index: number | null): string {
  return index == null ? '' : (row.values[index] ?? '')
}

// Distinct non-blank values in first-seen order, compared as the server compares
// them (trimmed, case-insensitive). The first spelling seen is kept.
export function sampleSourceValues(rows: Row[], index: number | null): string[] {
  if (index == null) return []
  const seen = new Set<string>()
  const values: string[] = []
  for (const row of rows) {
    const value = sourceValue(cellAt(row, index))
    const key = value.toLowerCase()
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    values.push(value)
  }
  return values
}

const DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?|^\d{1,2}\/\d{1,2}\/\d{2,4}|^\d{1,2}:\d{2}/

// Check-in columns often hold a time for everyone who arrived. Those get one
// choice for every non-blank value instead of a choice per time.
export function looksLikeTimes(values: string[]): boolean {
  return values.length > 0 && values.every((value) => DATE_LIKE.test(value.trim()))
}

const RSVP_YES = /^(yes|y|approved|accepted|going|attending|confirmed|registered|true)$/
const RSVP_NO = /^(no|n|declined|rejected|not going|cancell?ed|false)$/

// RSVP never decides attendance, so obvious RSVP values are filled in for the
// organizer to check. Attendance values are never suggested.
export function suggestRsvpRule(values: string[]): StatusRule<RsvpStatus> {
  const rule: StatusRule<RsvpStatus> = { values: {}, otherNonBlank: null }
  for (const value of values.slice(0, MAX_LISTED_VALUES)) {
    const key = statusKey(value)
    rule.values[value] = RSVP_YES.test(key) ? 'yes' : RSVP_NO.test(key) ? 'no' : 'unknown'
  }
  return rule
}

export function emptyRule<S extends string>(): StatusRule<S> {
  return { values: {}, otherNonBlank: null }
}

export function applyStatusRule<S extends string>(value: string, rule: StatusRule<S> | null): S | 'unknown' {
  const key = statusKey(value)
  if (!rule || key === '') return 'unknown'
  for (const [source, status] of Object.entries(rule.values)) {
    if (statusKey(source) === key) return status
  }
  return rule.otherNonBlank ?? 'unknown'
}

export function ruleMarksAttended(rule: StatusRule<AttendanceStatus> | null): boolean {
  if (!rule) return false
  return rule.otherNonBlank === 'attended' || Object.values(rule.values).includes('attended')
}

// Same order of checks as prepare_mixed_attendance_import: a missing email is
// unresolved, then invalid, then a repeat of an earlier email, then anything not
// attended is not counted.
export function classifyMixedRows(rows: Row[], mapping: ColumnMapping, statusMap: StatusMap): ClassifiedRow[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const email = normalizeEmail(cellAt(row, mapping.email))
    const rsvp = applyStatusRule(cellAt(row, mapping.rsvp), mapping.rsvp == null ? null : statusMap.rsvp)
    const attendance = applyStatusRule(
      cellAt(row, mapping.attendance),
      mapping.attendance == null ? null : statusMap.attendance,
    )
    const repeat = seen.has(email)
    seen.add(email)
    const outcome: MixedOutcome =
      email === ''
        ? 'unresolved'
        : !isValidEmail(email)
          ? 'invalid'
          : repeat
            ? 'duplicate'
            : attendance !== 'attended'
              ? 'not_counted'
              : 'new'
    return {
      rowNumber: row.rowNumber,
      email,
      name: cellAt(row, mapping.name).trim().slice(0, 200),
      rsvp,
      attendance,
      outcome,
      group: previewGroup(outcome),
      contributes: outcome === 'new',
    }
  })
}

// Rows for prepare_mixed_attendance_import. Unmapped columns are left out.
export function mixedImportRows(rows: Row[], mapping: ColumnMapping) {
  return rows.map((row) => {
    const item: Record<string, string | number> = {
      rowNumber: row.rowNumber,
      email: cellAt(row, mapping.email),
      name: cellAt(row, mapping.name),
    }
    for (const field of ['rsvp', 'attendance', 'timestamp', 'phone', 'affiliation'] as const) {
      if (mapping[field] != null) item[field] = cellAt(row, mapping[field])
    }
    return item
  })
}
