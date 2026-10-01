// Connects the official MCP TypeScript SDK client to Brie's MCP Edge Function
// on the local stack. Fixtures are fictional rows written through psql in the
// local database container, with a fresh suffix per run; keys are created by
// the same `create_assistant_token` RPC the app uses.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVER = new URL(`${API}/functions/v1/mcp`)
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_brie'

function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input: statement, encoding: 'utf8' }).trim()
}

async function reachable() {
  try {
    const response = await fetch(SERVER, { method: 'POST', body: '{}' })
    return response.status === 401
  } catch {
    return false
  }
}

const id = () => randomUUID()
const run = randomUUID().slice(0, 8)
const ids = {
  ownerA: id(), organizerA: id(), ownerB: id(),
  workspaceA: id(), workspaceB: id(), venue: id(),
  spring: id(), winter: id(), upcoming: id(), other: id(),
}
const keys: Record<string, { id: string; secret: string }> = {}
const clients: Client[] = []

function createKey(user: string, workspace: string, label: string, scope: 'read' | 'read_draft' = 'read') {
  const out = sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${user}', true);
    select public.create_assistant_token('${workspace}', '${label}', '${scope}', 7)::text; commit;`)
  const created = JSON.parse(out.split('\n').filter((line) => line.startsWith('{')).at(-1)!)
  return { id: created.id as string, secret: created.secret as string }
}

async function connect(secret: string) {
  const client = new Client({ name: 'brie-integration-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(SERVER, { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }))
  clients.push(client)
  return client
}

const structured = (result: Awaited<ReturnType<Client['callTool']>>) => result.structuredContent as Record<string, any>

let available = false

beforeAll(async () => {
  available = await reachable()
  if (!available) {
    if (process.env.CI) throw new Error(`Brie's MCP function is not reachable at ${SERVER}`)
    return
  }
  sql(`
    insert into auth.users (id, email) values
      ('${ids.ownerA}', 'mcp-owner-${run}@example.test'),
      ('${ids.organizerA}', 'mcp-organizer-${run}@example.test'),
      ('${ids.ownerB}', 'mcp-other-${run}@example.test');
    insert into public.workspaces (id, name, timezone) values
      ('${ids.workspaceA}', 'MCP test ${run}', 'America/New_York'),
      ('${ids.workspaceB}', 'MCP other ${run}', 'UTC');
    insert into public.memberships (workspace_id, user_id, role, email_normalized) values
      ('${ids.workspaceA}', '${ids.ownerA}', 'owner', 'mcp-owner-${run}@example.test'),
      ('${ids.workspaceA}', '${ids.organizerA}', 'organizer', 'mcp-organizer-${run}@example.test'),
      ('${ids.workspaceB}', '${ids.ownerB}', 'owner', 'mcp-other-${run}@example.test');
    insert into public.venues (id, workspace_id, name, capacity, lead_time_days, created_by) values
      ('${ids.venue}', '${ids.workspaceA}', 'Greenhouse Loft', 60, 21, '${ids.ownerA}');
    insert into public.events (id, workspace_id, title, description, starts_at, ends_at, timezone, venue_id, status, created_by) values
      ('${ids.spring}', '${ids.workspaceA}', 'Spring founder dinner', 'Seated dinner', now() - interval '60 days', now() - interval '60 days' + interval '3 hours', 'America/New_York', '${ids.venue}', 'completed', '${ids.ownerA}'),
      ('${ids.winter}', '${ids.workspaceA}', 'Winter founder dinner', 'Smaller', now() - interval '150 days', now() - interval '150 days' + interval '3 hours', 'America/New_York', null, 'completed', '${ids.ownerA}'),
      ('${ids.upcoming}', '${ids.workspaceA}', 'Welcome night', '', now() + interval '20 days', now() + interval '20 days' + interval '2 hours', 'America/New_York', null, 'planned', '${ids.ownerA}'),
      ('${ids.other}', '${ids.workspaceB}', 'Founder dinner elsewhere', '', now() - interval '30 days', now() - interval '30 days' + interval '2 hours', 'UTC', null, 'completed', '${ids.ownerB}');
    insert into public.tasks (workspace_id, event_id, title, due_date, created_by) values
      ('${ids.workspaceA}', '${ids.spring}', 'Book caterer', (now() - interval '74 days')::date, '${ids.ownerA}');
    insert into public.schedule_segments (workspace_id, event_id, title, starts_at, ends_at) values
      ('${ids.workspaceA}', '${ids.spring}', 'Doors', now() - interval '60 days', now() - interval '60 days' + interval '30 minutes');
  `)
  keys.owner = createKey(ids.ownerA, ids.workspaceA, 'Owner laptop')
  keys.organizer = createKey(ids.organizerA, ids.workspaceA, 'Organizer laptop')
  keys.other = createKey(ids.ownerB, ids.workspaceB, 'Other workspace')
  keys.drafting = createKey(ids.ownerA, ids.workspaceA, 'Drafting laptop', 'read_draft')
})

afterAll(async () => {
  await Promise.allSettled(clients.map((client) => client.close()))
})

describe('Brie MCP server with the official SDK client', () => {
  it('initializes and lists read-only tools', async ({ skip }) => {
    if (!available) skip()
    const client = await connect(keys.owner.secret)
    expect(client.getServerVersion()?.name).toBe('brie')
    expect(client.getInstructions()).toContain(`MCP test ${run}`)
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(['get_workspace', 'list_events', 'search_events', 'get_event_plan', 'list_venues', 'get_venue'])
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
  })

  it('reads the workspace, searches past events, and reads a plan', async ({ skip }) => {
    if (!available) skip()
    const client = await connect(keys.owner.secret)
    expect(structured(await client.callTool({ name: 'get_workspace', arguments: {} })).name).toBe(`MCP test ${run}`)
    const search = structured(await client.callTool({ name: 'search_events', arguments: { query: 'founder dinner' } }))
    expect(search.contract).toBe('brie.event-search/1')
    expect(search.events.map((event: { title: string }) => event.title)).toEqual(['Spring founder dinner', 'Winter founder dinner'])
    const upcoming = structured(await client.callTool({ name: 'list_events', arguments: {} }))
    expect(upcoming.events.map((event: { title: string }) => event.title)).toEqual(['Welcome night'])
    const plan = structured(await client.callTool({ name: 'get_event_plan', arguments: { eventId: ids.spring } }))
    expect(plan.contract).toBe('brie.event-plan/1')
    expect(plan.venue.name).toBe('Greenhouse Loft')
    expect(plan.todos[0].dueDaysBeforeEvent).toBe(14)
    expect(plan.schedule[0].minutesFromStart).toBe(0)
    expect(JSON.stringify(plan)).not.toContain('@')
  })

  it('reads venues', async ({ skip }) => {
    if (!available) skip()
    const client = await connect(keys.organizer.secret)
    const venues = structured(await client.callTool({ name: 'list_venues', arguments: {} }))
    expect(venues.venues.map((venue: { name: string }) => venue.name)).toEqual(['Greenhouse Loft'])
    const venue = structured(await client.callTool({ name: 'get_venue', arguments: { venueId: ids.venue } }))
    expect(venue.pastEvents.map((event: { title: string }) => event.title)).toEqual(['Spring founder dinner'])
  })

  it('keeps each key inside its own workspace', async ({ skip }) => {
    if (!available) skip()
    const client = await connect(keys.other.secret)
    const denied = await client.callTool({ name: 'get_event_plan', arguments: { eventId: ids.spring } })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toContain('UNAVAILABLE')
    const search = structured(await client.callTool({ name: 'search_events', arguments: { query: 'founder' } }))
    expect(search.events.map((event: { title: string }) => event.title)).toEqual(['Founder dinner elsewhere'])
  })

  it('lets a draft key propose a plan that changes nothing until reviewed', async ({ skip }) => {
    if (!available) skip()
    const client = await connect(keys.drafting.secret)
    const { tools } = await client.listTools()
    const draftTool = tools.find((tool) => tool.name === 'create_event_plan_draft')
    expect(draftTool?.annotations?.readOnlyHint).toBe(false)
    const eventsBefore = sql(`select count(*) from public.events where workspace_id = '${ids.workspaceA}'`)
    const proposal = {
      title: 'Fall founder dinner',
      startsAt: '2026-11-12T19:00:00-05:00', endsAt: '2026-11-12T22:00:00-05:00',
      venueId: ids.venue, expectedAttendance: 40,
      todos: [{ title: 'Book caterer', dueDaysBeforeEvent: 14 }],
      schedule: [{ title: 'Doors', minutesFromStart: 0, durationMinutes: 30 }],
      assumptions: ['40 people, like the spring dinner'],
      citedEventIds: [ids.spring, ids.winter],
    }
    const saved = structured(await client.callTool({ name: 'create_event_plan_draft', arguments: proposal }))
    expect(saved.status).toBe('pending')
    expect(saved.reviewPath).toBe(`/app/w/${ids.workspaceA}/drafts/${saved.draftId}`)
    expect(sql(`select count(*) from public.events where workspace_id = '${ids.workspaceA}'`)).toBe(eventsBefore)
    expect(sql(`select status || ':' || array_length(cited_event_ids, 1) from public.event_plan_drafts where id = '${saved.draftId}'`)).toBe('pending:2')

    const rejected = await client.callTool({ name: 'create_event_plan_draft', arguments: { ...proposal, citedEventIds: [ids.other] } })
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected.content)).toContain('Every cited event must be an event in this workspace')
  })

  it('does not offer the draft tool to a read-only key', async ({ skip }) => {
    if (!available) skip()
    const client = await connect(keys.owner.secret)
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).not.toContain('create_event_plan_draft')
    await expect(client.callTool({ name: 'create_event_plan_draft', arguments: {} })).rejects.toThrow()
  })

  it('rejects an unknown key before a session starts', async ({ skip }) => {
    if (!available) skip()
    await expect(connect(`brie_${'0'.repeat(64)}`)).rejects.toThrow()
  })

  it('stops a connected assistant as soon as its key is revoked', async ({ skip }) => {
    if (!available) skip()
    const client = await connect(keys.organizer.secret)
    await client.callTool({ name: 'get_workspace', arguments: {} })
    sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${ids.ownerA}', true);
      select public.revoke_assistant_token('${ids.workspaceA}', '${keys.organizer.id}'); commit;`)
    await expect(client.callTool({ name: 'get_workspace', arguments: {} })).rejects.toThrow()
  })

  it('logs every call against the key that made it', async ({ skip }) => {
    if (!available) skip()
    const logged = Number(sql(`select count(*) from public.assistant_actions where token_id = '${keys.owner.id}'`))
    expect(logged).toBe(4)
    expect(sql(`select string_agg(outcome, ',' order by id) from public.assistant_actions where token_id = '${keys.drafting.id}'`)).toBe('ok,VALIDATION')
    expect(sql(`select string_agg(outcome, ',' order by outcome) from (select distinct outcome from public.assistant_actions where token_id = '${keys.other.id}') o`).split(',').sort()).toEqual(['UNAVAILABLE', 'ok'])
  })
})
