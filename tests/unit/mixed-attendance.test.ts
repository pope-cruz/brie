import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAttendanceCsv, type ParsedCsv } from '../../src/app/lib/csv'

/**
 * Target contract for mixed attendance imports. Outcome tests stay skipped
 * until the PR named in each title. Database storage, contribution counts,
 * unresolved identity, and privileges are checked in
 * supabase/tests/attendance_mixed.sql (PR 2); rollback stays pending there.
 *
 * Organizer map these tests assume:
 * - Luma `approval_status`: approved = RSVP yes, declined = RSVP no, blank = unknown.
 *   `checked_in_at`: any non-blank value means attended; blank means unknown.
 * - Google Form `Will you attend?`: Yes = RSVP yes, No = RSVP no, blank = unknown.
 *   `Checked in at the door?`: Yes = attended, No = no-show; Maybe, blank, and
 *   any other value mean unknown.
 * RSVP never implies attendance. An unmapped attendance column is unknown.
 */

type RsvpStatus = 'yes' | 'no' | 'unknown'
type AttendanceStatus = 'attended' | 'no_show' | 'unknown'
type PreviewGroup = 'will-count' | 'wont-count' | 'needs-review' | 'duplicate'

type ClassifiedRow = {
  rowNumber: number
  email: string
  name: string
  rsvp: RsvpStatus
  attendance: AttendanceStatus
  group: PreviewGroup
  contributes: boolean
}

function readFixture(name: string): ParsedCsv {
  const text = readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
  const parsed = parseAttendanceCsv(text)
  if ('error' in parsed) throw new Error(parsed.error.message)
  return parsed
}

function cell(parsed: ParsedCsv, rowNumber: number, header: string): string {
  const index = parsed.headers.indexOf(header)
  const row = parsed.rows.find((item) => item.rowNumber === rowNumber)
  if (index < 0 || !row) throw new Error(`Missing ${header} on row ${rowNumber}`)
  return row.values[index] ?? ''
}

function classifyRow(fixture: string, rowNumber: number, attendanceMapped: boolean): ClassifiedRow {
  throw new Error(
    `Pending classification for ${fixture} row ${rowNumber} (attendance mapped: ${attendanceMapped}). Unskip only in the PR named on the test.`,
  )
}

function sampleSourceValues(fixture: string, header: string): string[] {
  throw new Error(`Pending sample values for ${fixture} column ${header}. Enabled by PR 3.`)
}

function mappedColumns(fixture: string): Record<string, string | null> {
  throw new Error(`Pending column mapping for ${fixture}. Enabled by PR 3.`)
}

function repeatLumaImport(scenario: string): {
  additions: string[]
  changes: Array<{ email: string; field: string; from: string; to: string }>
  attendanceCount: number
} {
  throw new Error(`Pending repeat-import check (${scenario}). Enabled by PR 5.`)
}

describe('mixed attendance fixtures', () => {
  it('parses the Luma-style guest export', () => {
    const parsed = readFixture('mixed-attendance-luma.csv')
    expect(parsed.headers).toEqual([
      'name',
      'email',
      'phone_number',
      'approval_status',
      'checked_in_at',
      'created_at',
    ])
    expect(parsed.rows.map((row) => row.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    expect(parsed.blankRowCount).toBe(0)
    expect(cell(parsed, 2, 'email')).toBe('mira.okonkwo@example.test')
    expect(cell(parsed, 2, 'approval_status')).toBe('approved')
    expect(cell(parsed, 2, 'checked_in_at')).toBe('2026-09-12 18:04:00')
    expect(cell(parsed, 3, 'approval_status')).toBe('approved')
    expect(cell(parsed, 3, 'checked_in_at')).toBe('')
    expect(cell(parsed, 4, 'approval_status')).toBe('declined')
    expect(cell(parsed, 5, 'approval_status')).toBe('')
    expect(cell(parsed, 5, 'checked_in_at')).toBe('')
    expect(cell(parsed, 6, 'name')).toBe('')
    expect(cell(parsed, 6, 'email')).toBe('guest.desk@example.test')
    expect(cell(parsed, 7, 'email')).toBe('mira.okonkwo@example.test')
    expect(cell(parsed, 8, 'email')).toBe('sasha.quinn@example.test')
    expect(cell(parsed, 9, 'name')).toBe('Sasha Quinn')
    expect(cell(parsed, 9, 'email')).toBe('')
    expect(cell(parsed, 9, 'phone_number')).toBe('+12125550188')
    for (const row of parsed.rows) {
      const email = row.values[parsed.headers.indexOf('email')] ?? ''
      if (email !== '') expect(email.endsWith('@example.test')).toBe(true)
    }
  })

  it('parses the Google Form response sheet', () => {
    const parsed = readFixture('mixed-attendance-google-form.csv')
    expect(parsed.headers).toEqual([
      'Timestamp',
      'Email Address',
      'Full name',
      'Will you attend?',
      'Checked in at the door?',
      'Phone number',
      'School or organization',
    ])
    expect(parsed.rows.map((row) => row.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(parsed.blankRowCount).toBe(0)
    expect(cell(parsed, 2, 'Will you attend?')).toBe('Yes')
    expect(cell(parsed, 2, 'Checked in at the door?')).toBe('Yes')
    expect(cell(parsed, 3, 'Checked in at the door?')).toBe('No')
    expect(cell(parsed, 4, 'Will you attend?')).toBe('No')
    expect(cell(parsed, 4, 'Checked in at the door?')).toBe('')
    expect(cell(parsed, 5, 'Will you attend?')).toBe('Yes')
    expect(cell(parsed, 5, 'Checked in at the door?')).toBe('')
    expect(cell(parsed, 6, 'Email Address')).toBe('elio.marquez@example.test')
    expect(cell(parsed, 7, 'Full name')).toBe('Quinn Ibarra')
    expect(cell(parsed, 7, 'Email Address')).toBe('')
    expect(cell(parsed, 8, 'Will you attend?')).toBe('')
    expect(cell(parsed, 8, 'Checked in at the door?')).toBe('')
    expect(cell(parsed, 9, 'Checked in at the door?')).toBe('Maybe')
    expect(cell(parsed, 10, 'Email Address')).toBe('quinn.ibarra@example.test')
    expect(cell(parsed, 10, 'Checked in at the door?')).toBe('No')
    for (const row of parsed.rows) {
      const email = row.values[parsed.headers.indexOf('Email Address')] ?? ''
      if (email !== '') expect(email.endsWith('@example.test')).toBe(true)
    }
  })
})

describe('mixed attendance target outcomes', () => {
  // Enabled by PR 3: mapping UI. Unskip when the organizer map is applied.
  it.skip('PR 3: checked-in rows keep RSVP yes separate from attendance attended', () => {
    expect(classifyRow('luma', 2, true)).toMatchObject({
      email: 'mira.okonkwo@example.test',
      name: 'Mira Okonkwo',
      rsvp: 'yes',
      attendance: 'attended',
    })
    expect(classifyRow('google-form', 2, true)).toMatchObject({
      email: 'priya.raman@example.test',
      name: 'Priya Raman',
      rsvp: 'yes',
      attendance: 'attended',
    })
  })

  // Enabled by PR 3. A blank check-in is unknown, not attended.
  it.skip('PR 3: RSVP yes with a blank check-in stays attendance unknown', () => {
    expect(classifyRow('luma', 3, true)).toMatchObject({
      email: 'jules.navarro@example.test',
      rsvp: 'yes',
      attendance: 'unknown',
    })
    expect(classifyRow('google-form', 5, true)).toMatchObject({
      email: 'rowan.kim@example.test',
      rsvp: 'yes',
      attendance: 'unknown',
    })
  })

  // Enabled by PR 3. Declined / RSVP no does not set attendance.
  it.skip('PR 3: RSVP no stays separate and does not set attendance', () => {
    expect(classifyRow('luma', 4, true)).toMatchObject({
      email: 'ren.sato@example.test',
      rsvp: 'no',
      attendance: 'unknown',
    })
    expect(classifyRow('google-form', 4, true)).toMatchObject({
      email: 'casey.adebayo@example.test',
      rsvp: 'no',
      attendance: 'unknown',
    })
  })

  // Enabled by PR 3. The organizer explicitly mapped check-in "No" to no-show.
  it.skip('PR 3: an explicit no-show value stays no-show while RSVP stays yes', () => {
    expect(classifyRow('google-form', 3, true)).toMatchObject({
      email: 'elio.marquez@example.test',
      rsvp: 'yes',
      attendance: 'no_show',
    })
    expect(classifyRow('google-form', 10, true)).toMatchObject({
      email: 'quinn.ibarra@example.test',
      name: 'Quinn Ibarra',
      rsvp: 'yes',
      attendance: 'no_show',
    })
  })

  // Enabled by PR 3. Blank RSVP and blank attendance are unknown.
  it.skip('PR 3: a blank status is unknown for both RSVP and attendance', () => {
    expect(classifyRow('luma', 5, true)).toMatchObject({
      email: 'noor.elsayed@example.test',
      rsvp: 'unknown',
      attendance: 'unknown',
    })
    expect(classifyRow('google-form', 8, true)).toMatchObject({
      email: 'samira.costa@example.test',
      rsvp: 'unknown',
      attendance: 'unknown',
    })
  })

  // Enabled by PR 3. Unrecognized attendance values default to unknown.
  it.skip('PR 3: an unrecognized attendance value defaults to unknown', () => {
    expect(classifyRow('google-form', 9, true)).toMatchObject({
      email: 'niall.berg@example.test',
      rsvp: 'yes',
      attendance: 'unknown',
    })
  })

  // Enabled by PR 3. Unmapped attendance defaults to unknown, including a check-in timestamp.
  it.skip('PR 3: an unmapped attendance column defaults every row to unknown', () => {
    expect(classifyRow('luma', 2, false)).toMatchObject({
      email: 'mira.okonkwo@example.test',
      rsvp: 'yes',
      attendance: 'unknown',
    })
    expect(classifyRow('google-form', 2, false)).toMatchObject({
      email: 'priya.raman@example.test',
      rsvp: 'yes',
      attendance: 'unknown',
    })
  })

  // Enabled by PR 3. Distinct non-blank source values, first-seen order.
  it.skip('PR 3: mapping shows sample source values for RSVP and attendance columns', () => {
    expect(sampleSourceValues('luma', 'approval_status')).toEqual(['approved', 'declined'])
    expect(sampleSourceValues('luma', 'checked_in_at')).toEqual([
      '2026-09-12 18:04:00',
      '2026-09-12 18:10:00',
      '2026-09-12 18:22:00',
      '2026-09-12 18:30:00',
    ])
    expect(sampleSourceValues('google-form', 'Will you attend?')).toEqual(['Yes', 'No'])
    expect(sampleSourceValues('google-form', 'Checked in at the door?')).toEqual(['Yes', 'No', 'Maybe'])
  })

  // Enabled by PR 3. These columns are optional context, not identity or attendance.
  it.skip('PR 3: phone, timestamp, and affiliation columns are optional and do not set attendance', () => {
    expect(mappedColumns('luma')).toEqual({
      rsvp: 'approval_status',
      attendance: 'checked_in_at',
      timestamp: 'created_at',
      phone: 'phone_number',
      affiliation: null,
    })
    expect(mappedColumns('google-form')).toEqual({
      rsvp: 'Will you attend?',
      attendance: 'Checked in at the door?',
      timestamp: 'Timestamp',
      phone: 'Phone number',
      affiliation: 'School or organization',
    })
  })

  // Enabled by PR 4. The email-less row stays in needs-review and is not merged by name.
  it.skip('PR 4: a missing email is needs-review and is not grouped with the same name', () => {
    expect(classifyRow('luma', 8, true)).toMatchObject({
      email: 'sasha.quinn@example.test',
      name: 'Sasha Quinn',
      group: 'will-count',
      contributes: true,
    })
    expect(classifyRow('luma', 9, true)).toMatchObject({
      email: '',
      name: 'Sasha Quinn',
      rsvp: 'yes',
      attendance: 'attended',
      group: 'needs-review',
      contributes: false,
    })
    expect(classifyRow('google-form', 10, true)).toMatchObject({
      email: 'quinn.ibarra@example.test',
      name: 'Quinn Ibarra',
      group: 'wont-count',
      contributes: false,
    })
    expect(classifyRow('google-form', 7, true)).toMatchObject({
      email: '',
      name: 'Quinn Ibarra',
      rsvp: 'yes',
      attendance: 'attended',
      group: 'needs-review',
      contributes: false,
    })
  })

  // Enabled by PR 4. The later row is a duplicate and does not contribute again.
  it.skip('PR 4: a duplicate email is one will-count or wont-count person, not two', () => {
    expect(classifyRow('luma', 2, true)).toMatchObject({
      email: 'mira.okonkwo@example.test',
      group: 'will-count',
      contributes: true,
    })
    expect(classifyRow('luma', 7, true)).toMatchObject({
      email: 'mira.okonkwo@example.test',
      group: 'duplicate',
      contributes: false,
    })
    expect(classifyRow('google-form', 3, true)).toMatchObject({
      email: 'elio.marquez@example.test',
      group: 'wont-count',
      contributes: false,
    })
    expect(classifyRow('google-form', 6, true)).toMatchObject({
      email: 'elio.marquez@example.test',
      group: 'duplicate',
      contributes: false,
    })
  })

  // Enabled by PR 4. Only explicitly confirmed attendance is in will-count.
  it.skip('PR 4: will-count contains only explicitly confirmed attendance', () => {
    const luma = [2, 3, 4, 5, 6, 7, 8, 9].map((rowNumber) => classifyRow('luma', rowNumber, true))
    const google = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((rowNumber) => classifyRow('google-form', rowNumber, true))
    expect(luma.filter((row) => row.group === 'will-count').map((row) => row.email)).toEqual([
      'mira.okonkwo@example.test',
      'guest.desk@example.test',
      'sasha.quinn@example.test',
    ])
    expect(google.filter((row) => row.group === 'will-count').map((row) => row.email)).toEqual([
      'priya.raman@example.test',
    ])
    expect(luma.filter((row) => row.group === 'wont-count').map((row) => row.email)).toEqual([
      'jules.navarro@example.test',
      'ren.sato@example.test',
      'noor.elsayed@example.test',
    ])
    expect(google.filter((row) => row.group === 'wont-count').map((row) => row.email)).toEqual([
      'elio.marquez@example.test',
      'casey.adebayo@example.test',
      'rowan.kim@example.test',
      'samira.costa@example.test',
      'niall.berg@example.test',
      'quinn.ibarra@example.test',
    ])
    expect([...luma, ...google].filter((row) => row.contributes).every((row) => row.attendance === 'attended')).toBe(true)
  })

  // Enabled by PR 4. The import screen stops telling organizers that every valid row counts.
  it.skip('PR 4: removes the mixed-list warning from the import screen', () => {
    const source = readFileSync(new URL('../../src/app/features/attendance/ImportPage.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('counts every valid row in the file as attended')
  })

  // Enabled by PR 5. A second import of the same file adds no attendance.
  it.skip('PR 5: importing the Luma fixture again proposes no additions and does not count anyone twice', () => {
    expect(repeatLumaImport('same file')).toEqual({
      additions: [],
      changes: [],
      attendanceCount: 3,
    })
  })

  // Enabled by PR 5. A different display name is a proposed change, not a silent overwrite.
  it.skip('PR 5: a renamed repeat row is a proposed change and does not overwrite the stored name', () => {
    expect(repeatLumaImport('Mira Okonkwo renamed to Mira O.')).toEqual({
      additions: [],
      changes: [{ email: 'mira.okonkwo@example.test', field: 'name', from: 'Mira Okonkwo', to: 'Mira O.' }],
      attendanceCount: 3,
    })
  })
})
