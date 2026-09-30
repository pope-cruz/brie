// Brie's MCP server: the stateless subset of the Streamable HTTP transport.
// Each POST carries one JSON-RPC message (or a batch) and gets a JSON reply.
// There are no sessions, server-initiated messages, or SSE streams, so GET and
// DELETE are refused as the specification allows.
//
// Kept free of Deno APIs so unit tests can import it. Authorization lives in
// the database: `check` and `call` go to the service-role-only
// `assistant_check` and `assistant_call`, which resolve the key and enforce
// its workspace, scope, and creator's current role on every request.

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const SERVER_INFO = { name: 'brie', title: 'Brie', version: '1.0.0' } as const

export type KeyContext = {
  workspaceId: string
  workspaceName: string
  timezone: string
  scope: 'read' | 'read_draft'
  role: 'owner' | 'organizer'
}

export type ToolOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } }

/** Thrown by `check` or `call` when the key is missing, unknown, or no longer valid. */
export class UnauthorizedError extends Error {}

export type McpDeps = {
  check: (key: string) => Promise<KeyContext>
  call: (key: string, tool: string, args: Record<string, unknown>) => Promise<ToolOutcome>
}

type JsonSchema = Record<string, unknown>
export type ToolDefinition = {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  annotations: Record<string, boolean | string>
  scope: 'read' | 'read_draft'
}

const uuid = { type: 'string', format: 'uuid' }
const limit = { type: 'integer', minimum: 1, maximum: 25, description: 'At most 25; defaults to 10.' }
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_workspace',
    title: 'Workspace details',
    description: 'The Brie workspace this key belongs to: its name, default time zone, the current time, and what this key may do. Call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Workspace details', ...readOnly },
    scope: 'read',
  },
  {
    name: 'list_events',
    title: 'List events',
    description: 'Events in this workspace, newest first. `when` is "upcoming" (default), "past", or "any". Returns summaries with IDs; use get_event_plan for the full plan.',
    inputSchema: {
      type: 'object',
      properties: { when: { type: 'string', enum: ['upcoming', 'past', 'any'] }, limit },
      additionalProperties: false,
    },
    annotations: { title: 'List events', ...readOnly },
    scope: 'read',
  },
  {
    name: 'search_events',
    title: 'Search events',
    description: 'Find events whose title, description, or location contains every word of `query`. `when` is "past" (default), "upcoming", or "any". Optionally narrow to one venue. Archived and canceled events are included and labeled, because they are history.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 200 },
        when: { type: 'string', enum: ['past', 'upcoming', 'any'] },
        venueId: uuid,
        limit,
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { title: 'Search events', ...readOnly },
    scope: 'read',
  },
  {
    name: 'get_event_plan',
    title: 'Event plan',
    description: 'One event\'s full plan (contract brie.event-plan/1): details, team briefing, venue, booking status and deadlines, to-dos with due dates relative to the event day, run of show with minute offsets and durations, and attendance totals. Contains no attendee or team member names or contact details.',
    inputSchema: { type: 'object', properties: { eventId: uuid }, required: ['eventId'], additionalProperties: false },
    annotations: { title: 'Event plan', ...readOnly },
    scope: 'read',
  },
  {
    name: 'list_venues',
    title: 'List venues',
    description: 'Venues in this workspace with capacity, type, lead time, cost, accessibility, equipment, restrictions, notes, and past use (event count, last date, largest confirmed attendance).',
    inputSchema: { type: 'object', properties: { includeArchived: { type: 'boolean' } }, additionalProperties: false },
    annotations: { title: 'List venues', ...readOnly },
    scope: 'read',
  },
  {
    name: 'get_venue',
    title: 'Venue',
    description: 'One venue\'s details and the past events held there.',
    inputSchema: { type: 'object', properties: { venueId: uuid }, required: ['venueId'], additionalProperties: false },
    annotations: { title: 'Venue', ...readOnly },
    scope: 'read',
  },
]

export function toolsFor(scope: KeyContext['scope'], tools: ToolDefinition[] = TOOLS) {
  return tools.filter((tool) => tool.scope === 'read' || scope === 'read_draft')
}

export function instructionsFor(context: KeyContext) {
  return [
    `You are connected to the Brie workspace “${context.workspaceName}” (default time zone ${context.timezone}).`,
    'Brie plans student-organization and community events: to-dos, a run of show, venues, and attendance history.',
    'You can only see this one workspace. Plans never include attendee or team member names or contact details, and attendance is given as totals.',
    context.scope === 'read_draft'
      ? 'You can read plans and propose a draft event plan. A draft changes nothing until an organizer reviews and accepts it in Brie. State your assumptions and cite the past events you used.'
      : 'This key is read-only: you cannot change anything in Brie.',
  ].join(' ')
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'www-authenticate',
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...headers } })
}

type JsonRpcId = string | number | null
type JsonRpcMessage = { jsonrpc?: unknown; id?: JsonRpcId; method?: unknown; params?: unknown }

const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0', id, result })

function unauthorized(message = 'Provide a Brie assistant key as “Authorization: Bearer brie_…”.') {
  return jsonResponse(rpcError(null, -32001, message), 401, { 'WWW-Authenticate': 'Bearer realm="brie"' })
}

export function bearerKey(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match ? match[1] : null
}

function negotiate(requested: unknown) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested as never) ? requested as string : SUPPORTED_PROTOCOL_VERSIONS[0]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function handleMessage(message: JsonRpcMessage, key: string, context: KeyContext, deps: McpDeps, tools: ToolDefinition[]) {
  const id = message.id ?? null
  const isNotification = !('id' in message)
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return isNotification ? null : rpcError(id, -32600, 'Invalid JSON-RPC request.')
  }
  if (isNotification) return null
  const params = isRecord(message.params) ? message.params : {}

  switch (message.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: negotiate(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: instructionsFor(context),
      })
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, {
        tools: toolsFor(context.scope, tools).map(({ scope: _scope, ...tool }) => tool),
      })
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const tool = toolsFor(context.scope, tools).find((candidate) => candidate.name === name)
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name || '(none)'}.`)
      const args = isRecord(params.arguments) ? params.arguments : {}
      const outcome = await deps.call(key, tool.name, args)
      if (!outcome.ok) {
        return rpcResult(id, {
          content: [{ type: 'text', text: `${outcome.error.code}: ${outcome.error.message}` }],
          isError: true,
        })
      }
      const structured = isRecord(outcome.result) ? outcome.result : { value: outcome.result }
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(outcome.result) }],
        structuredContent: structured,
        isError: false,
      })
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}.`)
  }
}

export async function handleMcpRequest(request: Request, deps: McpDeps, tools: ToolDefinition[] = TOOLS): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') {
    return jsonResponse(rpcError(null, -32000, 'This server does not open event streams. Send JSON-RPC messages with POST.'), 405, { Allow: 'POST, OPTIONS' })
  }

  const key = bearerKey(request)
  if (!key) return unauthorized()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error: send a JSON-RPC message as JSON.'), 400)
  }
  const messages = Array.isArray(body) ? body : [body]
  if (messages.length === 0 || messages.length > 20 || !messages.every(isRecord)) {
    return jsonResponse(rpcError(null, -32600, 'Invalid JSON-RPC request.'), 400)
  }

  let context: KeyContext
  try {
    context = await deps.check(key)
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized(error.message)
    throw error
  }

  const replies = []
  for (const message of messages as JsonRpcMessage[]) {
    try {
      const reply = await handleMessage(message, key, context, deps, tools)
      if (reply) replies.push(reply)
    } catch (error) {
      if (error instanceof UnauthorizedError) return unauthorized(error.message)
      replies.push(rpcError(message.id ?? null, -32603, 'Brie could not complete that request. Try again.'))
    }
  }
  if (replies.length === 0) return new Response(null, { status: 202, headers: CORS })
  return jsonResponse(Array.isArray(body) ? replies : replies[0])
}
