export function prefixMatch(query: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return fields.some((field) => (field ?? '').trim().toLowerCase().startsWith(needle))
}

export const SEARCH_DEBOUNCE_MS = 250
export const PAGE_SIZE = 50
