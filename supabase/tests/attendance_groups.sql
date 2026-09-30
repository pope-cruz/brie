begin;
select plan(15);

insert into auth.users (id, email) values
  ('f4000000-0000-4000-8000-000000000001', 'groups-owner@example.test'),
  ('f4000000-0000-4000-8000-000000000002', 'groups-member@example.test'),
  ('f4000000-0000-4000-8000-000000000003', 'groups-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
  ('f4000000-0000-4000-8000-0000000000aa', 'Groups', 'UTC'),
  ('f4000000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-000000000001', 'owner', 'groups-owner@example.test'),
  ('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-000000000002', 'member', 'groups-member@example.test'),
  ('f4000000-0000-4000-8000-0000000000bb', 'f4000000-0000-4000-8000-000000000003', 'owner', 'groups-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by, archived_at) values
  ('f4000000-0000-4000-8000-0000000000e1', 'f4000000-0000-4000-8000-0000000000aa', 'First', '2026-01-01', '2026-01-01 01:00', 'UTC', 'f4000000-0000-4000-8000-000000000001', now()),
  ('f4000000-0000-4000-8000-0000000000e2', 'f4000000-0000-4000-8000-0000000000aa', 'Second', '2026-02-01', '2026-02-01 01:00', 'UTC', 'f4000000-0000-4000-8000-000000000001', null);
insert into public.attendees (id, workspace_id, email_normalized, display_name) values
  ('f4000000-0000-4000-8000-0000000000a1', 'f4000000-0000-4000-8000-0000000000aa', 'a@example.test', 'A'),
  ('f4000000-0000-4000-8000-0000000000a2', 'f4000000-0000-4000-8000-0000000000aa', 'b@example.test', 'B');
insert into public.attendance_batches (id, workspace_id, event_id, created_by, file_label, file_hash, parser_version, outcome_counts, idempotency_key, preview_id) values
  ('f4000000-0000-4000-8000-0000000000b1', 'f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e1', 'f4000000-0000-4000-8000-000000000001', 'one.csv', 'hash1', 'test', '{}', 'key1', 'f4000000-0000-4000-8000-0000000000c1'),
  ('f4000000-0000-4000-8000-0000000000b2', 'f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e1', 'f4000000-0000-4000-8000-000000000001', 'two.csv', 'hash2', 'test', '{}', 'key2', 'f4000000-0000-4000-8000-0000000000c2'),
  ('f4000000-0000-4000-8000-0000000000b3', 'f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e2', 'f4000000-0000-4000-8000-000000000001', 'three.csv', 'hash3', 'test', '{}', 'key3', 'f4000000-0000-4000-8000-0000000000c3');
insert into public.attendance_contributions (workspace_id, event_id, batch_id, attendee_id, source_row_number) values
  ('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e1', 'f4000000-0000-4000-8000-0000000000b1', 'f4000000-0000-4000-8000-0000000000a1', 2),
  ('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e1', 'f4000000-0000-4000-8000-0000000000b2', 'f4000000-0000-4000-8000-0000000000a1', 2),
  ('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e1', 'f4000000-0000-4000-8000-0000000000b1', 'f4000000-0000-4000-8000-0000000000a2', 3),
  ('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e2', 'f4000000-0000-4000-8000-0000000000b3', 'f4000000-0000-4000-8000-0000000000a2', 2);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.get_event_attendance_groups('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e1')$$, 'P0001', 'FORBIDDEN', 'Member cannot read groups');
select throws_ok($$select public.list_attendance_groups('f4000000-0000-4000-8000-0000000000aa', '', '{}', 1)$$, 'P0001', 'FORBIDDEN', 'Member cannot filter people');
select set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.list_event_attendance_groups('f4000000-0000-4000-8000-0000000000aa')$$, 'P0001', 'UNAVAILABLE', 'Other workspace is denied');
select set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000001', true);
select is(public.get_event_attendance_groups('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e1')->>'firstTime', '2', 'Overlapping batches count one person once');
select is(public.get_event_attendance_groups('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e2')->>'repeat', '1', 'Second event is repeat');
select is(public.list_attendance_groups('f4000000-0000-4000-8000-0000000000aa', '', '{"minEvents":2}', 1)->>'total', '1', 'Minimum events uses distinct events');
select is(public.list_attendance_groups('f4000000-0000-4000-8000-0000000000aa', '', '{"attendedEventId":"f4000000-0000-4000-8000-0000000000e2"}', 1)->>'total', '1', 'Attended event filter uses active evidence');
select is(public.list_attendance_groups('f4000000-0000-4000-8000-0000000000aa', '', '{"anyEventIds":["f4000000-0000-4000-8000-0000000000e1","f4000000-0000-4000-8000-0000000000e2"]}', 1)->>'total', '2', 'Any-event filter combines events');
select is(public.list_attendance_groups('f4000000-0000-4000-8000-0000000000aa', '', '{"notSeenSince":"2026-01-15"}', 1)->>'total', '1', 'Not seen since uses last active event');
select is(public.list_event_attendance_groups('f4000000-0000-4000-8000-0000000000aa')->0->>'eventId', 'f4000000-0000-4000-8000-0000000000e1', 'Event groups are ordered by event date');
select is(public.list_attendance_groups('f4000000-0000-4000-8000-0000000000aa', '', '{"firstEventId":"f4000000-0000-4000-8000-0000000000e1"}', 1)->>'total', '2', 'First event includes archived history');
select is(public.get_attendee_detail('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000a2')->>'eventsAttended', '2', 'Person detail agrees before reversion');
reset role;
update public.attendance_batches set reverted_at = now() where id = 'f4000000-0000-4000-8000-0000000000b1';
set local role authenticated;
select is(public.get_event_attendance_groups('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e1')->>'firstTime', '1', 'Reversion removes first-time status for B but retains A');
select is(public.get_event_attendance_groups('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000e2')->>'firstTime', '1', 'Next event becomes first-time');
select is(public.get_attendee_detail('f4000000-0000-4000-8000-0000000000aa', 'f4000000-0000-4000-8000-0000000000a2')->>'eventsAttended', '1', 'Person detail agrees after reversion');

reset role;
select * from finish();
rollback;
