import { describe, expect, it, vi } from 'vitest'
import {
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOLS,
  UnauthorizedError,
  bearerKey,
  handleMcpRequest,
  toolsFor,
  type KeyContext,
  type McpDeps,
  type ToolDefinition,
} from '../../supabase/functions/mcp/protocol'

const KEY = `brie_${'b'.repeat(64)}`
const context: KeyContext = { workspaceId: 'w', workspaceName: 'Campus Events', timezone: 'America/New_York', scope: 'read', role: 'organizer' }

function deps(overrides: Partial<McpDeps> = {}): McpDeps {
  return {
    check: vi.fn(async () => context),
    call: vi.fn(async () => ({ ok: true as const, result: { contract: 'brie.event-plan/1', event: { title: 'Dinner' } } })),
    ...overrides,
  }
}

function post(body: unknown, key: string | null = KEY, raw?: string) {
  return new Request('http://localhost/functions/v1/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: raw ?? JSON.stringify(body),
  })
}

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })

describe('MCP transport', () => {
  it('reads only bearer keys', () => {
    expect(bearerKey(post({}, KEY))).toBe(KEY)
    expect(bearerKey(new Request('http://x', { headers: { Authorization: `Basic ${KEY}` } }))).toBeNull()
    expect(bearerKey(new Request('http://x'))).toBeNull()
  })

  it('refuses requests without a key before touching the database', async () => {
    const d = deps()
    const response = await handleMcpRequest(post(rpc('tools/list'), null), d)
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="brie"')
    expect(d.check).not.toHaveBeenCalled()
  })

  it('returns 401 when the database rejects the key', async () => {
    const response = await handleMcpRequest(post(rpc('initialize', {})), deps({
      check: async () => { throw new UnauthorizedError('This assistant key isn’t valid.') },
    }))
    expect(response.status).toBe(401)
    expect((await response.json()).error.message).toBe('This assistant key isn’t valid.')
  })

  it('does not open event streams', async () => {
    const response = await handleMcpRequest(new Request('http://localhost/mcp', { method: 'GET', headers: { Authorization: `Bearer ${KEY}` } }), deps())
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS')
  })

  it('answers CORS preflight', async () => {
    const response = await handleMcpRequest(new Request('http://localhost/mcp', { method: 'OPTIONS' }), deps())
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('mcp-protocol-version')
  })

  it('rejects malformed JSON and empty batches', async () => {
    expect((await handleMcpRequest(post(null, KEY, '{nope'), deps())).status).toBe(400)
    expect((await handleMcpRequest(post([]), deps())).status).toBe(400)
  })
})

describe('MCP lifecycle', () => {
  it('negotiates a supported protocol version and describes the workspace boundary', async () => {
    const response = await handleMcpRequest(post(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })), deps())
    const body = await response.json()
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.serverInfo.name).toBe('brie')
    expect(body.result.capabilities).toEqual({ tools: { listChanged: false } })
    expect(body.result.instructions).toContain('“Campus Events”')
    expect(body.result.instructions).toContain('read-only')
  })

  it('offers its newest version when the client asks for an unknown one', async () => {
    const body = await (await handleMcpRequest(post(rpc('initialize', { protocolVersion: '1999-01-01' })), deps())).json()
    expect(body.result.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSIONS[0])
  })

  it('accepts notifications with 202 and no body', async () => {
    const response = await handleMcpRequest(post({ jsonrpc: '2.0', method: 'notifications/initialized' }), deps())
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('answers ping and unknown methods', async () => {
    expect((await (await handleMcpRequest(post(rpc('ping')), deps())).json()).result).toEqual({})
    expect((await (await handleMcpRequest(post(rpc('resources/list')), deps())).json()).error.code).toBe(-32601)
  })

  it('handles a batch, replying to requests only', async () => {
    const body = await (await handleMcpRequest(post([rpc('ping', undefined, 'a'), { jsonrpc: '2.0', method: 'notifications/initialized' }, rpc('ping', undefined, 'b')]), deps())).json()
    expect(body.map((reply: { id: string }) => reply.id)).toEqual(['a', 'b'])
  })
})

describe('MCP tools', () => {
  it('lists read tools without internal fields, all marked read-only', async () => {
    const body = await (await handleMcpRequest(post(rpc('tools/list')), deps())).json()
    const names = body.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toEqual(['get_workspace', 'list_events', 'search_events', 'get_event_plan', 'list_venues', 'get_venue'])
    for (const tool of body.result.tools) {
      expect(tool).not.toHaveProperty('scope')
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.annotations.readOnlyHint).toBe(true)
    }
  })

  it('lists the draft tool only for draft keys, and it is not marked read-only', async () => {
    const readTools = (await (await handleMcpRequest(post(rpc('tools/list')), deps())).json()).result.tools
    expect(readTools.map((tool: { name: string }) => tool.name)).not.toContain('create_event_plan_draft')
    const draftTools = (await (await handleMcpRequest(post(rpc('tools/list')), deps({ check: async () => ({ ...context, scope: 'read_draft' }) }))).json()).result.tools
    const draft = draftTools.find((tool: { name: string }) => tool.name === 'create_event_plan_draft')
    expect(draft.annotations.readOnlyHint).toBe(false)
    expect(draft.inputSchema.required).toEqual(['title', 'startsAt', 'endsAt', 'assumptions'])
    expect(draft.inputSchema.properties).not.toHaveProperty('assignee')
  })

  it('refuses the draft tool for read-only keys without calling the database', async () => {
    const d = deps()
    const body = await (await handleMcpRequest(post(rpc('tools/call', { name: 'create_event_plan_draft', arguments: {} })), d)).json()
    expect(body.error.code).toBe(-32602)
    expect(d.call).not.toHaveBeenCalled()
  })

  it('links a saved draft to its review page when the app origin is known', async () => {
    const body = await (await handleMcpRequest(post(rpc('tools/call', { name: 'create_event_plan_draft', arguments: { title: 'x' } })), deps({
      appOrigin: 'https://brie.example.test/',
      check: async () => ({ ...context, scope: 'read_draft' }),
      call: async () => ({ ok: true, result: { draftId: 'd1', status: 'pending', reviewPath: '/app/w/w/drafts/d1' } }),
    }))).json()
    expect(body.result.structuredContent.reviewUrl).toBe('https://brie.example.test/app/w/w/drafts/d1')
    expect(JSON.parse(body.result.content[0].text).reviewUrl).toBe('https://brie.example.test/app/w/w/drafts/d1')
  })

  it('shows draft tools only to draft keys', () => {
    const draft: ToolDefinition = { ...TOOLS[0], name: 'create_draft', scope: 'read_draft' }
    expect(toolsFor('read', [...TOOLS, draft]).map((tool) => tool.name)).not.toContain('create_draft')
    expect(toolsFor('read_draft', [...TOOLS, draft]).map((tool) => tool.name)).toContain('create_draft')
  })

  it('calls the database with the key, tool, and arguments and returns text plus structured content', async () => {
    const d = deps()
    const body = await (await handleMcpRequest(post(rpc('tools/call', { name: 'get_event_plan', arguments: { eventId: 'e1' } })), d)).json()
    expect(d.call).toHaveBeenCalledWith(KEY, 'get_event_plan', { eventId: 'e1' })
    expect(body.result.isError).toBe(false)
    expect(JSON.parse(body.result.content[0].text).event.title).toBe('Dinner')
    expect(body.result.structuredContent.contract).toBe('brie.event-plan/1')
  })

  it('reports tool failures as tool errors, not protocol errors', async () => {
    const body = await (await handleMcpRequest(post(rpc('tools/call', { name: 'get_event_plan', arguments: { eventId: 'x' } })), deps({
      call: async () => ({ ok: false, error: { code: 'UNAVAILABLE', message: 'This page isn’t available.' } }),
    }))).json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toBe('UNAVAILABLE: This page isn’t available.')
  })

  it('refuses unknown tools without calling the database', async () => {
    const d = deps()
    const body = await (await handleMcpRequest(post(rpc('tools/call', { name: 'delete_everything', arguments: {} })), d)).json()
    expect(body.error.code).toBe(-32602)
    expect(d.call).not.toHaveBeenCalled()
  })

  it('stops with 401 when a key is revoked mid-session', async () => {
    const response = await handleMcpRequest(post(rpc('tools/call', { name: 'list_events', arguments: {} })), deps({
      call: async () => { throw new UnauthorizedError('This assistant key isn’t valid.') },
    }))
    expect(response.status).toBe(401)
  })

  it('hides unexpected failures behind a retryable internal error', async () => {
    const body = await (await handleMcpRequest(post(rpc('tools/call', { name: 'list_events', arguments: {} })), deps({
      call: async () => { throw new Error('connection reset: secret detail') },
    }))).json()
    expect(body.error).toEqual({ code: -32603, message: 'Brie could not complete that request. Try again.' })
  })
})
