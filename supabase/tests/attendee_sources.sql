begin;
select plan(10);

insert into auth.users (id, email) values
  ('f4100000-0000-4000-8000-000000000001', 'source-owner@example.test'),
  ('f4100000-0000-4000-8000-000000000002', 'source-member@example.test'),
  ('f4100000-0000-4000-8000-000000000003', 'source-outsider@example.test');
update public.profiles set display_name = 'Source Organizer' where user_id = 'f4100000-0000-4000-8000-000000000001';
insert into public.workspaces (id, name, timezone) values
  ('f4100000-0000-4000-8000-0000000000aa', 'Sources', 'UTC'),
  ('f4100000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-000000000001', 'owner', 'source-owner@example.test'),
  ('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-000000000002', 'member', 'source-member@example.test'),
  ('f4100000-0000-4000-8000-0000000000bb', 'f4100000-0000-4000-8000-000000000003', 'owner', 'source-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
  ('f4100000-0000-4000-8000-0000000000e1', 'f4100000-0000-4000-8000-0000000000aa', 'First', '2026-01-01', '2026-01-01 01:00', 'UTC', 'f4100000-0000-4000-8000-000000000001'),
  ('f4100000-0000-4000-8000-0000000000e2', 'f4100000-0000-4000-8000-0000000000aa', 'Second', '2026-02-01', '2026-02-01 01:00', 'UTC', 'f4100000-0000-4000-8000-000000000001');
insert into public.attendees (id, workspace_id, email_normalized, display_name) values
  ('f4100000-0000-4000-8000-0000000000a1', 'f4100000-0000-4000-8000-0000000000aa', 'person@example.test', 'Person');
insert into public.attendance_batches (id, workspace_id, event_id, created_by, committed_at, file_label, file_hash, parser_version, outcome_counts, idempotency_key, preview_id, reverted_at) values
  ('f4100000-0000-4000-8000-0000000000b1', 'f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000e1', 'f4100000-0000-4000-8000-000000000001', '2026-01-02', 'active.csv', 'h1', 'test', '{}', 'k1', 'f4100000-0000-4000-8000-0000000000c1', null),
  ('f4100000-0000-4000-8000-0000000000b2', 'f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000e1', 'f4100000-0000-4000-8000-000000000001', '2026-01-03', 'reverted.csv', 'h2', 'test', '{}', 'k2', 'f4100000-0000-4000-8000-0000000000c2', '2026-01-04'),
  ('f4100000-0000-4000-8000-0000000000b3', 'f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000e2', 'f4100000-0000-4000-8000-000000000001', '2026-02-02', 'later.csv', 'h3', 'test', '{}', 'k3', 'f4100000-0000-4000-8000-0000000000c3', '2026-02-03');
insert into public.attendance_contributions (workspace_id, event_id, batch_id, attendee_id, source_row_number) values
  ('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000e1', 'f4100000-0000-4000-8000-0000000000b1', 'f4100000-0000-4000-8000-0000000000a1', 2),
  ('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000e1', 'f4100000-0000-4000-8000-0000000000b2', 'f4100000-0000-4000-8000-0000000000a1', 7),
  ('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000e2', 'f4100000-0000-4000-8000-0000000000b3', 'f4100000-0000-4000-8000-0000000000a1', 4);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4100000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')$$, 'P0001', 'FORBIDDEN', 'Member cannot read source detail');
select set_config('request.jwt.claim.sub', 'f4100000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')$$, 'P0001', 'UNAVAILABLE', 'Other workspace cannot read source detail');
select set_config('request.jwt.claim.sub', 'f4100000-0000-4000-8000-000000000001', true);
select is(public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')->>'eventsAttended', '1', 'Only active event contributes to count');
select is(jsonb_array_length(public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')->'events'), 2, 'Reverted-only event remains visible');
select is(jsonb_array_length(public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')->'events'->1->'batches'), 2, 'Overlapping sources remain visible');
select is(public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')->'events'->1->'batches'->0->>'rowNumber', '7', 'Source row number is shown');
select is(public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')->'events'->1->'batches'->0->>'importedBy', 'Source Organizer', 'Importer is identified');
select is(public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')->'events'->1->'batches'->0->>'status', 'reverted', 'Reverted source is labeled');
reset role;
update public.attendance_batches set reverted_at = now() where id = 'f4100000-0000-4000-8000-0000000000b1';
set local role authenticated;
select is(public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')->>'eventsAttended', '0', 'Reverting final source changes active count');
select is(jsonb_array_length(public.get_attendee_detail('f4100000-0000-4000-8000-0000000000aa', 'f4100000-0000-4000-8000-0000000000a1')->'events'), 2, 'Historical sources remain after full reversion');

reset role;
select * from finish();
rollback;
