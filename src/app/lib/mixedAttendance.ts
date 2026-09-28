import type { MixedImportRow } from '../data/api'
import type {
  AttendanceStatus,
  PreviewGroup,
  PreviewRow,
  ProposedChange,
  RsvpStatus,
  StatusMap,
  StatusRule,
} from '../data/types'
import type { ParsedCsv } from './csv'
import { isValidEmail, normalizeEmail } from './email'

/**
 * Mixed attendance import (registration exports with RSVP, check-in and no-show).
 * The database classifies rows authoritatively (prepare_mixed_attendance_import).
 * This module builds the organizer's mapping and mirrors the rules only to show
 * a live estimate while mapping. RSVP never implies attendance, and anything
 * blank, unmapped or unrecognized is unknown.
 */

/** "every-row" means the organizer confirmed every row in the file attended. */
export type AttendanceSource = number | 'every-row' | null

export type ColumnMapping = {
  email: number | null
  name: number | null
  rsvp: number | null
  attendance: AttendanceSource
  timestamp: number | null
  phone: number | null
  affiliation: number | null
}

export type ValueMap<S extends string> = {
  /** Keyed by the source value as first seen in the file; null follows `other`. */
  values: Record<string, S | null>
  /** Status for every other non-blank value; unknown when null. */
  other: S | null
}

export type ClassifiedRow = {
  rowNumber: number
  email: string
  name: string
  rsvp: RsvpStatus
  attendance: AttendanceStatus
  group: PreviewGroup
  contributes: boolean
}

export const SAMPLE_VALUE_LIMIT = 12

const ATTENDANCE_HEADER = /check(ed)?[\s_-]*in|attended|attendance|present|no[\s_-]*show/i
const RSVP_HEADER = /rsvp|approval|will you attend|attending|going|registration status|response|^status$/i
const TIMESTAMP_HEADER = /timestamp|created[\s_-]*at|registered[\s_-]*at|submitted|^date$/i
const PHONE_HEADER = /phone|mobile|^tel/i
const AFFILIATION_HEADER = /school|organi[sz]ation|company|affiliation|university|employer/i

function findHeader(labels: string[], pattern: RegExp, taken: Array<number | null>): number | null {
  const index = labels.findIndex((label, position) => !taken.includes(position) && pattern.test(label.trim()))
  return index >= 0 ? index : null
}

function exactHeader(labels: string[], names: string[]): number | null {
  const index = labels.findIndex((label) => names.includes(label.trim().toLowerCase()))
  return index >= 0 ? index : null
}

/** Best-guess columns. The organizer can change every one before review. */
export function guessColumns(labels: string[]): ColumnMapping {
  const email = exactHeader(labels, ['email', 'email address', 'e-mail'])
  const name = exactHeader(labels, ['name', 'full name'])
  const taken: Array<number | null> = [email, name]
  const attendance = findHeader(labels, ATTENDANCE_HEADER, taken)
  taken.push(attendance)
  const rsvp = findHeader(labels, RSVP_HEADER, taken)
  taken.push(rsvp)
  const timestamp = findHeader(labels, TIMESTAMP_HEADER, taken)
  taken.push(timestamp)
  const phone = findHeader(labels, PHONE_HEADER, taken)
  taken.push(phone)
  const affiliation = findHeader(labels, AFFILIATION_HEADER, taken)
  return { email, name, rsvp, attendance, timestamp, phone, affiliation }
}

/** Distinct non-blank source values in first-seen order, matched as the server does. */
export function sampleSourceValues(rows: ParsedCsv['rows'], index: number | null): string[] {
  if (index == null) return []
  const seen = new Set<string>()
  const values: string[] = []
  for (const row of rows) {
    const value = (row.values[index] ?? '').trim()
    const key = value.toLowerCase()
    if (value === '' || seen.has(key)) continue
    seen.add(key)
    values.push(value)
  }
  return values
}

/** RSVP only describes intent, so a guess is safe; attendance is never guessed. */
export function suggestRsvp(value: string): RsvpStatus | null {
  const key = value.trim().toLowerCase()
  if (/^(yes|y|approved|accepted|going|registered|confirmed|attending|invited)$/.test(key)) return 'yes'
  if (/^(no|n|declined|rejected|not going|cancell?ed|not attending)$/.test(key)) return 'no'
  return null
}

export function defaultRsvpMap(values: string[]): ValueMap<RsvpStatus> {
  return { values: Object.fromEntries(values.map((value) => [value, suggestRsvp(value)])), other: null }
}

/** Attendance starts unknown for every value until the organizer decides. */
export function defaultAttendanceMap(values: string[]): ValueMap<AttendanceStatus> {
  return { values: Object.fromEntries(values.map((value) => [value, null])), other: null }
}

function toRule<S extends string>(map: ValueMap<S> | null): StatusRule<S> | null {
  if (!map) return null
  const values: Record<string, S> = {}
  for (const [value, status] of Object.entries(map.values)) {
    if (status != null) values[value] = status
  }
  return { values, otherNonBlank: map.other }
}

export function buildStatusMap(
  columns: Pick<ColumnMapping, 'rsvp' | 'attendance'>,
  rsvpMap: ValueMap<RsvpStatus> | null,
  attendanceMap: ValueMap<AttendanceStatus> | null,
): StatusMap {
  return {
    rsvp: columns.rsvp == null ? null : toRule(rsvpMap),
    attendance:
      columns.attendance === 'every-row'
        ? { everyRow: 'attended' }
        : columns.attendance == null
          ? null
          : toRule(attendanceMap),
  }
}

/** True when some value (or "every row") would be counted as attended. */
export function marksAnyoneAttended(statusMap: StatusMap): boolean {
  const rule = statusMap.attendance
  if (!rule) return false
  if (rule.everyRow === 'attended' || rule.otherNonBlank === 'attended') return true
  return Object.values(rule.values ?? {}).includes('attended')
}

export function applyStatusRule<S extends string>(
  value: string,
  rule: StatusRule<S> | null | undefined,
): S | 'unknown' {
  if (!rule) return 'unknown'
  if (rule.everyRow) return rule.everyRow
  const key = value.trim().toLowerCase()
  if (key === '') return 'unknown'
  for (const [source, status] of Object.entries(rule.values ?? {})) {
    if (source.trim().toLowerCase() === key) return status
  }
  return rule.otherNonBlank ?? 'unknown'
}

function cell(row: ParsedCsv['rows'][number], index: number | null | 'every-row'): string {
  return typeof index === 'number' ? (row.values[index] ?? '') : ''
}

/** The rows sent to prepare_mixed_attendance_import. Values are sent only to keep the original rows. */
export function buildMixedRows(rows: ParsedCsv['rows'], columns: ColumnMapping, keepSource: boolean): MixedImportRow[] {
  return rows.map((row) => {
    const payload: MixedImportRow = {
      rowNumber: row.rowNumber,
      email: cell(row, columns.email),
      name: cell(row, columns.name),
    }
    if (columns.rsvp != null) payload.rsvp = cell(row, columns.rsvp)
    if (typeof columns.attendance === 'number') payload.attendance = cell(row, columns.attendance)
    if (columns.timestamp != null) payload.timestamp = cell(row, columns.timestamp)
    if (columns.phone != null) payload.phone = cell(row, columns.phone)
    if (columns.affiliation != null) payload.affiliation = cell(row, columns.affiliation)
    if (keepSource) payload.values = row.values
    return payload
  })
}

/**
 * Local estimate of the server's classification, before anything is sent. It
 * cannot know who is already recorded, so it never reports already-recorded rows.
 */
export function classifyRows(rows: ParsedCsv['rows'], columns: ColumnMapping, statusMap: StatusMap): ClassifiedRow[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const email = normalizeEmail(cell(row, columns.email))
    const name = cell(row, columns.name).trim()
    const rsvp = applyStatusRule(cell(row, columns.rsvp), statusMap.rsvp)
    const attendance = applyStatusRule(cell(row, columns.attendance), statusMap.attendance)
    let group: PreviewGroup
    if (email === '' || !isValidEmail(email)) group = 'needs-review'
    else if (seen.has(email)) group = 'duplicate'
    else group = attendance === 'attended' ? 'will-count' : 'wont-count'
    if (email !== '' && isValidEmail(email)) seen.add(email)
    return { rowNumber: row.rowNumber, email, name, rsvp, attendance, group, contributes: group === 'will-count' }
  })
}

export function countGroups(rows: Array<{ group?: PreviewGroup }>): Record<PreviewGroup, number> {
  const counts: Record<PreviewGroup, number> = { 'will-count': 0, 'wont-count': 0, 'needs-review': 0, duplicate: 0 }
  for (const row of rows) if (row.group) counts[row.group] += 1
  return counts
}

export const GROUP_ORDER: PreviewGroup[] = ['will-count', 'wont-count', 'needs-review', 'duplicate']

export const GROUP_LABELS: Record<PreviewGroup, string> = {
  'will-count': 'Will count',
  'wont-count': 'Won’t count',
  'needs-review': 'Needs review',
  duplicate: 'Duplicates',
}

/** Server rows grouped for review, preserving file order inside each group. */
export function groupPreviewRows(rows: PreviewRow[]): Record<PreviewGroup, PreviewRow[]> {
  const groups: Record<PreviewGroup, PreviewRow[]> = { 'will-count': [], 'wont-count': [], 'needs-review': [], duplicate: [] }
  for (const row of rows) groups[row.group ?? groupForOutcome(row.outcome)].push(row)
  return groups
}

export function groupForOutcome(outcome: PreviewRow['outcome']): PreviewGroup {
  if (outcome === 'new' || outcome === 'already_recorded') return 'will-count'
  if (outcome === 'not_counted') return 'wont-count'
  if (outcome === 'duplicate') return 'duplicate'
  return 'needs-review'
}

export const RSVP_LABELS: Record<RsvpStatus, string> = { yes: 'RSVP yes', no: 'RSVP no', unknown: 'RSVP unknown' }
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  attended: 'Attended',
  no_show: 'No-show',
  unknown: 'Attendance unknown',
}

/** One sentence per proposed change. Proposals are never applied by the import. */
export function describeChange(change: ProposedChange): string {
  if (change.field === 'name') {
    return `${change.email}: the file says “${change.to ?? ''}”; the stored name “${change.from ?? 'none'}” is kept.`
  }
  return `${change.email}: the file says no-show; the recorded attendance is kept.`
}
