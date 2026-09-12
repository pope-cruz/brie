export function getRequestKey(scope: string): string {
  const storageKey = `brie:req:${scope}`
  const existing = sessionStorage.getItem(storageKey)
  if (existing) return existing
  const next = crypto.randomUUID()
  sessionStorage.setItem(storageKey, next)
  return next
}

export function clearRequestKey(scope: string): void {
  sessionStorage.removeItem(`brie:req:${scope}`)
}

export function fileSha256Hex(buffer: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', buffer).then((digest) => {
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  })
}
