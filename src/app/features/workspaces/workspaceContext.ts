import { useOutletContext } from 'react-router-dom'
import type { WorkspaceSummary } from '../../data/api'

export function useCurrentWorkspace() {
  return useOutletContext<WorkspaceSummary>()
}
