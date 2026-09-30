begin;
select plan(15);

insert into auth.users (id, email) values
  ('f5100000-0000-4000-8000-000000000001', 'booking-owner@example.test'),
  ('f5100000-0000-4000-8000-000000000002', 'booking-member@example.test'),
  ('f5100000-0000-4000-8000-000000000003', 'booking-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
  ('f5100000-0000-4000-8000-0000000000aa', 'Booking', 'UTC'),
  ('f5100000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-000000000001', 'owner', 'booking-owner@example.test'),
  ('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-000000000002', 'member', 'booking-member@example.test'),
  ('f5100000-0000-4000-8000-0000000000bb', 'f5100000-0000-4000-8000-000000000003', 'owner', 'booking-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
  ('f5100000-0000-4000-8000-0000000000e1', 'f5100000-0000-4000-8000-0000000000aa', 'Dinner', '2026-12-01 18:00+00', '2026-12-01 21:00+00', 'UTC', 'f5100000-0000-4000-8000-000000000001');
insert into public.venues (id, workspace_id, name, venue_type, lead_time_days, created_by) values
  ('f5100000-0000-4000-8000-0000000000d1', 'f5100000-0000-4000-8000-0000000000aa', 'Hall', 'outside', 30, 'f5100000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.get_venue_booking_steps('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000d1')->'steps'), 4, 'Member can read default outside-venue steps');
select throws_ok($$select public.set_venue_booking_steps('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000d1', '[{"title":"Inquiry","offsetDays":0}]', 1)$$, 'P0001', 'FORBIDDEN', 'Member cannot configure steps');
select throws_ok($$select public.start_event_booking('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1')$$, 'P0001', 'FORBIDDEN', 'Member cannot start a booking');
select set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.get_event_booking('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1')$$, 'P0001', 'UNAVAILABLE', 'Other workspace cannot read booking');
select set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000001', true);
select is(public.set_venue_booking_steps('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000d1', '[{"title":"Inquiry","offsetDays":0},{"title":"Confirmed","offsetDays":20}]', 1)->>'version', '2', 'Organizer configures versioned venue steps');
select throws_ok($$select public.set_venue_booking_steps('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000d1', '[{"title":"Late","offsetDays":0}]', 1)$$, 'P0001', 'CONFLICT', 'Stale step configuration is rejected');
select public.set_event_venue('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1', 'f5100000-0000-4000-8000-0000000000d1', 1);
select set_config('test.booking_id', public.start_event_booking('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1')->>'id', true);
select is(jsonb_array_length(public.get_event_booking('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1')->'steps'), 2, 'Booking snapshots configured steps');
select is(public.get_event_booking('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1')->>'nextDeadline', '2026-11-01', 'First deadline uses venue lead time');
select is(public.get_event_booking('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1')->'steps'->1->>'deadline', '2026-11-21', 'Later deadline uses step offset');
reset role;
update public.venues set lead_time_days = 5 where id = 'f5100000-0000-4000-8000-0000000000d1';
set local role authenticated;
select is(public.get_event_booking('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1')->>'nextDeadline', '2026-11-01', 'Existing booking keeps its original lead time');
select set_config('test.first_step', public.get_event_booking('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1')->'steps'->0->>'id', true);
select is(public.set_booking_step_status('f5100000-0000-4000-8000-0000000000aa', current_setting('test.first_step')::uuid, 'complete', 1)->>'currentStepTitle', 'Confirmed', 'Current status advances after dated step completion');
select set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.set_booking_step_status('f5100000-0000-4000-8000-0000000000aa', current_setting('test.first_step')::uuid, 'blocked', 2)$$, 'P0001', 'FORBIDDEN', 'Member cannot change booking status');
select set_config('request.jwt.claim.sub', 'f5100000-0000-4000-8000-000000000001', true);
select is(public.archive_event_booking('f5100000-0000-4000-8000-0000000000aa', current_setting('test.booking_id')::uuid, 2)->>'version', '3', 'Booking archives with version bump');
select is(public.get_event_booking('f5100000-0000-4000-8000-0000000000aa', 'f5100000-0000-4000-8000-0000000000e1'), null, 'Archived booking is no longer current');
select is(public.restore_event_booking('f5100000-0000-4000-8000-0000000000aa', current_setting('test.booking_id')::uuid, 3)->>'version', '4', 'Booking can be restored');

reset role;
select * from finish();
rollback;
