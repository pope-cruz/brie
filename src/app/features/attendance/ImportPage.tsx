import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { Button, Field, StatusBadge } from '../../components/ui'
import {
  commitAttendanceImport,
  getImportPreview,
  lookupImportReceipt,
  prepareAttendanceImport,
  prepareMixedAttendanceImport,
} from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { toAppError } from '../../data/errors'
import type { EventRecord, ImportPreview } from '../../data/types'
import { CSV_MAX_BYTES, exampleCsv, parseAttendanceCsv } from '../../lib/csv'
import { fileSha256Hex, getRequestKey } from '../../lib/idempotency'
import {
  MAX_LISTED_VALUES,
  PREVIEW_GROUPS,
  classifyMixedRows,
  emptyRule,
  guessColumns,
  looksLikeTimes,
  mixedImportRows,
  previewGroup,
  ruleMarksAttended,
  sampleSourceValues,
  suggestRsvpRule,
  type AttendanceStatus,
  type ColumnMapping,
  type PreviewGroup,
  type RsvpStatus,
  type StatusRule,
} from '../../lib/mixedAttendance'

type Step = 'choose' | 'map' | 'review' | 'result'
type Row = { rowNumber: number; values: string[] }
// '' until the organizer decides; 'all' means the file lists only people who attended.
type AttendanceChoice = '' | 'all' | number

const NO_COLUMNS: ColumnMapping = {
  email: null,
  name: null,
  rsvp: null,
  attendance: null,
  timestamp: null,
  phone: null,
  affiliation: null,
}

const RSVP_OPTIONS: Array<{ value: RsvpStatus; label: string }> = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'yes', label: 'RSVP yes' },
  { value: 'no', label: 'RSVP no' },
]

const ATTENDANCE_OPTIONS: Array<{ value: AttendanceStatus; label: string }> = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'attended', label: 'Attended' },
  { value: 'no_show', label: 'No-show' },
]

function ColumnSelect({
  label,
  hint,
  value,
  headers,
  rows,
  emptyLabel,
  onChange,
}: {
  label: string
  hint?: string
  value: number | null
  headers: string[]
  rows: Row[]
  emptyLabel: string
  onChange: (value: number | null) => void
}) {
  return (
    <Field label={label} hint={hint}>
      <select
        className="app-select"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      >
        <option value="">{emptyLabel}</option>
        {headers.map((header, index) => (
          <option key={header + index} value={index}>
            {header}
            {rows[0] ? ` · e.g. ${rows[0].values[index] || '—'}` : ''}
          </option>
        ))}
      </select>
    </Field>
  )
}

// The organizer's choice of status for each source value in one column. A column
// of times gets a single choice for every non-blank value.
function StatusValues<S extends string>({
  title,
  values,
  rule,
  options,
  onChange,
}: {
  title: string
  values: string[]
  rule: StatusRule<S>
  options: Array<{ value: S; label: string }>
  onChange: (rule: StatusRule<S>) => void
}) {
  const listed = looksLikeTimes(values) ? [] : values.slice(0, MAX_LISTED_VALUES)
  const others = values.length - listed.length
  const pick = (value: string, onPick: (status: S | null) => void, current: S | null) => (
    <select
      className="app-select"
      aria-label={value}
      value={current ?? 'unknown'}
      onChange={(event) => onPick(event.target.value === 'unknown' ? null : (event.target.value as S))}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
  return (
    <fieldset className="app-field" style={{ border: 0, padding: 0 }}>
      <legend className="app-label">{title}</legend>
      {values.length === 0 ? <p className="app-meta">Every cell in this column is blank.</p> : null}
      {listed.map((value) => (
        <div key={value} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 12rem)', gap: 8, alignItems: 'center' }}>
          <span style={{ overflowWrap: 'anywhere' }}>“{value}”</span>
          {pick(
            `${title}: ${value}`,
            (status) => {
              const next = { ...rule.values }
              if (status) next[value] = status
              else delete next[value]
              onChange({ ...rule, values: next })
            },
            rule.values[value] ?? null,
          )}
        </div>
      ))}
      {others > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 12rem)', gap: 8, alignItems: 'center' }}>
          <span>
            {listed.length === 0 ? 'Any value' : `${others} other values`} · e.g. {values.slice(listed.length, listed.length + 2).join(', ')}
          </span>
          {pick(`${title}: ${listed.length === 0 ? 'any value' : 'other values'}`, (status) => onChange({ ...rule, otherNonBlank: status }), rule.otherNonBlank)}
        </div>
      ) : null}
      <p className="app-meta">Blank cells are always unknown.</p>
    </fieldset>
  )
}

type PreviewRow = ImportPreview['rows'][number]

const GROUP_TEXT: Record<PreviewGroup, { title: string; body: string; tone: 'done' | 'neutral' | 'warning' }> = {
  'will-count': { title: 'Will count as attended', body: 'Only these rows are recorded.', tone: 'done' },
  'wont-count': {
    title: 'Won’t count',
    body: 'RSVPs, no-shows, and unknown attendance. They are not recorded as attended.',
    tone: 'neutral',
  },
  'needs-review': {
    title: 'Can’t be matched',
    body: 'No email or an invalid email, so Brie can’t tell who this is. These rows are skipped; fix the file and import it again to count them.',
    tone: 'warning',
  },
  duplicate: { title: 'Duplicates', body: 'Later rows for an email already in this file. Only the first row is used.', tone: 'neutral' },
}

const ROWS_SHOWN = 20

function statusLine(row: PreviewRow) {
  if (!row.rsvp) return null
  const attendance = row.attendance === 'no_show' ? 'no-show' : row.attendance
  const source = row.attendanceSource ? ` (“${row.attendanceSource}”)` : ''
  return `RSVP ${row.rsvp} · attendance ${attendance}${source}`
}

function contextLine(row: PreviewRow) {
  return [row.phone, row.affiliation, row.timestamp].filter(Boolean).join(' · ')
}

function changeText(change: NonNullable<PreviewRow['changes']>[number]) {
  if (change.field === 'name') {
    return `Name in file “${change.to}”, stored as “${change.from || 'no name'}”. The stored name is kept.`
  }
  return 'This file says no-show, but an earlier import recorded this person as attended. That record is kept; revert the earlier import to remove it.'
}

function ProposedChanges({ rows }: { rows: PreviewRow[] }) {
  const changed = rows.filter((row) => (row.changes?.length ?? 0) > 0)
  if (changed.length === 0) return null
  return (
    <section aria-labelledby="preview-changes" style={{ marginTop: 16 }}>
      <h3 className="app-section-title" id="preview-changes">
        Differences from what’s recorded <StatusBadge tone="warning">{changed.length}</StatusBadge>
      </h3>
      <p className="app-meta">Recording this file doesn’t change any of these.</p>
      {changed.map((row) => (
        <div key={`change-${row.rowNumber}`} style={{ padding: '8px 0', borderBottom: '1px solid var(--app-border)' }}>
          <strong>Row {row.rowNumber}</strong> · {row.email}
          {row.changes?.map((change) => (
            <p key={change.field} className="app-meta">
              {changeText(change)}
            </p>
          ))}
        </div>
      ))}
    </section>
  )
}

function PreviewGroupSection({ group, rows }: { group: PreviewGroup; rows: PreviewRow[] }) {
  const [showAll, setShowAll] = useState(false)
  const text = GROUP_TEXT[group]
  const shown = showAll ? rows : rows.slice(0, ROWS_SHOWN)
  return (
    <section aria-labelledby={`preview-${group}`} style={{ marginTop: 16 }}>
      <h3 className="app-section-title" id={`preview-${group}`}>
        {text.title} <StatusBadge tone={text.tone}>{rows.length}</StatusBadge>
      </h3>
      <p className="app-meta">{text.body}</p>
      {shown.map((row) => (
        <div key={`${row.rowNumber}-${row.email}`} style={{ padding: '8px 0', borderBottom: '1px solid var(--app-border)' }}>
          <strong>Row {row.rowNumber}</strong> · {row.name || 'Name not provided'}
          {row.email ? ` · ${row.email}` : ''}
          {statusLine(row) ? <p className="app-meta">{statusLine(row)}</p> : null}
          {group === 'needs-review' && contextLine(row) ? <p className="app-meta">{contextLine(row)}</p> : null}
          <p className="app-meta">{row.reason}</p>
        </div>
      ))}
      {rows.length > shown.length ? (
        <Button variant="secondary" onClick={() => setShowAll(true)}>
          Show all {rows.length}
        </Button>
      ) : null}
    </section>
  )
}

export function ImportPage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [step, setStep] = useState<Step>('choose')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileLabel, setFileLabel] = useState('attendance.csv')
  const [fileHash, setFileHash] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [originalHeaders, setOriginalHeaders] = useState<string[]>([])
  const [keepSource, setKeepSource] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [blankCount, setBlankCount] = useState(0)
  const [columns, setColumns] = useState<ColumnMapping>(NO_COLUMNS)
  const [attendanceChoice, setAttendanceChoice] = useState<AttendanceChoice>('')
  const [rsvpRule, setRsvpRule] = useState<StatusRule<RsvpStatus>>(emptyRule())
  const [attendanceRule, setAttendanceRule] = useState<StatusRule<AttendanceStatus>>(emptyRule())
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [skipAck, setSkipAck] = useState(false)
  const recoveredId = params.get('preview')

  useEffect(() => {
    if (!recoveredId) return
    getImportPreview(recoveredId)
      .then((value) => {
        setPreview(value)
        setStep('review')
      })
      .catch(() => undefined)
  }, [recoveredId])

  async function onFile(file: File) {
    setError(null)
    if (file.size > CSV_MAX_BYTES) {
      setError('This file is larger than 2 MB. Split it and try again.')
      return
    }
    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
      const parsed = parseAttendanceCsv(text)
      if ('error' in parsed) {
        setError(parsed.error.message)
        return
      }
      setFileLabel(file.name.slice(0, 120) || 'attendance.csv')
      setFileHash(await fileSha256Hex(buffer))
      setHeaders(parsed.headerLabels)
      setOriginalHeaders(parsed.headers)
      setKeepSource(false)
      setRows(parsed.rows)
      setBlankCount(parsed.blankRowCount)
      const guess = guessColumns(parsed.headerLabels)
      setColumns(guess)
      // A file with status columns must not default to counting everyone.
      setAttendanceChoice(guess.attendance ?? (guess.rsvp == null ? 'all' : ''))
      setRsvpRule(suggestRsvpRule(sampleSourceValues(parsed.rows, guess.rsvp)))
      setAttendanceRule(emptyRule())
      setStep('map')
    } finally {
      setBusy(false)
    }
  }

  const mixed = typeof attendanceChoice === 'number'
  const mixedColumns: ColumnMapping = { ...columns, attendance: mixed ? attendanceChoice : null }
  const statusMap = {
    rsvp: mixedColumns.rsvp == null ? null : rsvpRule,
    attendance: mixed ? attendanceRule : null,
  }
  const draftOutcomes = useMemo(() => {
    if (!mixed || columns.email == null) return null
    const counts = { new: 0, already_recorded: 0, not_counted: 0, duplicate: 0, invalid: 0, unresolved: 0 }
    const statuses = { rsvp: columns.rsvp == null ? null : rsvpRule, attendance: attendanceRule }
    const mapped = { ...columns, attendance: attendanceChoice }
    for (const row of classifyMixedRows(rows, mapped, statuses)) counts[row.outcome] += 1
    return counts
  }, [mixed, rows, columns, attendanceChoice, rsvpRule, attendanceRule])

  function setColumn(field: keyof ColumnMapping, value: number | null) {
    setColumns((current) => ({ ...current, [field]: value }))
    if (field === 'rsvp') setRsvpRule(suggestRsvpRule(sampleSourceValues(rows, value)))
  }

  async function review() {
    if (columns.email == null) {
      setError('Map the Email column to continue.')
      return
    }
    if (attendanceChoice === '') {
      setError('Choose the attendance column, or confirm that everyone in this file attended.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const emailIndex = columns.email
      const nameIndex = columns.name
      const next = mixed
        ? await prepareMixedAttendanceImport({
            workspaceId: workspace.id,
            eventId: event.id,
            fileLabel,
            fileHash,
            mapping: {
              emailIndex,
              nameIndex,
              rsvpIndex: mixedColumns.rsvp,
              attendanceIndex: mixedColumns.attendance,
              timestampIndex: mixedColumns.timestamp,
              phoneIndex: mixedColumns.phone,
              affiliationIndex: mixedColumns.affiliation,
              ...(keepSource ? { keepSource: true, headers: originalHeaders } : {}),
            },
            statusMap,
            rows: mixedImportRows(rows, mixedColumns, keepSource),
            blankCount,
          })
        : await prepareAttendanceImport({
            workspaceId: workspace.id,
            eventId: event.id,
            fileLabel,
            fileHash,
            mapping: { emailIndex, nameIndex },
            rows: rows.map((row) => ({
              rowNumber: row.rowNumber,
              email: row.values[emailIndex] ?? '',
              name: nameIndex == null ? '' : (row.values[nameIndex] ?? ''),
            })),
            blankCount,
          })
      setPreview(next)
      setStep('review')
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!preview) return
    if (needsAck && !skipAck) {
      setError('Acknowledge the rows that will be skipped before recording attendance.')
      return
    }
    setBusy(true)
    setError(null)
    const key = getRequestKey(`commit_import:${preview.id}`)
    try {
      const receipt = await commitAttendanceImport(preview.id, skipAck, key)
      navigate(`/app/w/${workspace.id}/events/${event.id}/attendance/imports/${receipt.id}`)
    } catch (caught) {
      const appError = toAppError(caught)
      if (appError.code === 'UNAVAILABLE') {
        const existing = await lookupImportReceipt(workspace.id, event.id, preview.id, key)
        if (existing) {
          navigate(`/app/w/${workspace.id}/events/${event.id}/attendance/imports/${existing.id}`)
          return
        }
      }
      setError(appError.message)
    } finally {
      setBusy(false)
    }
  }

  const grouped = new Map<PreviewGroup, PreviewRow[]>(PREVIEW_GROUPS.map((group) => [group, []]))
  for (const row of preview?.rows ?? []) grouped.get(row.group ?? previewGroup(row.outcome))?.push(row)
  const reviewCount = (preview?.counts.invalid ?? 0) + (preview?.counts.unresolved ?? 0)
  const needsAck = reviewCount > 0

  return (
    <div className="app-page-import" style={{ marginTop: 16 }}>
      <p className="app-meta">
        {event.title} · Only people you confirm as attended are counted.
      </p>
      <p className="app-meta">Choose file → Map columns → Review → Result</p>
      {step === 'choose' ? (
        <>
          <h2 className="app-section-title">Choose file</h2>
          <p>UTF-8 comma-delimited CSV, up to 2 MB and 5,000 data rows. Email is required for matching.</p>
          <p>
            Registration and check-in exports are fine: RSVP, no-show, and blank statuses are kept separate, and only the
            values you mark Attended are counted.
          </p>
          <input
            className="app-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onFile(file)
            }}
          />
          <div className="app-toolbar">
            <a
              className="app-btn app-btn-secondary"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(exampleCsv())}`}
              download="brie-attendance-example.csv"
            >
              Download example
            </a>
          </div>
        </>
      ) : null}
      {step === 'map' ? (
        <>
          <h2 className="app-section-title">Map columns</h2>
          <ColumnSelect
            label="Email"
            value={columns.email}
            headers={headers}
            rows={rows}
            emptyLabel="Choose column"
            onChange={(value) => setColumn('email', value)}
          />
          <ColumnSelect
            label="Name"
            hint="Optional. Unused columns are ignored."
            value={columns.name}
            headers={headers}
            rows={rows}
            emptyLabel="Ignore"
            onChange={(value) => setColumn('name', value)}
          />
          <Field label="Attendance" hint="Only rows you mark Attended are counted.">
            <select
              className="app-select"
              value={attendanceChoice === '' ? '' : String(attendanceChoice)}
              onChange={(event) => {
                const value = event.target.value
                setAttendanceChoice(value === '' ? '' : value === 'all' ? 'all' : Number(value))
                setAttendanceRule(emptyRule())
              }}
            >
              <option value="">Choose</option>
              <option value="all">No column · everyone in this file attended</option>
              {headers.map((header, index) => (
                <option key={header + index} value={index}>
                  {header}
                  {rows[0] ? ` · e.g. ${rows[0].values[index] || '—'}` : ''}
                </option>
              ))}
            </select>
          </Field>
          {mixed ? (
            <>
              <StatusValues
                title="What each attendance value means"
                values={sampleSourceValues(rows, attendanceChoice)}
                rule={attendanceRule}
                options={ATTENDANCE_OPTIONS}
                onChange={setAttendanceRule}
              />
              <ColumnSelect
                label="RSVP"
                hint="Optional. An RSVP never counts as attendance."
                value={columns.rsvp}
                headers={headers}
                rows={rows}
                emptyLabel="Ignore"
                onChange={(value) => setColumn('rsvp', value)}
              />
              {columns.rsvp != null ? (
                <StatusValues
                  title="What each RSVP value means"
                  values={sampleSourceValues(rows, columns.rsvp)}
                  rule={rsvpRule}
                  options={RSVP_OPTIONS}
                  onChange={setRsvpRule}
                />
              ) : null}
              <ColumnSelect
                label="Timestamp"
                hint="Optional context for review. Not used for attendance."
                value={columns.timestamp}
                headers={headers}
                rows={rows}
                emptyLabel="Ignore"
                onChange={(value) => setColumn('timestamp', value)}
              />
              <ColumnSelect
                label="Phone"
                hint="Optional context for review. Never used to match people."
                value={columns.phone}
                headers={headers}
                rows={rows}
                emptyLabel="Ignore"
                onChange={(value) => setColumn('phone', value)}
              />
              <ColumnSelect
                label="Affiliation"
                hint="Optional context for review, such as school or organization."
                value={columns.affiliation}
                headers={headers}
                rows={rows}
                emptyLabel="Ignore"
                onChange={(value) => setColumn('affiliation', value)}
              />
              <label className="app-field" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={keepSource} onChange={(event) => setKeepSource(event.target.checked)} />
                <span>
                  Keep the original rows with this import
                  <span className="app-meta" style={{ display: 'block' }}>
                    Every column of every row, for organizers to download from the import receipt. They’re deleted after
                    180 days, when the import is reverted, or when you delete them. Leave this off if you don’t need them.
                  </span>
                </span>
              </label>
              {!ruleMarksAttended(attendanceRule) ? (
                <p className="app-banner app-banner-warning">
                  No value is marked Attended yet, so nobody in this file will be counted.
                </p>
              ) : null}
              {draftOutcomes ? (
                <p className="app-meta">
                  With this mapping: {draftOutcomes.new} counted as attended · {draftOutcomes.not_counted} not counted ·{' '}
                  {draftOutcomes.unresolved} without email · {draftOutcomes.duplicate} duplicates · {draftOutcomes.invalid}{' '}
                  invalid
                </p>
              ) : null}
            </>
          ) : null}
          <div className="app-toolbar">
            <Button busy={busy} onClick={review}>
              Review
            </Button>
          </div>
        </>
      ) : null}
      {step === 'review' && preview ? (
        <>
          <h2 className="app-section-title">Review</h2>
          {preview.existingReceiptId ? (
            <p className="app-banner-warning app-banner">
              An active import used this same file. Recording it again adds no attendance; it only adds this file as
              another source for the people already recorded.
            </p>
          ) : null}
          <p>
            {preview.counts.accepted} will count · {grouped.get('wont-count')?.length ?? 0} won’t count · {reviewCount} can’t
            be matched · {preview.counts.duplicates} duplicates
          </p>
          <p className="app-meta">
            {preview.counts.newAttendance} new · {preview.counts.alreadyRecorded} already recorded at this event
          </p>
          {preview.keepSource ? (
            <p className="app-meta">The original rows will be kept with this import for 180 days.</p>
          ) : null}
          <ProposedChanges rows={preview.rows} />
          {PREVIEW_GROUPS.filter((group) => (grouped.get(group)?.length ?? 0) > 0).map((group) => (
            <PreviewGroupSection key={group} group={group} rows={grouped.get(group) ?? []} />
          ))}
          {preview.counts.accepted === 0 ? (
            <p className="app-banner app-banner-warning">
              Nobody in this file is marked attended. Go back and choose which values mean Attended.
            </p>
          ) : null}
          {needsAck ? (
            <label className="app-meta" style={{ display: 'block', marginTop: 16 }}>
              <input type="checkbox" checked={skipAck} onChange={(event) => setSkipAck(event.target.checked)} /> Skip{' '}
              {reviewCount} {reviewCount === 1 ? 'row that can’t' : 'rows that can’t'} be matched
            </label>
          ) : null}
          <div className="app-toolbar">
            <Button variant="secondary" onClick={() => setStep('map')}>
              Back
            </Button>
            <Button busy={busy} disabled={preview.counts.accepted === 0} onClick={commit}>
              Record attendance for {preview.counts.accepted} people
            </Button>
          </div>
        </>
      ) : null}
      {error ? <p className="app-error-text">{error}</p> : null}
      <div className="app-toolbar">
        <Link to={`/app/w/${workspace.id}/events/${event.id}/attendance`}>Exit import</Link>
      </div>
    </div>
  )
}
