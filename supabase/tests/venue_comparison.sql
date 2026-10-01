begin;
select plan(14);

insert into auth.users (id, email) values
  ('f6000000-0000-4000-8000-000000000001', 'compare-owner@example.test'),
  ('f6000000-0000-4000-8000-000000000002', 'compare-member@example.test'),
  ('f6000000-0000-4000-8000-000000000003', 'compare-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
  ('f6000000-0000-4000-8000-0000000000aa', 'Compare', 'UTC'),
  ('f6000000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f6000000-0000-4000-8000-0000000000aa', 'f6000000-0000-4000-8000-000000000001', 'owner', 'compare-owner@example.test'),
  ('f6000000-0000-4000-8000-0000000000aa', 'f6000000-0000-4000-8000-000000000002', 'member', 'compare-member@example.test'),
  ('f6000000-0000-4000-8000-0000000000bb', 'f6000000-0000-4000-8000-000000000003', 'owner', 'compare-outsider@example.test');
insert into public.venues (id, workspace_id, name, venue_type, capacity, lead_time_days, created_by, removed_at) values
  ('f6000000-0000-4000-8000-0000000000d1', 'f6000000-0000-4000-8000-0000000000aa', 'Atrium', 'nyu_room', 80, 10, 'f6000000-0000-4000-8000-000000000001', null),
  ('f6000000-0000-4000-8000-0000000000d2', 'f6000000-0000-4000-8000-0000000000aa', 'Back room', 'outside', 20, 40, 'f6000000-0000-4000-8000-000000000001', null),
  ('f6000000-0000-4000-8000-0000000000d3', 'f6000000-0000-4000-8000-0000000000aa', 'Closed hall', 'outside', 300, 0, 'f6000000-0000-4000-8000-000000000001', now());
-- e1: the event being planned, 30 days out. e2 overlaps it at Atrium; e3 is the
-- same day but later; e4 overlaps but is archived; e5 overlaps but is canceled.
-- e6 and e7 are past uses of Atrium; e7 was canceled and does not count.
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, venue_id, status, archived_at, created_by) values
  ('f6000000-0000-4000-8000-0000000000e1', 'f6000000-0000-4000-8000-0000000000aa', 'Planned', date_trunc('day', now()) + interval '30 days 18 hours', date_trunc('day', now()) + interval '30 days 21 hours', 'UTC', null, 'planned', null, 'f6000000-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-0000000000e2', 'f6000000-0000-4000-8000-0000000000aa', 'Overlapping', date_trunc('day', now()) + interval '30 days 20 hours', date_trunc('day', now()) + interval '30 days 23 hours', 'UTC', 'f6000000-0000-4000-8000-0000000000d1', 'planned', null, 'f6000000-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-0000000000e3', 'f6000000-0000-4000-8000-0000000000aa', 'Later that night', date_trunc('day', now()) + interval '30 days 21 hours', date_trunc('day', now()) + interval '30 days 22 hours', 'UTC', 'f6000000-0000-4000-8000-0000000000d1', 'planned', null, 'f6000000-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-0000000000e4', 'f6000000-0000-4000-8000-0000000000aa', 'Archived overlap', date_trunc('day', now()) + interval '30 days 19 hours', date_trunc('day', now()) + interval '30 days 20 hours', 'UTC', 'f6000000-0000-4000-8000-0000000000d1', 'planned', now(), 'f6000000-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-0000000000e5', 'f6000000-0000-4000-8000-0000000000aa', 'Canceled overlap', date_trunc('day', now()) + interval '30 days 19 hours', date_trunc('day', now()) + interval '30 days 20 hours', 'UTC', 'f6000000-0000-4000-8000-0000000000d1', 'canceled', null, 'f6000000-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-0000000000e6', 'f6000000-0000-4000-8000-0000000000aa', 'Last spring', now() - interval '40 days', now() - interval '40 days' + interval '2 hours', 'UTC', 'f6000000-0000-4000-8000-0000000000d1', 'completed', null, 'f6000000-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-0000000000e7', 'f6000000-0000-4000-8000-0000000000aa', 'Called off', now() - interval '10 days', now() - interval '10 days' + interval '2 hours', 'UTC', 'f6000000-0000-4000-8000-0000000000d1', 'canceled', null, 'f6000000-0000-4000-8000-000000000001'),
  ('f6000000-0000-4000-8000-0000000000f1', 'f6000000-0000-4000-8000-0000000000bb', 'Other workspace', now() + interval '5 days', now() + interval '6 days', 'UTC', null, 'planned', null, 'f6000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, null)), 2, 'Member compares active venues only');
select is(jsonb_array_length(public.compare_venues('f6000000-0000-4000-8000-0000000000aa', true, null)), 3, 'Archived venues are included on request');
select is(public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, null)->0->'fit', 'null'::jsonb, 'Without an event there is no fit');
select is((public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, null)->0->'usage'->>'pastEventCount')::int, 1, 'Past use excludes future and canceled events');
select is((public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, null)->0->'usage'->>'largestAttendance')::int, 0, 'Largest attendance comes from confirmed attendance');
select is((public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, null)->1->'usage'->>'pastEventCount')::int, 0, 'An unused venue has no past events');

select is(
  (select jsonb_agg(c->>'title' order by c->>'title') from jsonb_array_elements(public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, 'f6000000-0000-4000-8000-0000000000e1')->0->'fit'->'conflicts') c),
  '["Overlapping"]'::jsonb,
  'Only active, overlapping events at the venue conflict'
);
select is(public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, 'f6000000-0000-4000-8000-0000000000e1')->0->'fit'->>'requestBy', (current_date + 20)::text, 'Request-by date is the event day minus lead time');
select is((public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, 'f6000000-0000-4000-8000-0000000000e1')->0->'fit'->>'requestByPassed')::boolean, false, 'A future request-by date has not passed');
select is((public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, 'f6000000-0000-4000-8000-0000000000e1')->1->'fit'->>'requestByPassed')::boolean, true, 'A lead time longer than the time left has passed');
select is(jsonb_array_length(public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, 'f6000000-0000-4000-8000-0000000000e2')->0->'fit'->'conflicts'), 1, 'An event does not conflict with itself');
select throws_ok($$select public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, 'f6000000-0000-4000-8000-0000000000f1')$$, 'P0001', 'UNAVAILABLE', 'Another workspace''s event cannot be used');

select set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, null)$$, 'P0001', 'UNAVAILABLE', 'Another workspace cannot compare venues');

reset role;
set local role anon;
select throws_ok($$select public.compare_venues('f6000000-0000-4000-8000-0000000000aa', false, null)$$, '42501', null, 'Signed-out visitors cannot call compare_venues');

reset role;
select * from finish();
rollback;
