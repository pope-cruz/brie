-- Every assistant tool, called with another workspace's IDs, stays inside the
-- key's own workspace; a key whose creator is demoted loses every tool.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('fa000000-0000-4000-8000-000000000001', 'surface-a@example.test'),
  ('fa000000-0000-4000-8000-000000000002', 'surface-b@example.test');
insert into public.workspaces (id, name, timezone) values
  ('fa000000-0000-4000-8000-0000000000aa', 'Surface A', 'UTC'),
  ('fa000000-0000-4000-8000-0000000000bb', 'Surface B', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('fa000000-0000-4000-8000-0000000000aa', 'fa000000-0000-4000-8000-000000000001', 'organizer', 'surface-a@example.test'),
  ('fa000000-0000-4000-8000-0000000000bb', 'fa000000-0000-4000-8000-000000000002', 'owner', 'surface-b@example.test');
insert into public.venues (id, workspace_id, name, created_by) values
  ('fa000000-0000-4000-8000-0000000000d1', 'fa000000-0000-4000-8000-0000000000aa', 'A room', 'fa000000-0000-4000-8000-000000000001'),
  ('fa000000-0000-4000-8000-0000000000d2', 'fa000000-0000-4000-8000-0000000000bb', 'B room', 'fa000000-0000-4000-8000-000000000002');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, venue_id, created_by) values
  ('fa000000-0000-4000-8000-0000000000e1', 'fa000000-0000-4000-8000-0000000000aa', 'A dinner', now() - interval '9 days', now() - interval '9 days' + interval '2 hours', 'UTC', 'fa000000-0000-4000-8000-0000000000d1', 'fa000000-0000-4000-8000-000000000001'),
  ('fa000000-0000-4000-8000-0000000000e2', 'fa000000-0000-4000-8000-0000000000bb', 'B dinner', now() - interval '9 days', now() - interval '9 days' + interval '2 hours', 'UTC', 'fa000000-0000-4000-8000-0000000000d2', 'fa000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000001', true);
select set_config('test.key', public.create_assistant_token('fa000000-0000-4000-8000-0000000000aa', 'Surface', 'read_draft', 7)->>'secret', true);
reset role;

set local role service_role;
select is(public.assistant_call(current_setting('test.key'), 'get_workspace', '{}')->'result'->>'name', 'Surface A', 'get_workspace names the key''s workspace');
select is(public.assistant_call(current_setting('test.key'), 'get_event_plan', '{"eventId": "fa000000-0000-4000-8000-0000000000e2"}')->'error'->>'code', 'UNAVAILABLE', 'get_event_plan: another workspace''s event is unavailable');
select is(public.assistant_call(current_setting('test.key'), 'get_venue', '{"venueId": "fa000000-0000-4000-8000-0000000000d2"}')->'error'->>'code', 'UNAVAILABLE', 'get_venue: another workspace''s venue is unavailable');
select is(jsonb_array_length(public.assistant_call(current_setting('test.key'), 'search_events', '{"query": "", "when": "any", "venueId": "fa000000-0000-4000-8000-0000000000d2"}')->'result'->'events'), 0, 'search_events: another workspace''s venue matches nothing');
select is((select jsonb_agg(e->>'title') from jsonb_array_elements(public.assistant_call(current_setting('test.key'), 'search_events', '{"query": "dinner", "when": "any"}')->'result'->'events') e), '["A dinner"]'::jsonb, 'search_events: only the key''s workspace');
select is((select jsonb_agg(e->>'title') from jsonb_array_elements(public.assistant_call(current_setting('test.key'), 'list_events', '{"when": "any"}')->'result'->'events') e), '["A dinner"]'::jsonb, 'list_events: only the key''s workspace');
select is((select jsonb_agg(v->>'name') from jsonb_array_elements(public.assistant_call(current_setting('test.key'), 'list_venues', '{"includeArchived": true}')->'result'->'venues') v), '["A room"]'::jsonb, 'list_venues: only the key''s workspace');
select is(public.assistant_call(current_setting('test.key'), 'create_event_plan_draft', jsonb_build_object(
  'title', 'x', 'startsAt', '2026-12-01T18:00:00Z', 'endsAt', '2026-12-01T20:00:00Z', 'assumptions', jsonb_build_array('x'),
  'citedEventIds', jsonb_build_array('fa000000-0000-4000-8000-0000000000e2')))->'error'->>'code', 'VALIDATION', 'create_event_plan_draft: cannot cite another workspace''s event');
select is(public.assistant_call(current_setting('test.key'), 'create_event_plan_draft', jsonb_build_object(
  'title', 'x', 'startsAt', '2026-12-01T18:00:00Z', 'endsAt', '2026-12-01T20:00:00Z', 'assumptions', jsonb_build_array('x'),
  'venueId', 'fa000000-0000-4000-8000-0000000000d2'))->'error'->>'code', 'VALIDATION', 'create_event_plan_draft: cannot use another workspace''s venue');
reset role;
select is((select count(*)::int from public.event_plan_drafts where workspace_id = 'fa000000-0000-4000-8000-0000000000bb'), 0, 'No draft reaches the other workspace');

-- Demoting the creator to member removes every tool at once.
update public.memberships set role = 'member' where user_id = 'fa000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.assistant_call(current_setting('test.key'), 'get_workspace', '{}')$$, 'P0001', 'UNAUTHORIZED', 'A member''s key cannot read');
select throws_ok($$select public.assistant_call(current_setting('test.key'), 'create_event_plan_draft', '{}')$$, 'P0001', 'UNAUTHORIZED', 'A member''s key cannot propose');

reset role;
select * from finish();
rollback;
