// The roadmap's acceptance scenario for the assistant surface:
// “Plan a 40-person founder dinner based on our last two dinners.”
//
// A scripted assistant, using the official MCP SDK client with a draft key,
// finds the last two dinners, reads both plans, and proposes a draft that
// cites them and states its assumptions. An organizer then accepts it through
// the same RPC the Drafts page uses. The draft must land in the right
// workspace, cite both dinners, and carry their to-dos and run of show.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { asUser, connect, createKey, requireServer, sql, structured } from './helpers'
import type { EventPlan, EventSearchResult } from '../../src/app/data/planningContract'

const run = randomUUID().slice(0, 8)
const id = () => randomUUID()
const ids = {
  organizer: id(), member: id(), outsider: id(), workspace: id(), otherWorkspace: id(), venue: id(),
  spring: id(), winter: id(), older: id(), hackNight: id(), otherDinner: id(),
}
const clients: Client[] = []
let available = false
let key: { id: string; secret: string }

function attendance(eventId: string, people: number, label: string) {
  return `
    insert into public.attendance_batches (id, workspace_id, event_id, created_by, file_label, file_hash, parser_version, outcome_counts, idempotency_key, preview_id)
    values ('${eventId.slice(0, 24)}${'b'.repeat(12)}', '${ids.workspace}', '${eventId}', '${ids.organizer}', '${label}.csv', '${label}-${run}', 'test', '{}', '${label}-${run}', gen_random_uuid());
    insert into public.attendees (workspace_id, email_normalized, display_name)
      select '${ids.workspace}', format('guest-%s-${run}@example.test', n), format('Guest %s', n) from generate_series(1, ${people}) n
      on conflict do nothing;
    insert into public.attendance_contributions (workspace_id, event_id, batch_id, attendee_id, source_row_number)
      select '${ids.workspace}', '${eventId}', '${eventId.slice(0, 24)}${'b'.repeat(12)}', a.id, row_number() over (order by a.email_normalized) + 1
      from public.attendees a where a.workspace_id = '${ids.workspace}' and a.email_normalized like 'guest-%-${run}@example.test'
      order by a.email_normalized limit ${people};`
}

beforeAll(async () => {
  available = await requireServer()
  if (!available) return
  sql(`
    insert into auth.users (id, email) values
      ('${ids.organizer}', 'dinner-organizer-${run}@example.test'),
      ('${ids.member}', 'dinner-member-${run}@example.test'),
      ('${ids.outsider}', 'dinner-outsider-${run}@example.test');
    insert into public.workspaces (id, name, timezone) values
      ('${ids.workspace}', 'Founders Club ${run}', 'America/New_York'),
      ('${ids.otherWorkspace}', 'Other club ${run}', 'America/New_York');
    insert into public.memberships (workspace_id, user_id, role, email_normalized) values
      ('${ids.workspace}', '${ids.organizer}', 'organizer', 'dinner-organizer-${run}@example.test'),
      ('${ids.workspace}', '${ids.member}', 'member', 'dinner-member-${run}@example.test'),
      ('${ids.otherWorkspace}', '${ids.outsider}', 'owner', 'dinner-outsider-${run}@example.test');
    insert into public.venues (id, workspace_id, name, capacity, lead_time_days, created_by) values
      ('${ids.venue}', '${ids.workspace}', 'Greenhouse Loft', 50, 21, '${ids.organizer}');
    insert into public.events (id, workspace_id, title, description, starts_at, ends_at, timezone, venue_id, status, team_briefing, created_by) values
      ('${ids.spring}', '${ids.workspace}', 'Spring founder dinner', 'Seated dinner for student founders.', '2026-04-10 23:00+00', '2026-04-11 02:00+00', 'America/New_York', '${ids.venue}', 'completed', 'Greet at the door.', '${ids.organizer}'),
      ('${ids.winter}', '${ids.workspace}', 'Winter founder dinner', 'Smaller dinner.', '2026-01-22 00:00+00', '2026-01-22 03:00+00', 'America/New_York', null, 'completed', '', '${ids.organizer}'),
      ('${ids.older}', '${ids.workspace}', 'Fall founder dinner 2025', 'The first one.', '2025-10-15 23:00+00', '2025-10-16 02:00+00', 'America/New_York', null, 'completed', '', '${ids.organizer}'),
      ('${ids.hackNight}', '${ids.workspace}', 'Hack night', 'Not a dinner.', '2026-05-01 23:00+00', '2026-05-02 02:00+00', 'America/New_York', null, 'completed', '', '${ids.organizer}'),
      ('${ids.otherDinner}', '${ids.otherWorkspace}', 'Founder dinner at the other club', '', '2026-06-01 23:00+00', '2026-06-02 02:00+00', 'America/New_York', null, 'completed', '', '${ids.outsider}');
    insert into public.tasks (workspace_id, event_id, title, notes, due_date, status, created_by) values
      ('${ids.workspace}', '${ids.spring}', 'Book caterer', 'Vegetarian options', '2026-03-27', 'done', '${ids.organizer}'),
      ('${ids.workspace}', '${ids.spring}', 'Print name cards', '', '2026-04-08', 'done', '${ids.organizer}'),
      ('${ids.workspace}', '${ids.winter}', 'Book caterer', '', '2026-01-11', 'done', '${ids.organizer}'),
      ('${ids.workspace}', '${ids.winter}', 'Invite founders', 'Use the founder list', '2026-01-01', 'done', '${ids.organizer}');
    insert into public.schedule_segments (workspace_id, event_id, title, starts_at, ends_at, instructions) values
      ('${ids.workspace}', '${ids.spring}', 'Doors', '2026-04-10 23:00+00', '2026-04-10 23:30+00', 'Name cards on the left table'),
      ('${ids.workspace}', '${ids.spring}', 'Dinner', '2026-04-10 23:30+00', '2026-04-11 01:00+00', ''),
      ('${ids.workspace}', '${ids.spring}', 'Lightning talks', '2026-04-11 01:00+00', '2026-04-11 01:45+00', '');
    ${attendance(ids.spring, 38, 'spring')}
    ${attendance(ids.winter, 31, 'winter')}
  `)
  key = createKey(ids.organizer, ids.workspace, 'Planning assistant', 'read_draft')
})

afterAll(async () => {
  await Promise.allSettled(clients.map((client) => client.close()))
})

/** What a planning assistant does with the tools; deliberately simple and deterministic. */
async function planFounderDinner(client: Client, headcount: number) {
  const search = structured(await client.callTool({ name: 'search_events', arguments: { query: 'founder dinner', when: 'past', limit: 2 } })) as EventSearchResult
  const plans = await Promise.all(search.events.map(async (event) =>
    structured(await client.callTool({ name: 'get_event_plan', arguments: { eventId: event.id } })) as EventPlan))
  const latest = plans[0]
  const todos = new Map<string, { title: string; notes: string; dueDaysBeforeEvent: number | null }>()
  for (const plan of plans) {
    for (const todo of plan.todos) {
      const known = todos.get(todo.title)
      const days = Math.max(known?.dueDaysBeforeEvent ?? -Infinity, todo.dueDaysBeforeEvent ?? -Infinity)
      todos.set(todo.title, { title: todo.title, notes: known?.notes || todo.notes, dueDaysBeforeEvent: Number.isFinite(days) ? days : null })
    }
  }
  const venue = plans.map((plan) => plan.venue).find((candidate) => candidate && (candidate.capacity ?? 0) >= headcount)
  const draft = {
    title: 'Founder dinner',
    description: latest.event.description,
    startsAt: '2026-11-12T19:00:00-05:00',
    endsAt: '2026-11-12T22:00:00-05:00',
    ...(venue ? { venueId: venue.id } : {}),
    expectedAttendance: headcount,
    teamBriefing: latest.event.teamBriefing,
    todos: [...todos.values()],
    schedule: latest.schedule.map((item) => ({ title: item.title, minutesFromStart: item.minutesFromStart, durationMinutes: item.durationMinutes, instructions: item.instructions })),
    assumptions: [
      `${headcount} people; the last two dinners had ${plans.map((plan) => plan.attendance.confirmed).join(' and ')} confirmed attendees`,
      `Run of show copied from ${latest.event.title}`,
      venue ? `${venue.name} (holds ${venue.capacity}) is available; no booking has been made` : 'Venue still to be chosen',
    ],
    citedEventIds: plans.map((plan) => plan.event.id),
    summary: `Combines the to-dos of ${plans.map((plan) => plan.event.title).join(' and ')}.`,
  }
  return { plans, result: structured(await client.callTool({ name: 'create_event_plan_draft', arguments: draft })) }
}

describe('Plan a 40-person founder dinner based on our last two dinners', () => {
  it('produces a reviewable draft in the right workspace, citing both dinners with visible assumptions', async ({ skip }) => {
    if (!available) skip()
    const client = await connect(key.secret, clients)
    const { plans, result } = await planFounderDinner(client, 40)

    expect(plans.map((plan) => plan.event.title)).toEqual(['Spring founder dinner', 'Winter founder dinner'])
    expect(plans.map((plan) => plan.attendance.confirmed)).toEqual([38, 31])
    expect(JSON.stringify(plans)).not.toMatch(/guest-|Guest \d|@/)
    expect(result.status).toBe('pending')

    // Nothing exists in the workspace yet; members can't see the draft.
    expect(sql(`select count(*) from public.events where workspace_id = '${ids.workspace}' and title = 'Founder dinner'`)).toBe('0')
    expect(() => asUser(ids.member, `public.list_event_plan_drafts('${ids.workspace}', false)`)).toThrow(/FORBIDDEN/)
    expect(() => asUser(ids.outsider, `public.get_event_plan_draft('${ids.workspace}', '${result.draftId}')`)).toThrow(/UNAVAILABLE/)

    const draft = asUser(ids.organizer, `public.get_event_plan_draft('${ids.workspace}', '${result.draftId}')`)
    expect(draft.citedEvents.map((event: { title: string }) => event.title)).toEqual(['Spring founder dinner', 'Winter founder dinner'])
    expect(draft.assumptions[0]).toBe('40 people; the last two dinners had 38 and 31 confirmed attendees')
    expect(draft.venue.name).toBe('Greenhouse Loft')
    expect(draft.todos.map((todo: { title: string; dueDaysBeforeEvent: number }) => `${todo.title}:${todo.dueDaysBeforeEvent}`))
      .toEqual(['Book caterer:14', 'Print name cards:2', 'Invite founders:20'])

    // The organizer accepts it as proposed.
    const accepted = asUser(ids.organizer, `public.accept_event_plan_draft('${ids.workspace}', '${result.draftId}', '{}', 1, 'scenario-${run}')`)
    const plan = asUser(ids.organizer, `public.get_event_plan('${ids.workspace}', '${accepted.eventId}')`) as EventPlan
    expect(plan.event.status).toBe('draft')
    expect(plan.event.localDate).toBe('2026-11-12')
    expect(plan.venue?.name).toBe('Greenhouse Loft')
    expect(plan.todos.map((todo) => `${todo.title}:${todo.dueDate}:${todo.assigned}`)).toEqual([
      'Invite founders:2026-10-23:false', 'Book caterer:2026-10-29:false', 'Print name cards:2026-11-10:false',
    ])
    expect(plan.schedule.map((item) => `${item.minutesFromStart}+${item.durationMinutes} ${item.title}`)).toEqual(['0+30 Doors', '30+90 Dinner', '120+45 Lightning talks'])
    expect(plan.event.teamBriefing).toBe('Greet at the door.')
    expect(plan.attendance.confirmed).toBe(0)

    const audit = JSON.parse(sql(`select safe_metadata::text from public.audit_entries where action = 'accept_event_plan_draft' and entity_id = '${accepted.eventId}'`))
    expect(audit.citedEventIds.sort()).toEqual([ids.spring, ids.winter].sort())
    expect(sql(`select string_agg(tool || ':' || outcome, ',' order by id) from public.assistant_actions where token_id = '${key.id}'`))
      .toBe('search_events:ok,get_event_plan:ok,get_event_plan:ok,create_event_plan_draft:ok')
    expect(sql(`select count(*) from public.event_plan_drafts where workspace_id = '${ids.otherWorkspace}'`)).toBe('0')
  })
})
