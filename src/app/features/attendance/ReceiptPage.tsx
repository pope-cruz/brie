import { useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ConfirmDialog, ErrorRetry, StatusBadge } from '../../components/ui'
import {
  deleteImportSource,
  getImportReceipt,
  getImportSource,
  previewRevertImport,
  revertAttendanceImport,
} from '../../data/api'
import type { WorkspaceSummary } from '../../data/api'
import { toAppError } from '../../data/errors'
import type { EventRecord } from '../../data/types'
import { sourceRowsCsv } from '../../lib/attendanceExport'

export function ReceiptPage() {
  const { workspace, event } = useOutletContext<{ workspace: WorkspaceSummary; event: EventRecord }>()
  const { batchId = '' } = useParams()
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteSource, setConfirmDeleteSource] = useState(false)
  const [sourceBusy, setSourceBusy] = useState(false)
  const receipt = useQuery({
    queryKey: ['receipt', workspace.id, batchId],
    queryFn: () => getImportReceipt(workspace.id, batchId),
  })
  const impact = useQuery({
    queryKey: ['revert-impact', workspace.id, batchId],
    queryFn: () => previewRevertImport(workspace.id, batchId),
    enabled: confirm,
  })

  async function downloadSource() {
    if (!receipt.data) return
    setSourceBusy(true)
    setError(null)
    try {
      const source = await getImportSource(workspace.id, batchId)
      const url = URL.createObjectURL(
        new Blob([sourceRowsCsv(source.headers, source.rows)], { type: 'text/csv;charset=utf-8' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `original-${receipt.data.fileLabel.replace(/\.csv$/i, '')}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setSourceBusy(false)
    }
  }

  if (receipt.isError) {
    return <ErrorRetry message={toAppError(receipt.error).message} onRetry={() => receipt.refetch()} />
  }
  if (!receipt.data) return <p>Loading…</p>

  return (
    <div style={{ marginTop: 16 }}>
      <p className="app-meta">
        <Link to={`/app/w/${workspace.id}/events/${event.id}/attendance?view=imports`}>Imports</Link>
      </p>
      <h2 className="app-section-title">{receipt.data.fileLabel}</h2>
      <StatusBadge tone={receipt.data.status === 'reverted' ? 'warning' : 'done'}>
        {receipt.data.status === 'reverted' ? 'Reverted' : 'Active'}
      </StatusBadge>
      <p>
        {receipt.data.added} attendees added · {receipt.data.alreadyRecorded} already recorded · {receipt.data.skipped}{' '}
        rows skipped
      </p>
      <p className="app-meta">
        Imported by {receipt.data.importedBy} at {new Date(receipt.data.committedAt).toLocaleString()}
      </p>
      {receipt.data.sourceRowCount != null && receipt.data.sourceDeleteAfter ? (
        <div className="app-field">
          <p className="app-meta">
            {receipt.data.sourceRowCount} original rows kept until{' '}
            {new Date(receipt.data.sourceDeleteAfter).toLocaleDateString()}. Only owners and organizers can download them.
          </p>
          <div className="app-toolbar">
            <Button variant="secondary" busy={sourceBusy} onClick={downloadSource}>
              Download original rows
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDeleteSource(true)}>
              Delete original rows
            </Button>
          </div>
        </div>
      ) : null}
      {confirmDeleteSource ? (
        <ConfirmDialog
          title="Delete the original rows?"
          body="The kept copy of this file’s rows is deleted now. Attendance and this receipt don’t change."
          actionLabel="Delete original rows"
          danger
          pending={sourceBusy}
          onCancel={() => setConfirmDeleteSource(false)}
          onConfirm={async () => {
            setSourceBusy(true)
            setError(null)
            try {
              await deleteImportSource(workspace.id, batchId)
              setConfirmDeleteSource(false)
              queryClient.invalidateQueries({ queryKey: ['receipt'] })
            } catch (caught) {
              setError(toAppError(caught).message)
            } finally {
              setSourceBusy(false)
            }
          }}
        />
      ) : null}
      {receipt.data.status === 'active' ? (
        <Button variant="secondary" onClick={() => setConfirm(true)}>
          Revert import
        </Button>
      ) : (
        <p className="app-meta">This receipt stays visible. Import a corrected file to add attendance again.</p>
      )}
      {error ? <p className="app-error-text">{error}</p> : null}
      {confirm && impact.data ? (
        <ConfirmDialog
          title="Revert this import?"
          body={`${impact.data.disappear} attendance records will disappear. ${impact.data.retained} people remain through other active batches.`}
          actionLabel="Revert import"
          danger
          pending={pending}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setPending(true)
            setError(null)
            try {
              await revertAttendanceImport(
                workspace.id,
                batchId,
                impact.data.batchVersion,
                impact.data.attendanceVersion,
              )
              setConfirm(false)
              queryClient.invalidateQueries({ queryKey: ['receipt'] })
              queryClient.invalidateQueries({ queryKey: ['event'] })
              queryClient.invalidateQueries({ queryKey: ['event-people'] })
              queryClient.invalidateQueries({ queryKey: ['event-imports'] })
            } catch (caught) {
              setError(toAppError(caught).message)
            } finally {
              setPending(false)
            }
          }}
        />
      ) : null}
    </div>
  )
}
