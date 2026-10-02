import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Image as ImageIcon, Link2 } from 'lucide-react'
import { Button } from '../../components/ui'
import {
  addEventFile, addEventLink, EVENT_FILE_MAX_BYTES, listEventAttachments, removeEventAttachment,
  restoreEventAttachment, signEventFiles, type WorkspaceSummary,
} from '../../data/api'
import { toAppError } from '../../data/errors'
import { canManageEvents, type EventAttachment, type EventRecord } from '../../data/types'
import { fileTypeLabel, formatFileSize, isImage, linkSource, linkTitle, normalizeLink } from '../../lib/attachments'

type Upload = { key: string; name: string; error: string | null }

function isEditable(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

/**
 * Files & links on the event page: partnership docs, slides, orders, receipts.
 * Organizers drop files anywhere on the page, paste a file or link outside a field, or use the buttons.
 */
export function EventAttachments({ workspace, event }: { workspace: WorkspaceSummary; event: EventRecord }) {
  const queryClient = useQueryClient()
  const manage = canManageEvents(workspace.role) && !event.archivedAt
  const queryKey = ['event-attachments', workspace.id, event.id]
  const items = useQuery({ queryKey, queryFn: () => listEventAttachments(workspace.id, event.id, manage) })
  const active = (items.data ?? []).filter((item) => !item.removedAt)
  const removed = (items.data ?? []).filter((item) => item.removedAt)
  const paths = active.flatMap((item) => (item.storagePath ? [item.storagePath] : []))
  const signed = useQuery({
    queryKey: ['event-attachment-urls', workspace.id, event.id, paths],
    queryFn: () => signEventFiles(paths),
    enabled: paths.length > 0,
    staleTime: 50 * 60 * 1000,
    refetchInterval: 50 * 60 * 1000,
  })

  const [uploads, setUploads] = useState<Upload[]>([])
  const [linkOpen, setLinkOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [undo, setUndo] = useState<EventAttachment | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['event-attachments', workspace.id, event.id] }),
    [queryClient, workspace.id, event.id],
  )

  const upload = useCallback(async (files: File[]) => {
    const batch = files.map((file) => ({ file, key: crypto.randomUUID() }))
    setUploads((current) => [...current, ...batch.map(({ file, key }) => ({
      key, name: file.name || 'Pasted file',
      error: file.size > EVENT_FILE_MAX_BYTES ? 'Too large. Files can be up to 25 MB.' : null,
    }))])
    await Promise.all(batch.map(async ({ file, key }) => {
      if (file.size > EVENT_FILE_MAX_BYTES) return
      try {
        await addEventFile(workspace.id, event.id, file)
        setUploads((current) => current.filter((item) => item.key !== key))
      } catch (caught) {
        const message = toAppError(caught).message
        setUploads((current) => current.map((item) => (item.key === key ? { ...item, error: message } : item)))
      }
    }))
    await refresh()
  }, [workspace.id, event.id, refresh])

  const addLink = useCallback(async (url: string, title?: string) => {
    setActionError(null)
    try {
      await addEventLink(workspace.id, event.id, url, title?.trim() || linkTitle(url))
      await refresh()
      return true
    } catch (caught) {
      setActionError(toAppError(caught).message)
      return false
    }
  }, [workspace.id, event.id, refresh])

  // Dump anywhere: drop files on the page, or paste a file or link while not typing in a field.
  useEffect(() => {
    if (!manage) return
    let depth = 0
    const hasFiles = (drag: DragEvent) => Array.from(drag.dataTransfer?.types ?? []).includes('Files')
    function onEnter(drag: DragEvent) { if (hasFiles(drag)) { depth += 1; setDragging(true) } }
    function onLeave(drag: DragEvent) { if (hasFiles(drag)) { depth = Math.max(0, depth - 1); if (!depth) setDragging(false) } }
    function onOver(drag: DragEvent) { if (hasFiles(drag)) drag.preventDefault() }
    function onDrop(drag: DragEvent) {
      if (!hasFiles(drag)) return
      drag.preventDefault()
      depth = 0
      setDragging(false)
      const files = Array.from(drag.dataTransfer?.files ?? [])
      if (files.length) void upload(files)
    }
    function onPaste(paste: ClipboardEvent) {
      if (isEditable(paste.target) || !paste.clipboardData) return
      const files = Array.from(paste.clipboardData.files)
      if (files.length) { paste.preventDefault(); void upload(files); return }
      const link = normalizeLink(paste.clipboardData.getData('text/plain'))
      if (link && /^https?:\/\//i.test(paste.clipboardData.getData('text/plain').trim())) { paste.preventDefault(); void addLink(link) }
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      document.removeEventListener('paste', onPaste)
    }
  }, [manage, upload, addLink])

  async function remove(item: EventAttachment) {
    setActionError(null)
    try {
      setUndo(await removeEventAttachment(workspace.id, item.id, item.version))
    } catch (caught) {
      setActionError(toAppError(caught).message)
    }
    await refresh()
  }

  async function restore(item: EventAttachment) {
    setActionError(null)
    setUndo(null)
    try {
      await restoreEventAttachment(workspace.id, item.id, item.version)
    } catch (caught) {
      setActionError(toAppError(caught).message)
    }
    await refresh()
  }

  if (!manage && active.length === 0) return null

  return (
    <section className="event-files" aria-labelledby="event-files-title">
      <div className="event-files-head">
        <h2 id="event-files-title">Files &amp; links{active.length ? <span className="event-files-count">{active.length}</span> : null}</h2>
        {manage ? (
          <div className="event-files-actions">
            <Button variant="quiet" onClick={() => setLinkOpen(true)}>Add link</Button>
            <Button variant="quiet" onClick={() => fileInput.current?.click()}>Upload files</Button>
            <input ref={fileInput} type="file" multiple hidden aria-label="Upload files"
              onChange={(change) => {
                const files = Array.from(change.target.files ?? [])
                change.target.value = ''
                if (files.length) void upload(files)
              }} />
          </div>
        ) : null}
      </div>

      {linkOpen ? <LinkForm onCancel={() => setLinkOpen(false)} onAdd={async (url, title) => { if (await addLink(url, title)) setLinkOpen(false) }} /> : null}
      {undo ? (
        <p className="app-banner" role="status">
          Removed “{undo.title}”. <button type="button" className="ros-retry-link" onClick={() => restore(undo)}>Undo</button>
        </p>
      ) : null}
      {actionError ? <p className="app-error-text" role="alert">{actionError}</p> : null}
      {items.isError ? <p className="app-error-text" role="alert">{toAppError(items.error).message} <button type="button" className="ros-retry-link" onClick={() => items.refetch()}>Retry</button></p> : null}

      {active.length || uploads.length ? (
        <ul className="event-files-list">
          {active.map((item) => (
            <AttachmentRow key={item.id} item={item} href={item.kind === 'link' ? item.url : signed.data?.[item.storagePath ?? '']}
              manage={manage} onRemove={() => remove(item)} />
          ))}
          {uploads.map((item) => (
            <li key={item.key} className="event-file" aria-busy={item.error ? undefined : true}>
              <FileText className="event-file-icon" aria-hidden="true" />
              <div className="event-file-body">
                <span className="event-file-title">{item.name}</span>
                {item.error
                  ? <span className="app-error-text" role="alert">{item.error}</span>
                  : <span className="event-file-meta">Uploading…</span>}
              </div>
              {item.error ? <Button variant="quiet" onClick={() => setUploads((current) => current.filter((upload) => upload.key !== item.key))}>Dismiss</Button> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {manage && !active.length && !uploads.length && items.data ? (
        <p className="event-files-empty">
          Partnership docs, slides, orders, receipts. Drop files anywhere on this page, or paste a link.
        </p>
      ) : null}

      {manage && removed.length ? (
        <details className="ros-removed event-files-removed">
          <summary>Removed files and links ({removed.length})</summary>
          {removed.map((item) => (
            <div key={item.id} className="ros-removed-row"><span>{item.title}</span>
              <Button variant="secondary" onClick={() => restore(item)}>Restore</Button></div>
          ))}
        </details>
      ) : null}

      {dragging ? <div className="event-files-drop" aria-hidden="true"><p>Drop to attach to {event.title}</p></div> : null}
    </section>
  )
}

function AttachmentRow({ item, href, manage, onRemove }: {
  item: EventAttachment
  href: string | null | undefined
  manage: boolean
  onRemove: () => void
}) {
  const menu = useRef<HTMLDetailsElement>(null)
  const Icon = item.kind === 'link' ? Link2 : isImage(item.title, item.contentType) ? ImageIcon : FileText
  const source = item.kind === 'link' ? linkSource(item.url ?? '') : ''
  const meta = [
    ...(item.kind === 'link'
      ? [source === item.title ? '' : source]
      : [fileTypeLabel(item.title, item.contentType), formatFileSize(item.sizeBytes)]),
    item.createdByName,
  ].filter(Boolean).join(' · ')
  return (
    <li className="event-file">
      <Icon className="event-file-icon" aria-hidden="true" />
      <div className="event-file-body">
        {href
          ? <a className="event-file-title" href={href} target="_blank" rel="noopener noreferrer" title={item.title}>{item.title}</a>
          : <span className="event-file-title">{item.title}</span>}
        <span className="event-file-meta">{meta}</span>
      </div>
      {manage ? (
        <details ref={menu} className="ros-row-menu"><summary aria-label={`Actions for ${item.title}`}>•••</summary><div>
          <button type="button" className="ros-danger-action" onClick={() => { menu.current?.removeAttribute('open'); onRemove() }}>Remove</button>
        </div></details>
      ) : null}
    </li>
  )
}

function LinkForm({ onAdd, onCancel }: { onAdd: (url: string, title: string) => Promise<void>; onCancel: () => void }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    const link = normalizeLink(url)
    if (!link) { setError('Enter a web address, like figma.com/… or docs.google.com/…'); return }
    setBusy(true)
    await onAdd(link, title)
    setBusy(false)
  }
  return (
    <form className="event-files-link" onSubmit={submit} onKeyDown={(key) => { if (key.key === 'Escape') onCancel() }}>
      <input className="app-input" aria-label="Link" placeholder="Paste a link" value={url} autoFocus autoComplete="off"
        aria-invalid={error ? true : undefined} onChange={(change) => { setUrl(change.target.value); setError(null) }} />
      <input className="app-input" aria-label="Link name" placeholder={normalizeLink(url) ? linkTitle(normalizeLink(url)!) : 'Name (optional)'}
        value={title} maxLength={200} autoComplete="off" onChange={(change) => setTitle(change.target.value)} />
      <Button type="submit" busy={busy} busyLabel="Adding…">Add</Button>
      <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button>
      {error ? <p className="app-error-text" role="alert">{error}</p> : null}
    </form>
  )
}
