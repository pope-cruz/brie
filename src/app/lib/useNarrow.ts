import { useEffect, useState } from 'react'

const NARROW = '(max-width: 767px)'

/** True below 768px, where lists replace grids and editing moves into full-screen sheets. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(NARROW).matches))
  useEffect(() => {
    const query = window.matchMedia?.(NARROW)
    if (!query) return
    const update = () => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}
