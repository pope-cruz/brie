begin;
select plan(13);

insert into auth.users (id, email) values
  ('f5000000-0000-4000-8000-000000000001', 'venue-owner@example.test'),
  ('f5000000-0000-4000-8000-000000000002', 'venue-member@example.test'),
  ('f5000000-0000-4000-8000-000000000003', 'venue-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
  ('f5000000-0000-4000-8000-0000000000aa', 'Venue', 'UTC'),
  ('f5000000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-000000000001', 'owner', 'venue-owner@example.test'),
  ('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-000000000002', 'member', 'venue-member@example.test'),
  ('f5000000-0000-4000-8000-0000000000bb', 'f5000000-0000-4000-8000-000000000003', 'owner', 'venue-outsider@example.test');
insert into public.events (id, workspace_id, title, location, starts_at, ends_at, timezone, created_by) values
  ('f5000000-0000-4000-8000-0000000000e1', 'f5000000-0000-4000-8000-0000000000aa', 'Past event', 'Original typed location', now() - interval '2 days', now() - interval '1 day', 'UTC', 'f5000000-0000-4000-8000-000000000001'),
  ('f5000000-0000-4000-8000-0000000000e2', 'f5000000-0000-4000-8000-0000000000aa', 'Future event', 'Keep this too', now() + interval '2 days', now() + interval '3 days', 'UTC', 'f5000000-0000-4000-8000-000000000001');
insert into public.venues (id, workspace_id, name, venue_type, capacity, address, lead_time_days, created_by) values
  ('f5000000-0000-4000-8000-0000000000d1', 'f5000000-0000-4000-8000-0000000000aa', 'Room A', 'nyu_room', 50, 'Campus', 14, 'f5000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f5000000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.list_venues('f5000000-0000-4000-8000-0000000000aa', false)), 1, 'Member can read venue directory');
select throws_ok($$select public.save_venue(p_workspace_id => 'f5000000-0000-4000-8000-0000000000aa', p_venue_id => null, p_name => 'Another', p_venue_type => 'outside', p_capacity => 10, p_address => '', p_cost_notes => '', p_accessibility => '', p_equipment => '', p_booking_contact => '', p_booking_link => '', p_lead_time_days => 0, p_restrictions => '', p_notes => '', p_expected_version => null)$$, 'P0001', 'FORBIDDEN', 'Member cannot create a venue');
select throws_ok($$select public.archive_venue('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-0000000000d1', 1)$$, 'P0001', 'FORBIDDEN', 'Member cannot archive a venue');
select set_config('request.jwt.claim.sub', 'f5000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.list_venues('f5000000-0000-4000-8000-0000000000aa', false)$$, 'P0001', 'UNAVAILABLE', 'Another workspace cannot read venues');
select set_config('request.jwt.claim.sub', 'f5000000-0000-4000-8000-000000000001', true);
select is(public.set_event_venue('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-0000000000e1', 'f5000000-0000-4000-8000-0000000000d1', 1)->>'version', '2', 'Organizer links venue with event version');
select is(public.get_event('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-0000000000e1')->>'location', 'Original typed location', 'Linking venue preserves typed location');
select is(jsonb_array_length(public.get_venue('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-0000000000d1')->'pastEvents'), 1, 'Venue detail lists past linked events');
select throws_ok($$select public.set_event_venue('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-0000000000e1', null, 1)$$, 'P0001', 'CONFLICT', 'Stale event venue update is rejected');
select is(public.archive_venue('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-0000000000d1', 1)->>'version', '2', 'Venue archives with a version bump');
select throws_ok($$select public.set_event_venue('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-0000000000e2', 'f5000000-0000-4000-8000-0000000000d1', 1)$$, 'P0001', 'VALIDATION', 'Archived venue cannot be newly linked');
select is(public.get_event_venue('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-0000000000e1')->>'venueName', 'Room A', 'Existing event link survives archive');
select is(public.restore_venue('f5000000-0000-4000-8000-0000000000aa', 'f5000000-0000-4000-8000-0000000000d1', 2)->>'version', '3', 'Venue restores with a version bump');
select is(public.save_venue(p_workspace_id => 'f5000000-0000-4000-8000-0000000000aa', p_venue_id => 'f5000000-0000-4000-8000-0000000000d1', p_name => 'Room B', p_venue_type => 'nyu_room', p_capacity => 40, p_address => 'Campus', p_cost_notes => '', p_accessibility => '', p_equipment => '', p_booking_contact => '', p_booking_link => '', p_lead_time_days => 14, p_restrictions => '', p_notes => '', p_expected_version => 3)->>'version', '4', 'Venue edits use version checks');

reset role;
select * from finish();
rollback;
