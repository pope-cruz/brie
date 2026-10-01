import { execFileSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const SERVER = new URL(`${API}/functions/v1/mcp`)
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_brie'

/** Runs SQL as postgres in the local database container; returns unaligned output. */
export function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input: statement, encoding: 'utf8' }).trim()
}

/** Runs one statement as a signed-in user and returns its single JSON result. */
export function asUser(user: string, statement: string): any {
  const out = sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${user}', true);
    select (${statement})::text; commit;`)
  return JSON.parse(out.split('\n').filter((line) => line.startsWith('{') || line.startsWith('[')).at(-1)!)
}

export async function reachable() {
  try {
    const response = await fetch(SERVER, { method: 'POST', body: '{}' })
    return response.status === 401
  } catch {
    return false
  }
}

/** True when the suite should run; throws in CI when the server is missing. */
export async function requireServer() {
  const ok = await reachable()
  if (!ok && process.env.CI) throw new Error(`Brie's MCP function is not reachable at ${SERVER}`)
  return ok
}

export function createKey(user: string, workspace: string, label: string, scope: 'read' | 'read_draft' = 'read') {
  const created = asUser(user, `public.create_assistant_token('${workspace}', '${label}', '${scope}', 7)`)
  return { id: created.id as string, secret: created.secret as string }
}

export async function connect(secret: string, clients: Client[]) {
  const client = new Client({ name: 'brie-integration-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(SERVER, { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }))
  clients.push(client)
  return client
}

export const structured = (result: Awaited<ReturnType<Client['callTool']>>) => result.structuredContent as Record<string, any>
