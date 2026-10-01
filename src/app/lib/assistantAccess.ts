import type { AssistantAction, AssistantScope } from '../data/types'

export const KEY_LIFETIMES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
] as const

export function scopeLabel(scope: AssistantScope) {
  return scope === 'read_draft' ? 'Read and propose drafts' : 'Read only'
}

/** The assistant server is a Supabase Edge Function beside the database API. */
export function mcpServerUrl(supabaseUrl: string) {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/mcp`
}

export function claudeCodeCommand(serverUrl: string, secret: string) {
  return `claude mcp add --transport http brie ${serverUrl} --header "Authorization: Bearer ${secret}"`
}

const TOOL_LABELS: Record<string, string> = {
  get_workspace: 'Read workspace details',
  list_events: 'Listed events',
  search_events: 'Searched events',
  get_event_plan: 'Read an event plan',
  list_venues: 'Listed venues',
  get_venue: 'Read a venue',
  create_event_plan_draft: 'Proposed a draft plan',
}

export function describeAction(action: Pick<AssistantAction, 'tool' | 'arguments'>) {
  const label = TOOL_LABELS[action.tool] ?? `Called ${action.tool || 'an unknown tool'}`
  const query = action.arguments.query
  return typeof query === 'string' && query ? `${label}: “${query}”` : label
}

export function outcomeLabel(outcome: string) {
  if (outcome === 'ok') return 'Done'
  if (outcome === 'UNAVAILABLE') return 'Not found in this workspace'
  if (outcome === 'VALIDATION') return 'Rejected: invalid request'
  if (outcome === 'FORBIDDEN') return 'Rejected: not allowed'
  return `Failed (${outcome})`
}
