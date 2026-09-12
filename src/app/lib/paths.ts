export function safeReturnPath(value: string | null | undefined): string {
  if (!value || [...value].some((character) => character.charCodeAt(0) <= 32 || character === '\\')) return '/app'
  try {
    const url = new URL(value, 'https://brie.invalid')
    if (!value.startsWith('/') || url.origin !== 'https://brie.invalid') return '/app'
    const path = decodeURIComponent(url.pathname)
    if ((path !== '/app' && !path.startsWith('/app/')) || path.includes('\\')) return '/app'
    if (/^\/app\/sign-in\/?$/.test(path)) return '/app'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/app'
  }
}

export function workspacePath(workspaceId: string, suffix = 'events') {
  return `/app/w/${workspaceId}/${suffix}`
}

export function rememberWorkspace(workspaceId: string) {
  localStorage.setItem('brie:last-workspace', workspaceId)
}

export function lastWorkspace(): string | null {
  return localStorage.getItem('brie:last-workspace')
}
