/** Naming and labels for files and links attached to an event. */

const SOURCES: Array<{ test: (host: string, path: string) => boolean; label: string }> = [
  { test: (host) => host.endsWith('figma.com'), label: 'Figma' },
  { test: (host, path) => host === 'docs.google.com' && path.startsWith('/presentation'), label: 'Google Slides' },
  { test: (host, path) => host === 'docs.google.com' && path.startsWith('/spreadsheets'), label: 'Google Sheets' },
  { test: (host, path) => host === 'docs.google.com' && path.startsWith('/forms'), label: 'Google Forms' },
  { test: (host) => host === 'docs.google.com', label: 'Google Docs' },
  { test: (host) => host === 'drive.google.com', label: 'Google Drive' },
  { test: (host) => host.endsWith('canva.com'), label: 'Canva' },
  { test: (host) => host.endsWith('notion.so') || host.endsWith('notion.site'), label: 'Notion' },
  { test: (host) => host.endsWith('dropbox.com'), label: 'Dropbox' },
  { test: (host) => host.endsWith('sharepoint.com') || host.endsWith('onedrive.live.com'), label: 'OneDrive' },
  { test: (host) => host.endsWith('airtable.com'), label: 'Airtable' },
  { test: (host) => host.endsWith('luma.com') || host === 'lu.ma', label: 'Luma' },
]

/** Adds https:// to a bare domain; returns null for anything that isn't a web address. */
export function normalizeLink(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  const withScheme = /^https?:\/\//i.test(text) ? text : /^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(text) ? `https://${text}` : null
  if (!withScheme || withScheme.length > 2000) return null
  try {
    const url = new URL(withScheme)
    return url.protocol === 'http:' || url.protocol === 'https:' ? withScheme : null
  } catch {
    return null
  }
}

/** Where a link points, e.g. "Figma" or "Google Slides", falling back to the bare host name. */
export function linkSource(href: string): string {
  try {
    const url = new URL(href)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return SOURCES.find((source) => source.test(host, url.pathname))?.label ?? host
  } catch {
    return ''
  }
}

/** A readable default title: a Figma file's name from its URL, otherwise the source. */
export function linkTitle(href: string): string {
  try {
    const url = new URL(href)
    const source = linkSource(href)
    if (source === 'Figma') {
      // figma.com/<kind>/<key>/<File-Name>
      const name = url.pathname.split('/').filter(Boolean)[2]
      if (name) return decodeURIComponent(name).replace(/[-_]+/g, ' ').trim().slice(0, 200) || source
    }
    return source || url.hostname
  } catch {
    return 'Link'
  }
}

export function formatFileSize(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** A short type label from the file name's extension, e.g. "PDF". */
export function fileTypeLabel(name: string, contentType = ''): string {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]
  if (extension) return extension.toUpperCase()
  if (contentType.startsWith('image/')) return 'Image'
  return 'File'
}

export function isImage(name: string, contentType = ''): boolean {
  return contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|svg)$/i.test(name)
}
