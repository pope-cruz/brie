begin;
select plan(25);

insert into auth.users (id, email) values
  ('f7000000-0000-4000-8000-000000000001', 'plan-owner@example.test'),
  ('f7000000-0000-4000-8000-000000000002', 'plan-member@example.test'),
  ('f7000000-0000-4000-8000-000000000003', 'plan-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
  ('f7000000-0000-4000-8000-0000000000aa', 'Plans', 'America/New_York'),
  ('f7000000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (id, workspace_id, user_id, role, email_normalized) values
  ('f7000000-0000-4000-8000-000000000011', 'f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-000000000001', 'owner', 'plan-owner@example.test'),
  ('f7000000-0000-4000-8000-000000000012', 'f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-000000000002', 'member', 'plan-member@example.test'),
  ('f7000000-0000-4000-8000-000000000013', 'f7000000-0000-4000-8000-0000000000bb', 'f7000000-0000-4000-8000-000000000003', 'owner', 'plan-outsider@example.test');
insert into public.venues (id, workspace_id, name, capacity, lead_time_days, created_by) values
  ('f7000000-0000-4000-8000-0000000000d1', 'f7000000-0000-4000-8000-0000000000aa', 'Loft', 50, 21, 'f7000000-0000-4000-8000-000000000001');
insert into public.events (id, workspace_id, title, description, location, starts_at, ends_at, timezone, venue_id, status, team_briefing, archived_at, created_by) values
  ('f7000000-0000-4000-8000-0000000000e1', 'f7000000-0000-4000-8000-0000000000aa', 'Spring founder dinner', 'A seated dinner for student founders.', 'Loft', '2026-04-10 23:00+00', '2026-04-11 02:00+00', 'America/New_York', 'f7000000-0000-4000-8000-0000000000d1', 'completed', 'Greet at the door.', null, 'f7000000-0000-4000-8000-000000000001'),
  ('f7000000-0000-4000-8000-0000000000e2', 'f7000000-0000-4000-8000-0000000000aa', 'Winter founder dinner', 'Smaller dinner.', '', '2026-01-15 23:00+00', '2026-01-16 02:00+00', 'America/New_York', null, 'completed', '', now(), 'f7000000-0000-4000-8000-000000000001'),
  ('f7000000-0000-4000-8000-0000000000e3', 'f7000000-0000-4000-8000-0000000000aa', 'Hack night', 'Build things.', 'Lab', '2026-03-01 23:00+00', '2026-03-02 02:00+00', 'America/New_York', null, 'completed', '', null, 'f7000000-0000-4000-8000-000000000001'),
  ('f7000000-0000-4000-8000-0000000000e4', 'f7000000-0000-4000-8000-0000000000aa', 'Next founder dinner', '', '', now() + interval '30 days', now() + interval '30 days 3 hours', 'America/New_York', null, 'planned', '', null, 'f7000000-0000-4000-8000-000000000001'),
  ('f7000000-0000-4000-8000-0000000000f1', 'f7000000-0000-4000-8000-0000000000bb', 'Founder dinner elsewhere', '', '', '2026-04-01', '2026-04-01 02:00', 'UTC', null, 'completed', '', null, 'f7000000-0000-4000-8000-000000000003');
insert into public.tasks (workspace_id, event_id, title, notes, assignee_membership_id, due_date, status, removed_at, created_by) values
  ('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1', 'Book caterer', 'Vegetarian options', 'f7000000-0000-4000-8000-000000000012', '2026-03-27', 'done', null, 'f7000000-0000-4000-8000-000000000001'),
  ('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1', 'Print name cards', '', null, null, 'todo', null, 'f7000000-0000-4000-8000-000000000001'),
  ('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1', 'Removed idea', '', null, null, 'todo', now(), 'f7000000-0000-4000-8000-000000000001');
insert into public.schedule_segments (id, workspace_id, event_id, title, starts_at, ends_at, instructions) values
  ('f7000000-0000-4000-8000-000000000051', 'f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1', 'Doors', '2026-04-10 23:00+00', '2026-04-10 23:30+00', 'Check names'),
  ('f7000000-0000-4000-8000-000000000052', 'f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1', 'Dinner', '2026-04-10 23:30+00', '2026-04-11 01:00+00', '');
insert into public.schedule_segment_people (workspace_id, segment_id, membership_id) values
  ('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-000000000051', 'f7000000-0000-4000-8000-000000000012');
insert into public.attendees (id, workspace_id, email_normalized, display_name) values
  ('f7000000-0000-4000-8000-0000000000a1', 'f7000000-0000-4000-8000-0000000000aa', 'guest-a@example.test', 'Guest A'),
  ('f7000000-0000-4000-8000-0000000000a2', 'f7000000-0000-4000-8000-0000000000aa', 'guest-b@example.test', 'Guest B');
insert into public.attendance_batches (id, workspace_id, event_id, created_by, file_label, file_hash, parser_version, outcome_counts, idempotency_key, preview_id) values
  ('f7000000-0000-4000-8000-0000000000b1', 'f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e2', 'f7000000-0000-4000-8000-000000000001', 'winter.csv', 'h1', 'test', '{}', 'k1', 'f7000000-0000-4000-8000-0000000000c1'),
  ('f7000000-0000-4000-8000-0000000000b2', 'f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1', 'f7000000-0000-4000-8000-000000000001', 'spring.csv', 'h2', 'test', '{}', 'k2', 'f7000000-0000-4000-8000-0000000000c2');
insert into public.attendance_contributions (workspace_id, event_id, batch_id, attendee_id, source_row_number) values
  ('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e2', 'f7000000-0000-4000-8000-0000000000b1', 'f7000000-0000-4000-8000-0000000000a1', 2),
  ('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1', 'f7000000-0000-4000-8000-0000000000b2', 'f7000000-0000-4000-8000-0000000000a1', 2),
  ('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1', 'f7000000-0000-4000-8000-0000000000b2', 'f7000000-0000-4000-8000-0000000000a2', 3);

set local role authenticated;
-- Member
select set_config('request.jwt.claim.sub', 'f7000000-0000-4000-8000-000000000002', true);
select is(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->>'contract', 'brie.event-plan/1', 'Plan names its contract version');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')) k),
  array['attendance', 'booking', 'contract', 'event', 'schedule', 'todos', 'venue'],
  'Plan has the documented top-level keys'
);
select is(jsonb_array_length(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'todos'), 2, 'Removed to-dos are left out');
select is(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'todos'->0->>'dueDaysBeforeEvent', '14', 'Due dates are also relative to the event day');
select is((public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'todos'->0->>'assigned')::boolean, true, 'Assignment is a flag');
select is(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'schedule'->1->>'minutesFromStart', '30', 'Schedule items carry their offset from the start');
select is(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'schedule'->0->>'peopleCount', '1', 'Schedule items count people without naming them');
select is(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'event'->>'localDate', '2026-04-10', 'Local date follows the event time zone');
select is(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'venue'->>'name', 'Loft', 'Linked venue is included');
select is(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'attendance', '{"confirmed": 2, "firstTime": null, "repeat": null}'::jsonb, 'Members get the confirmed total only');
select ok(position('@' in public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')::text) = 0, 'No email address appears in a plan');
select ok(position('Guest' in public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')::text) = 0, 'No attendee name appears in a plan');
select is((public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e2')->'event'->>'archived')::boolean, true, 'Archived events remain readable as history');

-- Search
select is(
  (select jsonb_agg(e->>'title') from jsonb_array_elements(public.search_events('f7000000-0000-4000-8000-0000000000aa', 'founder dinner', 'past', null, 10)->'events') e),
  '["Spring founder dinner", "Winter founder dinner"]'::jsonb,
  'Search matches every word, newest first, including archived history'
);
select is(
  (select jsonb_agg(e->>'title') from jsonb_array_elements(public.search_events('f7000000-0000-4000-8000-0000000000aa', 'FOUNDER', 'upcoming', null, 10)->'events') e),
  '["Next founder dinner"]'::jsonb,
  'Upcoming search is case-insensitive and excludes the past'
);
select is(jsonb_array_length(public.search_events('f7000000-0000-4000-8000-0000000000aa', '', 'any', null, 2)->'events'), 2, 'Limit is applied');
select is(jsonb_array_length(public.search_events('f7000000-0000-4000-8000-0000000000aa', '', 'any', null, 500)->'events'), 4, 'Limit is capped, not rejected');
select is(
  (select jsonb_agg(e->>'title') from jsonb_array_elements(public.search_events('f7000000-0000-4000-8000-0000000000aa', '', 'past', 'f7000000-0000-4000-8000-0000000000d1', 10)->'events') e),
  '["Spring founder dinner"]'::jsonb,
  'Search can be narrowed to one venue'
);
select is(public.search_events('f7000000-0000-4000-8000-0000000000aa', 'spring', 'past', null, 10)->'events'->0->>'confirmedAttendance', '2', 'Search results carry confirmed totals');
select throws_ok($$select public.search_events('f7000000-0000-4000-8000-0000000000aa', '', 'someday', null, 10)$$, 'P0001', 'VALIDATION', 'Unknown time window is rejected');

-- Owner
select set_config('request.jwt.claim.sub', 'f7000000-0000-4000-8000-000000000001', true);
select is(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'attendance', '{"confirmed": 2, "firstTime": 1, "repeat": 1}'::jsonb, 'Owners also get first-time and repeat counts');
select public.start_event_booking('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')->'booking') k),
  array['currentStatus', 'currentStepTitle', 'nextDeadline', 'steps', 'venueName'],
  'A booking is summarized without internal IDs or versions'
);

-- Another workspace
select set_config('request.jwt.claim.sub', 'f7000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.get_event_plan('f7000000-0000-4000-8000-0000000000aa', 'f7000000-0000-4000-8000-0000000000e1')$$, 'P0001', 'UNAVAILABLE', 'Another workspace cannot read a plan');
select throws_ok($$select public.get_event_plan('f7000000-0000-4000-8000-0000000000bb', 'f7000000-0000-4000-8000-0000000000e1')$$, 'P0001', 'UNAVAILABLE', 'An event ID from another workspace is unavailable');
select is(
  (select jsonb_agg(e->>'title') from jsonb_array_elements(public.search_events('f7000000-0000-4000-8000-0000000000bb', 'founder', 'past', null, 10)->'events') e),
  '["Founder dinner elsewhere"]'::jsonb,
  'Search stays inside the caller''s workspace'
);

reset role;
select * from finish();
rollback;
