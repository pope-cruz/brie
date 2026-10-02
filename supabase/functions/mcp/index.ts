// Brie's MCP server for assistants. See protocol.ts for the transport and
// docs/ARCHITECTURE.md ("Assistant access keys") for the key model.
// The service-role client can execute only what the database grants it; the
// assistant entry points resolve the presented key on every request.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleMcpRequest, UnauthorizedError, type KeyContext, type ToolOutcome } from './protocol.ts'
import { oauthIdentity } from './oauth.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function fail(error: { message: string; details?: string | null }): never {
  if (error.message === 'UNAUTHORIZED') throw new UnauthorizedError(error.details ?? 'This assistant key isn’t valid.')
  throw new Error(`${error.message}: ${error.details ?? ''}`)
}

// Hosted SUPABASE_URL is public. The local runtime uses an internal Kong URL,
// so local serving supplies MCP_PUBLIC_URL explicitly.
const resource = Deno.env.get('MCP_PUBLIC_URL') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/mcp`
const issuer = `${resource.replace(/\/functions\/v1\/mcp$/, '')}/auth/v1`

async function identity(token: string) {
  const { data, error } = await admin.auth.getClaims(token)
  if (error || !data?.claims) throw new UnauthorizedError('Sign in to Brie again to reconnect this assistant.')
  return oauthIdentity(data.claims, issuer, resource)
}

Deno.serve((request) => handleMcpRequest(request, {
  appOrigin: Deno.env.get('APP_ORIGIN') ?? undefined,
  oauth: { resource, issuer },
  async check(key) {
    const { data, error } = key.startsWith('brie_')
      ? await admin.rpc('assistant_check', { p_token: key })
      : await admin.rpc('assistant_oauth_check', await identity(key))
    if (error) fail(error)
    return data as KeyContext
  },
  async call(key, tool, args) {
    const { data, error } = key.startsWith('brie_')
      ? await admin.rpc('assistant_call', { p_token: key, p_tool: tool, p_args: args })
      : await admin.rpc('assistant_oauth_call', { ...await identity(key), p_tool: tool, p_args: args })
    if (error) fail(error)
    return data as ToolOutcome
  },
}))
