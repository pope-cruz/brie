import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { Button, Field, StatusBadge } from '../../components/ui'
import {
  commitAttendanceImport,
  getImportPreview,
  lookupImportReceipt,
  prepareMixedAttendanceImport,
} from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { toAppError } from '../../data/errors'
import type { AttendanceStatus, EventRecord, ImportPreview, PreviewRow, RsvpStatus } from '../../data/types'
import { CSV_MAX_BYTES, exampleCsv, parseAttendanceCsv, type ParsedCsv } from '../../lib/csv'
import { fileSha256Hex, getRequestKey } from '../../lib/idempotency'
import {
  ATTENDANCE_LABELS,
  GROUP_LABELS,
  GROUP_ORDER,
  RSVP_LABELS,
  SAMPLE_VALUE_LIMIT,
  buildMixedRows,
  buildStatusMap,
  classifyRows,
  countGroups,
  defaultAttendanceMap,
  defaultRsvpMap,
  describeChange,
  groupPreviewRows,
  guessColumns,
  marksAnyoneAttended,
  sampleSourceValues,
  type ColumnMapping,
  type ValueMap,
} from '../../lib/mixedAttendance'

type Step = 'choose' | 'map' | 'review'

const EMPTY_COLUMNS: ColumnMapping = {
  email: null,
  name: null,
  rsvp: null,
  attendance: null,
  timestamp: null,
  phone: null,
  affiliation: null,
}

const ROWS_PER_GROUP = 50

function toIndex(value: string): number | null {
  return value === '' ? null : Number(value)
}

function ColumnSelect({
  headers,
  value,
  onChange,
  emptyLabel,
  ...field
}: {
  headers: string[]
  value: number | null
  onChange: (value: number | null) => void
  emptyLabel: string
  // Field passes these to its child so the label and hint describe the select.
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}) {
  return (
    <select {...field} className="app-select" value={value ?? ''} onChange={(event) => onChange(toIndex(event.target.value))}>
      <option value="">{emptyLabel}</option>
      {headers.map((header, index) => (
        <option key={header + index} value={index}>
          {header}
        </option>
      ))}
    </select>
  )
}

function ValueMapEditor<S extends string>({
  label,
  values,
  map,
  options,
  onChange,
}: {
  label: string
  values: string[]
  map: ValueMap<S>
  options: Array<[S, string]>
  onChange: (map: ValueMap<S>) => void
}) {
  const shown = values.slice(0, SAMPLE_VALUE_LIMIT)
  return (
    <div className="app-value-map" style={{ display: 'grid', gap: 8, margin: '8px 0 16px' }}>
      {shown.length === 0 ? <p className="app-meta">This column is blank in every row.</p> : null}
      {shown.map((value) => (
        <label key={value} className="app-meta" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ minWidth: 160, overflowWrap: 'anywhere' }}>“{value}”</span>
          <select
            className="app-select"
            style={{ maxWidth: 220 }}
            aria-label={`${label} for “${value}”`}
            value={map.values[value] ?? ''}
            onChange={(event) =>
              onChange({
                ...map,
                values: { ...map.values, [value]: event.target.value === '' ? null : (event.target.value as S) },
              })
            }
          >
            <option value="">Same as other values</option>
            {options.map(([status, text]) => (
              <option key={status} value={status}>
                {text}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="app-meta" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ minWidth: 160 }}>
          {values.length > SAMPLE_VALUE_LIMIT
            ? `Other values (${values.length - SAMPLE_VALUE_LIMIT} more not listed)`
            : 'Other values'}
        </span>
        <select
          className="app-select"
          style={{ maxWidth: 220 }}
          aria-label={`${label} for other values`}
          value={map.other ?? 'unknown'}
          onChange={(event) => onChange({ ...map, other: event.target.value === 'unknown' ? null : (event.target.value as S) })}
        >
          {options.map(([status, text]) => (
            <option key={status} value={status}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <p className="app-meta">Blank cells are always unknown.</p>
    </div>
  )
}

function PreviewRowItem({ row }: { row: PreviewRow }) {
  const context = [row.timestamp, row.phone, row.affiliation].filter(Boolean).join(' · ')
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--app-border)' }}>
      <strong>Row {row.rowNumber}</strong> · {row.name || 'Name not provided'} · {row.email || 'No email'}{' '}
      {row.rsvp ? <StatusBadge tone="neutral">{RSVP_LABELS[row.rsvp]}</StatusBadge> : null}{' '}
      {row.attendance ? (
        <StatusBadge tone={row.attendance === 'attended' ? 'done' : row.attendance === 'no_show' ? 'danger' : 'warning'}>
          {ATTENDANCE_LABELS[row.attendance]}
        </StatusBadge>
      ) : null}
      <p className="app-meta">{row.reason}</p>
      {context ? <p className="app-meta">{context}</p> : null}
    </div>
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
  const [rows, setRows] = useState<ParsedCsv['rows']>([])
  const [blankCount, setBlankCount] = useState(0)
  const [columns, setColumns] = useState<ColumnMapping>(EMPTY_COLUMNS)
  const [rsvpMap, setRsvpMap] = useState<ValueMap<RsvpStatus>>({ values: {}, other: null })
  const [attendanceMap, setAttendanceMap] = useState<ValueMap<AttendanceStatus>>({ values: {}, other: null })
  const [keepSource, setKeepSource] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [skipAck, setSkipAck] = useState(false)
  const [showAll, setShowAll] = useState(false)
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

  const rsvpValues = useMemo(() => sampleSourceValues(rows, columns.rsvp), [rows, columns.rsvp])
  const attendanceValues = useMemo(
    () => sampleSourceValues(rows, typeof columns.attendance === 'number' ? columns.attendance : null),
    [rows, columns.attendance],
  )
  const statusMap = useMemo(() => buildStatusMap(columns, rsvpMap, attendanceMap), [columns, rsvpMap, attendanceMap])
  const estimate = useMemo(
    () => (columns.email == null ? null : countGroups(classifyRows(rows, columns, statusMap))),
    [rows, columns, statusMap],
  )

  function setColumn<K extends keyof ColumnMapping>(key: K, value: ColumnMapping[K]) {
    setError(null)
    setColumns((current) => ({ ...current, [key]: value }))
    if (key === 'rsvp') setRsvpMap(defaultRsvpMap(sampleSourceValues(rows, value as number | null)))
    if (key === 'attendance') {
      setAttendanceMap(defaultAttendanceMap(sampleSourceValues(rows, typeof value === 'number' ? value : null)))
    }
  }

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
      const guessed = guessColumns(parsed.headerLabels)
      setFileLabel(file.name.slice(0, 120) || 'attendance.csv')
      setFileHash(await fileSha256Hex(buffer))
      setHeaders(parsed.headerLabels)
      setRows(parsed.rows)
      setBlankCount(parsed.blankRowCount)
      setColumns(guessed)
      setRsvpMap(defaultRsvpMap(sampleSourceValues(parsed.rows, guessed.rsvp)))
      setAttendanceMap(
        defaultAttendanceMap(
          sampleSourceValues(parsed.rows, typeof guessed.attendance === 'number' ? guessed.attendance : null),
        ),
      )
      setStep('map')
    } finally {
      setBusy(false)
    }
  }

  async function review() {
    if (columns.email == null) {
      setError('Map the Email column to continue.')
      return
    }
    if (columns.attendance == null) {
      setError('Choose how this file shows who attended.')
      return
    }
    if (!marksAnyoneAttended(statusMap)) {
      setError('Choose which values mean attended. Nobody is counted until you do.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const next = await prepareMixedAttendanceImport({
        workspaceId: workspace.id,
        eventId: event.id,
        fileLabel,
        fileHash,
        mapping: {
          emailIndex: columns.email,
          nameIndex: columns.name,
          rsvpIndex: columns.rsvp,
          attendanceIndex: typeof columns.attendance === 'number' ? columns.attendance : null,
          attendanceEveryRow: columns.attendance === 'every-row',
          timestampIndex: columns.timestamp,
          phoneIndex: columns.phone,
          affiliationIndex: columns.affiliation,
        },
        statusMap,
        rows: buildMixedRows(rows, columns, keepSource),
        blankCount,
        sourceHeaders: keepSource ? headers : null,
      })
      setPreview(next)
      setSkipAck(false)
      setShowAll(false)
      setStep('review')
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  const reviewCount = preview ? preview.counts.invalid + (preview.counts.unresolved ?? 0) : 0

  async function commit() {
    if (!preview) return
    if (reviewCount > 0 && !skipAck) {
      setError('Acknowledge the rows that need review before recording attendance.')
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

  const groups = preview ? groupPreviewRows(preview.rows) : null
  const groupCounts = preview ? countGroups(preview.rows.map((row) => ({ group: row.group ?? undefined }))) : null
  const changes = preview?.proposals?.changes ?? []

  return (
    <div className="app-page-import" style={{ marginTop: 16 }}>
      <p className="app-meta">
        {event.title} · Only people you mark as attended are counted.
      </p>
      <p className="app-meta">Choose file → Map columns → Review → Result</p>
      {step === 'choose' ? (
        <>
          <h2 className="app-section-title">Choose file</h2>
          <p>
            UTF-8 comma-delimited CSV, up to 2 MB and 5,000 data rows. Email is required for matching. Guest lists
            with RSVP, check-in, or no-show columns are fine: you choose which values mean attended.
          </p>
          <input
            className="app-input"
            type="file"
            accept=".csv,text/csv"
            aria-label="Attendance file"
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
          <Field label="Email">
            <select
              className="app-select"
              value={columns.email ?? ''}
              onChange={(event) => setColumn('email', toIndex(event.target.value))}
            >
              <option value="">Choose column</option>
              {headers.map((header, index) => (
                <option key={header + index} value={index}>
                  {header}
                  {rows[0] ? ` · e.g. ${rows[0].values[index] || '—'}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name" hint="Optional. Unused columns are ignored.">
            <ColumnSelect headers={headers} value={columns.name} onChange={(value) => setColumn('name', value)} emptyLabel="Ignore" />
          </Field>

          <h3 className="app-section-title">Attendance</h3>
          <Field label="Who attended" hint="Brie counts only rows you mark as attended. RSVP never counts as attendance.">
            <select
              className="app-select"
              value={columns.attendance == null ? '' : String(columns.attendance)}
              onChange={(event) =>
                setColumn(
                  'attendance',
                  event.target.value === '' ? null : event.target.value === 'every-row' ? 'every-row' : Number(event.target.value),
                )
              }
            >
              <option value="">Choose…</option>
              <option value="every-row">Everyone in this file attended</option>
              {headers.map((header, index) => (
                <option key={header + index} value={index}>
                  Column: {header}
                </option>
              ))}
            </select>
          </Field>
          {typeof columns.attendance === 'number' ? (
            <ValueMapEditor<AttendanceStatus>
              label="Attendance"
              values={attendanceValues}
              map={attendanceMap}
              options={[
                ['unknown', 'Unknown'],
                ['attended', 'Attended'],
                ['no_show', 'No-show'],
              ]}
              onChange={(map) => {
                setError(null)
                setAttendanceMap(map)
              }}
            />
          ) : null}

          <h3 className="app-section-title">RSVP</h3>
          <Field label="RSVP column" hint="Optional. Shown during review; it never counts as attendance.">
            <ColumnSelect headers={headers} value={columns.rsvp} onChange={(value) => setColumn('rsvp', value)} emptyLabel="Not in this file" />
          </Field>
          {columns.rsvp != null ? (
            <ValueMapEditor<RsvpStatus>
              label="RSVP"
              values={rsvpValues}
              map={rsvpMap}
              options={[
                ['unknown', 'Unknown'],
                ['yes', 'RSVP yes'],
                ['no', 'RSVP no'],
              ]}
              onChange={setRsvpMap}
            />
          ) : null}

          <h3 className="app-section-title">More details</h3>
          <p className="app-meta">Optional. Shown during review. Never used to match people or count attendance.</p>
          <Field label="Timestamp">
            <ColumnSelect headers={headers} value={columns.timestamp} onChange={(value) => setColumn('timestamp', value)} emptyLabel="Ignore" />
          </Field>
          <Field label="Phone">
            <ColumnSelect headers={headers} value={columns.phone} onChange={(value) => setColumn('phone', value)} emptyLabel="Ignore" />
          </Field>
          <Field label="Affiliation">
            <ColumnSelect headers={headers} value={columns.affiliation} onChange={(value) => setColumn('affiliation', value)} emptyLabel="Ignore" />
          </Field>

          <label className="app-meta" style={{ display: 'block', margin: '12px 0' }}>
            <input type="checkbox" checked={keepSource} onChange={(event) => setKeepSource(event.target.checked)} /> Keep a
            copy of the original rows for 90 days. Organizers can download or delete it from the import receipt.
          </label>

          {estimate ? (
            <p className="app-meta" aria-live="polite">
              Estimate: {estimate['will-count']} will count · {estimate['wont-count']} won’t count ·{' '}
              {estimate['needs-review']} need review · {estimate.duplicate} duplicates
            </p>
          ) : null}
          <div className="app-toolbar">
            <Button variant="secondary" onClick={() => setStep('choose')}>
              Choose another file
            </Button>
            <Button busy={busy} onClick={review}>
              Review
            </Button>
          </div>
        </>
      ) : null}
      {step === 'review' && preview && groups && groupCounts ? (
        <>
          <h2 className="app-section-title">Review</h2>
          {preview.existingReceiptId ? (
            <p className="app-banner-warning app-banner">
              An active import used this same file. People already recorded from it are not counted again.
            </p>
          ) : null}
          <p>
            {groupCounts['will-count']} will count · {groupCounts['wont-count']} won’t count · {groupCounts['needs-review']}{' '}
            need review · {groupCounts.duplicate} duplicates
          </p>
          <p className="app-meta">
            {preview.counts.newAttendance} new · {preview.counts.alreadyRecorded} already recorded
          </p>
          {changes.length > 0 ? (
            <section aria-label="Proposed changes">
              <h3 className="app-section-title">Proposed changes (not applied)</h3>
              <p className="app-meta">This file differs from what is already recorded. Brie keeps the recorded details.</p>
              <ul>
                {changes.map((change) => (
                  <li key={`${change.email}-${change.field}`} className="app-meta">
                    {describeChange(change)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {GROUP_ORDER.map((group) =>
            groups[group].length > 0 ? (
              <section key={group} aria-label={GROUP_LABELS[group]}>
                <h3 className="app-section-title">
                  {GROUP_LABELS[group]} ({groups[group].length})
                </h3>
                {(showAll ? groups[group] : groups[group].slice(0, ROWS_PER_GROUP)).map((row) => (
                  <PreviewRowItem key={`${row.rowNumber}-${row.email}`} row={row} />
                ))}
              </section>
            ) : null,
          )}
          {!showAll && GROUP_ORDER.some((group) => groups[group].length > ROWS_PER_GROUP) ? (
            <Button variant="secondary" onClick={() => setShowAll(true)}>
              Show every row
            </Button>
          ) : null}
          {reviewCount > 0 ? (
            <label className="app-meta">
              <input type="checkbox" checked={skipAck} onChange={(event) => setSkipAck(event.target.checked)} /> Skip{' '}
              {reviewCount} rows that need review. They are not recorded.
            </label>
          ) : null}
          {preview.counts.accepted === 0 ? (
            <p className="app-meta">Nothing new to record from this file.</p>
          ) : null}
          <div className="app-toolbar">
            <Button variant="secondary" onClick={() => setStep(rows.length > 0 ? 'map' : 'choose')}>
              Back
            </Button>
            <Button busy={busy} disabled={preview.counts.accepted === 0} onClick={commit}>
              Record attendance for {preview.counts.accepted} people
            </Button>
          </div>
          <p className="app-meta">{preview.counts.newAttendance} newly counted attendees.</p>
        </>
      ) : null}
      {error ? <p className="app-error-text">{error}</p> : null}
      <div className="app-toolbar">
        <Link to={`/app/w/${workspace.id}/events/${event.id}/attendance`}>Exit import</Link>
      </div>
    </div>
  )
}
