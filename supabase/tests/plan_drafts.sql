begin;
select plan(35);

insert into auth.users (id, email) values
  ('f9000000-0000-4000-8000-000000000001', 'draft-owner@example.test'),
  ('f9000000-0000-4000-8000-000000000002', 'draft-organizer@example.test'),
  ('f9000000-0000-4000-8000-000000000003', 'draft-member@example.test'),
  ('f9000000-0000-4000-8000-000000000004', 'draft-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
  ('f9000000-0000-4000-8000-0000000000aa', 'Drafts', 'America/New_York'),
  ('f9000000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f9000000-0000-4000-8000-0000000000aa', 'f9000000-0000-4000-8000-000000000001', 'owner', 'draft-owner@example.test'),
  ('f9000000-0000-4000-8000-0000000000aa', 'f9000000-0000-4000-8000-000000000002', 'organizer', 'draft-organizer@example.test'),
  ('f9000000-0000-4000-8000-0000000000aa', 'f9000000-0000-4000-8000-000000000003', 'member', 'draft-member@example.test'),
  ('f9000000-0000-4000-8000-0000000000bb', 'f9000000-0000-4000-8000-000000000004', 'owner', 'draft-outsider@example.test');
insert into public.venues (id, workspace_id, name, capacity, created_by) values
  ('f9000000-0000-4000-8000-0000000000d1', 'f9000000-0000-4000-8000-0000000000aa', 'Loft', 60, 'f9000000-0000-4000-8000-000000000001'),
  ('f9000000-0000-4000-8000-0000000000d2', 'f9000000-0000-4000-8000-0000000000bb', 'Elsewhere hall', 60, 'f9000000-0000-4000-8000-000000000004');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
  ('f9000000-0000-4000-8000-0000000000e1', 'f9000000-0000-4000-8000-0000000000aa', 'Spring founder dinner', '2026-04-10 23:00+00', '2026-04-11 02:00+00', 'America/New_York', 'f9000000-0000-4000-8000-000000000001'),
  ('f9000000-0000-4000-8000-0000000000f1', 'f9000000-0000-4000-8000-0000000000bb', 'Private', '2026-04-01', '2026-04-01 02:00', 'UTC', 'f9000000-0000-4000-8000-000000000004');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000001', true);
select set_config('test.read_key', public.create_assistant_token('f9000000-0000-4000-8000-0000000000aa', 'Read', 'read', 30)->>'secret', true);
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000002', true);
select set_config('test.draft_key', public.create_assistant_token('f9000000-0000-4000-8000-0000000000aa', 'Drafting', 'read_draft', 30)->>'secret', true);
reset role;

-- A valid proposal, reused below with one field changed at a time.
select set_config('test.proposal', jsonb_build_object(
  'title', 'Fall founder dinner',
  'description', 'Seated dinner for 40 student founders.',
  'startsAt', '2026-11-12T19:00:00-05:00', 'endsAt', '2026-11-12T22:00:00-05:00',
  'venueId', 'f9000000-0000-4000-8000-0000000000d1', 'expectedAttendance', 40,
  'teamBriefing', 'Greet at the door.',
  'todos', jsonb_build_array(
    jsonb_build_object('title', 'Book caterer', 'notes', 'Vegetarian options', 'dueDaysBeforeEvent', 21),
    jsonb_build_object('title', 'Print name cards', 'dueDaysBeforeEvent', 2),
    jsonb_build_object('title', 'Send thank-you notes', 'dueDaysBeforeEvent', -2)),
  'schedule', jsonb_build_array(
    jsonb_build_object('title', 'Setup', 'minutesFromStart', -60, 'durationMinutes', 60),
    jsonb_build_object('title', 'Dinner', 'minutesFromStart', 30, 'durationMinutes', 90, 'instructions', 'Serve at 7:30')),
  'assumptions', jsonb_build_array('40 people, like last spring', 'Same caterer lead time as last time'),
  'citedEventIds', jsonb_build_array('f9000000-0000-4000-8000-0000000000e1'),
  'summary', 'Based on the spring dinner.'
)::text, true);

set local role service_role;
select is(public.assistant_call(current_setting('test.read_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb)->'error'->>'code', 'FORBIDDEN', 'A read-only key cannot propose drafts');
select set_config('test.draft1', public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb)::text, true);
select is(current_setting('test.draft1')::jsonb->'result'->>'status', 'pending', 'A draft key proposes a pending draft');
select matches(current_setting('test.draft1')::jsonb->'result'->>'reviewPath', '^/app/w/f9000000-0000-4000-8000-0000000000aa/drafts/', 'The result says where to review it');
select set_config('test.draft2', public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb || '{"title": "Second idea"}')::text, true);
select is(public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb - 'assumptions')->'error'->>'code', 'VALIDATION', 'Assumptions are required');
select is(public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb || '{"assumptions": []}')->'error'->>'code', 'VALIDATION', 'At least one assumption is required');
select is(public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb || '{"citedEventIds": ["f9000000-0000-4000-8000-0000000000f1"]}')->'error'->>'code', 'VALIDATION', 'Another workspace''s event cannot be cited');
select is(public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb || '{"venueId": "f9000000-0000-4000-8000-0000000000d2"}')->'error'->>'code', 'VALIDATION', 'Another workspace''s venue cannot be proposed');
select is(public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb || '{"startsAt": "next thursday"}')->'error'->>'code', 'VALIDATION', 'Unreadable times are rejected');
select is(public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb - 'endsAt')->'error'->>'message', 'startsAt and endsAt are required ISO 8601 times with an offset, for example 2026-11-12T19:00:00-05:00.', 'Missing times get an actionable message');
select is(public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb || '{"schedule": [{"title": "Zero", "minutesFromStart": 0, "durationMinutes": 0}]}')->'error'->>'code', 'VALIDATION', 'Schedule items need a duration');
select is(public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb || jsonb_build_object('todos', (select jsonb_agg(jsonb_build_object('title', 'x')) from generate_series(1, 61))))->'error'->>'code', 'VALIDATION', 'At most 60 to-dos');
select is(public.assistant_call(current_setting('test.draft_key'), 'create_event_plan_draft', current_setting('test.proposal')::jsonb || '{"todos": [{"title": "Assign Ana", "assigneeEmail": "ana@example.test"}]}')->'ok', 'true'::jsonb, 'Unknown fields such as assignees are ignored, not stored');
reset role;

select is((select count(*)::int from public.events where workspace_id = 'f9000000-0000-4000-8000-0000000000aa'), 1, 'Proposing drafts creates no events');
select ok(position('ana@example.test' in (select string_agg(todos::text, '') from public.event_plan_drafts)) = 0, 'Assignee details are not kept in drafts');
select is((select arguments->>'title' from public.assistant_actions where tool = 'create_event_plan_draft' and outcome = 'ok' order by id limit 1), 'Fall founder dinner', 'Draft proposals are logged with their title');

-- Review permissions
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.list_event_plan_drafts('f9000000-0000-4000-8000-0000000000aa', false)$$, 'P0001', 'FORBIDDEN', 'Members cannot see drafts');
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000004', true);
select throws_ok(format($$select public.get_event_plan_draft('f9000000-0000-4000-8000-0000000000aa', %L)$$, current_setting('test.draft1')::jsonb->'result'->>'draftId'), 'P0001', 'UNAVAILABLE', 'Another workspace cannot read a draft');
select throws_ok(format($$select public.get_event_plan_draft('f9000000-0000-4000-8000-0000000000bb', %L)$$, current_setting('test.draft1')::jsonb->'result'->>'draftId'), 'P0001', 'UNAVAILABLE', 'A draft ID is unavailable from another workspace');

-- Owner reviews
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000001', true);
select is(jsonb_array_length(public.list_event_plan_drafts('f9000000-0000-4000-8000-0000000000aa', false)), 3, 'Pending drafts are listed');
select set_config('test.d1', public.get_event_plan_draft('f9000000-0000-4000-8000-0000000000aa', (current_setting('test.draft1')::jsonb->'result'->>'draftId')::uuid)::text, true);
select is(current_setting('test.d1')::jsonb->'assumptions', '["40 people, like last spring", "Same caterer lead time as last time"]'::jsonb, 'Assumptions are shown for review');
select is(current_setting('test.d1')::jsonb->'citedEvents'->0->>'title', 'Spring founder dinner', 'Cited events are resolved for review');
select is(current_setting('test.d1')::jsonb->>'keyLabel', 'Drafting', 'The proposing key is named');

-- A failed accept changes nothing.
select throws_ok(format($$select public.accept_event_plan_draft('f9000000-0000-4000-8000-0000000000aa', %L, '{"endsAt": "2026-11-12T18:00:00-05:00"}', 1, 'accept-bad-0001')$$, current_setting('test.d1')::jsonb->>'id'), 'P0001', 'VALIDATION', 'An end before the start is rejected');
reset role;
select is((select status from public.event_plan_drafts where id = (current_setting('test.d1')::jsonb->>'id')::uuid), 'pending', 'A rejected accept leaves the draft pending');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000001', true);

-- Accept with changes: new title, drop the second to-do.
select set_config('test.accepted', public.accept_event_plan_draft('f9000000-0000-4000-8000-0000000000aa', (current_setting('test.d1')::jsonb->>'id')::uuid, '{"title": "Founder dinner (fall)", "todoIndexes": [0, 2]}', 1, 'accept-good-0001')::text, true);
select is(public.get_event('f9000000-0000-4000-8000-0000000000aa', (current_setting('test.accepted')::jsonb->>'eventId')::uuid)->>'status', 'draft', 'The accepted plan is a Draft event');
select is(public.get_event('f9000000-0000-4000-8000-0000000000aa', (current_setting('test.accepted')::jsonb->>'eventId')::uuid)->>'title', 'Founder dinner (fall)', 'Accepted with the organizer''s title');
select is(public.get_event_venue('f9000000-0000-4000-8000-0000000000aa', (current_setting('test.accepted')::jsonb->>'eventId')::uuid)->>'venueName', 'Loft', 'The proposed venue is linked');
select is(public.accept_event_plan_draft('f9000000-0000-4000-8000-0000000000aa', (current_setting('test.d1')::jsonb->>'id')::uuid, '{}', 1, 'accept-good-0001'), current_setting('test.accepted')::jsonb, 'Retrying the same accept returns the same event');
select throws_ok(format($$select public.accept_event_plan_draft('f9000000-0000-4000-8000-0000000000aa', %L, '{}', 2, 'accept-again-0001')$$, current_setting('test.d1')::jsonb->>'id'), 'P0001', 'CONFLICT', 'An accepted draft cannot be accepted again');
reset role;
select is((select array_agg(title || ':' || due_date::text order by due_date) from public.tasks where event_id = (current_setting('test.accepted')::jsonb->>'eventId')::uuid), array['Book caterer:2026-10-22', 'Send thank-you notes:2026-11-14'], 'Kept to-dos get due dates relative to the event day');
select is((select count(*)::int from public.tasks where event_id = (current_setting('test.accepted')::jsonb->>'eventId')::uuid and assignee_membership_id is not null), 0, 'Nobody is assigned');
select is((select array_agg(to_char(starts_at at time zone 'America/New_York', 'HH24:MI') || '-' || to_char(ends_at at time zone 'America/New_York', 'HH24:MI') order by starts_at) from public.schedule_segments where event_id = (current_setting('test.accepted')::jsonb->>'eventId')::uuid), array['18:00-19:00', '19:30-21:00'], 'Schedule items keep their offsets from the start');
select is((select safe_metadata->>'draftId' from public.audit_entries where action = 'accept_event_plan_draft' and entity_id = (current_setting('test.accepted')::jsonb->>'eventId')::uuid), current_setting('test.d1')::jsonb->>'id', 'Acceptance is audited with its draft');

-- Discard
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-000000000002', true);
select is(public.discard_event_plan_draft('f9000000-0000-4000-8000-0000000000aa', (current_setting('test.draft2')::jsonb->'result'->>'draftId')::uuid, 1)->>'status', 'discarded', 'An organizer discards a draft');
select throws_ok(format($$select public.discard_event_plan_draft('f9000000-0000-4000-8000-0000000000aa', %L, 2)$$, current_setting('test.draft2')::jsonb->'result'->>'draftId'), 'P0001', 'CONFLICT', 'A discarded draft cannot be discarded again');

reset role;
select * from finish();
rollback;
