// Brie's MCP server for assistants. See protocol.ts for the transport and
// docs/ARCHITECTURE.md ("Assistant access keys") for the key model.
// The service-role client can execute only what the database grants it; the
// assistant entry points resolve the presented key on every request.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleMcpRequest, UnauthorizedError, type KeyContext, type ToolOutcome } from './protocol.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function fail(error: { message: string; details?: string | null }): never {
  if (error.message === 'UNAUTHORIZED') throw new UnauthorizedError(error.details ?? 'This assistant key isn’t valid.')
  throw new Error(`${error.message}: ${error.details ?? ''}`)
}

Deno.serve((request) => handleMcpRequest(request, {
  async check(key) {
    const { data, error } = await admin.rpc('assistant_check', { p_token: key })
    if (error) fail(error)
    return data as KeyContext
  },
  async call(key, tool, args) {
    const { data, error } = await admin.rpc('assistant_call', { p_token: key, p_tool: tool, p_args: args })
    if (error) fail(error)
    return data as ToolOutcome
  },
}))
