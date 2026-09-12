import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { Button, Field, StatusBadge } from '../../components/ui'
import {
  commitAttendanceImport,
  getImportPreview,
  lookupImportReceipt,
  prepareAttendanceImport,
} from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { toAppError } from '../../data/errors'
import type { EventRecord, ImportPreview, PreviewOutcome } from '../../data/types'
import { CSV_MAX_BYTES, exampleCsv, guessEmailColumn, guessNameColumn, parseAttendanceCsv } from '../../lib/csv'
import { fileSha256Hex, getRequestKey } from '../../lib/idempotency'

type Step = 'choose' | 'map' | 'review' | 'result'

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
  const [rows, setRows] = useState<Array<{ rowNumber: number; values: string[] }>>([])
  const [blankCount, setBlankCount] = useState(0)
  const [emailIndex, setEmailIndex] = useState<number | null>(null)
  const [nameIndex, setNameIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [skipAck, setSkipAck] = useState(false)
  const [filter, setFilter] = useState<PreviewOutcome | 'all'>('all')
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
      setRows(parsed.rows)
      setBlankCount(parsed.blankRowCount)
      setEmailIndex(guessEmailColumn(parsed.headerLabels))
      setNameIndex(guessNameColumn(parsed.headerLabels))
      setStep('map')
    } finally {
      setBusy(false)
    }
  }

  async function review() {
    if (emailIndex == null) {
      setError('Map the Email column to continue.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const mapped = rows.map((row) => ({
        rowNumber: row.rowNumber,
        email: row.values[emailIndex] ?? '',
        name: nameIndex == null ? '' : (row.values[nameIndex] ?? ''),
      }))
      const next = await prepareAttendanceImport({
        workspaceId: workspace.id,
        eventId: event.id,
        fileLabel,
        fileHash,
        mapping: { emailIndex, nameIndex },
        rows: mapped,
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
    if (preview.counts.invalid > 0 && !skipAck) {
      setError('Acknowledge skipped invalid rows before recording attendance.')
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

  const filteredRows = (preview?.rows ?? []).filter((row) => filter === 'all' || row.outcome === filter)

  return (
    <div className="app-page-import" style={{ marginTop: 16 }}>
      <p className="app-meta">
        {event.title} · This file records people who attended.
      </p>
      <p className="app-meta">Choose file → Map columns → Review → Result</p>
      {step === 'choose' ? (
        <>
          <h2 className="app-section-title">Choose file</h2>
          <p>UTF-8 comma-delimited CSV, up to 2 MB and 5,000 data rows. Email is required for matching.</p>
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
          <Field label="Email">
            <select
              className="app-select"
              value={emailIndex ?? ''}
              onChange={(event) => setEmailIndex(event.target.value === '' ? null : Number(event.target.value))}
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
            <select
              className="app-select"
              value={nameIndex ?? ''}
              onChange={(event) => setNameIndex(event.target.value === '' ? null : Number(event.target.value))}
            >
              <option value="">Ignore</option>
              {headers.map((header, index) => (
                <option key={header + index} value={index}>
                  {header}
                </option>
              ))}
            </select>
          </Field>
          <Button busy={busy} onClick={review}>
            Review
          </Button>
        </>
      ) : null}
      {step === 'review' && preview ? (
        <>
          <h2 className="app-section-title">Review</h2>
          {preview.existingReceiptId ? (
            <p className="app-banner-warning app-banner">
              An active import used this same file. You can still record it as additional evidence.
            </p>
          ) : null}
          <p>
            {preview.counts.newAttendance} new · {preview.counts.alreadyRecorded} already recorded ·{' '}
            {preview.counts.duplicates} duplicates · {preview.counts.invalid} invalid
          </p>
          <select className="app-select" style={{ maxWidth: 220 }} value={filter} onChange={(event) => setFilter(event.target.value as PreviewOutcome | 'all')}>
            <option value="all">All outcomes</option>
            <option value="new">New</option>
            <option value="already_recorded">Already recorded</option>
            <option value="duplicate">Duplicates</option>
            <option value="invalid">Invalid</option>
          </select>
          {filteredRows.slice(0, 50).map((row) => (
            <div key={`${row.rowNumber}-${row.email}`} style={{ padding: '8px 0', borderBottom: '1px solid var(--app-border)' }}>
              <strong>Row {row.rowNumber}</strong> · {row.name || 'Name not provided'} · {row.email}{' '}
              <StatusBadge tone={row.outcome === 'invalid' ? 'danger' : row.outcome === 'new' ? 'done' : 'warning'}>
                {row.outcome.replace('_', ' ')}
              </StatusBadge>
              <p className="app-meta">{row.reason}</p>
            </div>
          ))}
          {preview.counts.invalid > 0 ? (
            <label className="app-meta">
              <input type="checkbox" checked={skipAck} onChange={(event) => setSkipAck(event.target.checked)} /> Skip{' '}
              {preview.counts.invalid} invalid rows
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
