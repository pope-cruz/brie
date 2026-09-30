import { useState } from 'react'
import { Button } from '../../components/ui'
import { beginWorkspaceAttendanceExport, exportWorkspaceAttendancePage, type AttendanceGroupFilters } from '../../data/api'
import { toAppError } from '../../data/errors'
import type { WorkspaceAttendanceField, WorkspaceAttendanceRow } from '../../data/types'
import { workspaceAttendanceExportCsv, workspaceAttendanceFieldOptions } from '../../lib/attendanceExport'

export function WorkspaceAttendanceExport({ workspaceId, filters }: {
  workspaceId: string
  filters: AttendanceGroupFilters
}) {
  const [fields, setFields] = useState<WorkspaceAttendanceField[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(field: WorkspaceAttendanceField) {
    setFields((current) => current.includes(field)
      ? current.filter((item) => item !== field)
      : workspaceAttendanceFieldOptions.map((option) => option.key).filter((item) => current.includes(item) || item === field))
  }

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const session = await beginWorkspaceAttendanceExport(workspaceId, fields, filters)
      const rows: WorkspaceAttendanceRow[] = []
      let after: string | null = null
      for (;;) {
        const page = await exportWorkspaceAttendancePage(workspaceId, session.id, after)
        rows.push(...page.rows)
        if (page.count < 1000 || !page.nextAfter) break
        if (page.nextAfter === after) throw new Error('Export paging stopped. Try again.')
        after = page.nextAfter
      }
      const csv = workspaceAttendanceExportCsv(rows, fields)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `brie-workspace-attendance-${workspaceId}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ borderTop: '1px solid var(--app-border)', paddingTop: 24, marginTop: 24 }}>
      <h2 className="app-section-title">Export workspace attendance</h2>
      <p className="app-meta">Choose the CSV columns. The current attendance filters apply to the download.</p>
      <fieldset style={{ border: 0, padding: 0, margin: '16px 0' }}>
        <legend className="app-meta">Columns</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {workspaceAttendanceFieldOptions.map((option) => (
            <label key={option.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={fields.includes(option.key)} onChange={() => toggle(option.key)} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Button variant="secondary" disabled={fields.length === 0} busy={busy} busyLabel="Preparing CSV…" onClick={() => void download()}>
        Download CSV
      </Button>
      {fields.length === 0 ? <p className="app-meta">Choose at least one column to export.</p> : null}
      {error ? <p className="app-error-text" role="alert">{error}</p> : null}
    </section>
  )
}
