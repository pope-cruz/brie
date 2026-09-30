begin;
select plan(20);

insert into auth.users (id, email) values
  ('f4200000-0000-4000-8000-000000000001', 'export-owner@example.test'),
  ('f4200000-0000-4000-8000-000000000002', 'export-member@example.test'),
  ('f4200000-0000-4000-8000-000000000003', 'export-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
  ('f4200000-0000-4000-8000-0000000000aa', 'Export', 'UTC'),
  ('f4200000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-000000000001', 'owner', 'export-owner@example.test'),
  ('f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-000000000002', 'member', 'export-member@example.test'),
  ('f4200000-0000-4000-8000-0000000000bb', 'f4200000-0000-4000-8000-000000000003', 'owner', 'export-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
  ('f4200000-0000-4000-8000-0000000000e1', 'f4200000-0000-4000-8000-0000000000aa', 'First', '2026-01-01', '2026-01-01 01:00', 'UTC', 'f4200000-0000-4000-8000-000000000001'),
  ('f4200000-0000-4000-8000-0000000000e2', 'f4200000-0000-4000-8000-0000000000aa', 'Second', '2026-02-01', '2026-02-01 01:00', 'UTC', 'f4200000-0000-4000-8000-000000000001');
insert into public.attendees (id, workspace_id, email_normalized, display_name) values
  ('f4200000-0000-4000-8000-0000000000a1', 'f4200000-0000-4000-8000-0000000000aa', 'a@example.test', 'A'),
  ('f4200000-0000-4000-8000-0000000000a2', 'f4200000-0000-4000-8000-0000000000aa', 'b@example.test', 'B'),
  ('f4200000-0000-4000-8000-0000000000a3', 'f4200000-0000-4000-8000-0000000000aa', 'c@example.test', 'C');
insert into public.attendance_batches (id, workspace_id, event_id, created_by, file_label, file_hash, parser_version, outcome_counts, idempotency_key, preview_id) values
  ('f4200000-0000-4000-8000-0000000000b1', 'f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-0000000000e1', 'f4200000-0000-4000-8000-000000000001', 'first.csv', 'h1', 'test', '{}', 'k1', 'f4200000-0000-4000-8000-0000000000c1'),
  ('f4200000-0000-4000-8000-0000000000b2', 'f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-0000000000e1', 'f4200000-0000-4000-8000-000000000001', 'overlap.csv', 'h2', 'test', '{}', 'k2', 'f4200000-0000-4000-8000-0000000000c2'),
  ('f4200000-0000-4000-8000-0000000000b3', 'f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-0000000000e2', 'f4200000-0000-4000-8000-000000000001', 'second.csv', 'h3', 'test', '{}', 'k3', 'f4200000-0000-4000-8000-0000000000c3');
insert into public.attendance_contributions (workspace_id, event_id, batch_id, attendee_id, source_row_number) values
  ('f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-0000000000e1', 'f4200000-0000-4000-8000-0000000000b1', 'f4200000-0000-4000-8000-0000000000a1', 2),
  ('f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-0000000000e1', 'f4200000-0000-4000-8000-0000000000b1', 'f4200000-0000-4000-8000-0000000000a2', 3),
  ('f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-0000000000e1', 'f4200000-0000-4000-8000-0000000000b2', 'f4200000-0000-4000-8000-0000000000a2', 4),
  ('f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-0000000000e2', 'f4200000-0000-4000-8000-0000000000b3', 'f4200000-0000-4000-8000-0000000000a2', 2),
  ('f4200000-0000-4000-8000-0000000000aa', 'f4200000-0000-4000-8000-0000000000e2', 'f4200000-0000-4000-8000-0000000000b3', 'f4200000-0000-4000-8000-0000000000a3', 3);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.begin_workspace_attendance_export('f4200000-0000-4000-8000-0000000000aa', array['email'], '{}')$$, 'P0001', 'FORBIDDEN', 'Member cannot start an export');
select set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.begin_workspace_attendance_export('f4200000-0000-4000-8000-0000000000aa', array['email'], '{}')$$, 'P0001', 'UNAVAILABLE', 'Other workspace cannot start an export');
select set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.begin_workspace_attendance_export('f4200000-0000-4000-8000-0000000000aa', '{}', '{}')$$, 'P0001', 'VALIDATION', 'At least one field must be selected');
select throws_ok($$select public.begin_workspace_attendance_export('f4200000-0000-4000-8000-0000000000aa', array['phone'], '{}')$$, 'P0001', 'VALIDATION', 'Fields outside the fixed list are denied');
select set_config('test.export_one', public.begin_workspace_attendance_export('f4200000-0000-4000-8000-0000000000aa', array['email', 'eventsAttended'], '{}')->>'id', true);
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, null, 1)->'rows'->0->>'email', 'a@example.test', 'First page starts with first attendee ID');
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, 'f4200000-0000-4000-8000-0000000000a1', 1)->'rows'->0->>'email', 'b@example.test', 'Second page has next attendee without a gap');
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, 'f4200000-0000-4000-8000-0000000000a2', 1)->'rows'->0->>'email', 'c@example.test', 'Third page has final attendee exactly once');
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, 'f4200000-0000-4000-8000-0000000000a3', 1)->>'count', '0', 'No extra page rows');
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, 'f4200000-0000-4000-8000-0000000000a1', 1)->'rows'->0->>'eventsAttended', '2', 'Overlapping batches count one event');
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, null, 1)->'rows'->0 ? 'name', false, 'Unselected fields are absent from response');
select throws_ok($$select public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, null, 1001)$$, 'P0001', 'VALIDATION', 'Page limit is capped at 1000');
select set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, null, 1)$$, 'P0001', 'FORBIDDEN', 'Member cannot fetch export pages');
reset role;
select is((select count(*)::text from public.audit_entries where action = 'export_workspace_attendance' and workspace_id = 'f4200000-0000-4000-8000-0000000000aa'), '1', 'Several pages create one audit entry');
select is((select safe_metadata->'fields'->>0 from public.audit_entries where entity_id = current_setting('test.export_one')::uuid), 'email', 'Audit stores selected fields');
update public.attendance_batches set reverted_at = now() where id = 'f4200000-0000-4000-8000-0000000000b1';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4200000-0000-4000-8000-000000000001', true);
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, null, 1000)->>'count', '2', 'Reversion removes attendee with no active event');
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_one')::uuid, null, 1000)->'rows'->0->>'eventsAttended', '2', 'Overlapping active evidence preserves event count');
select set_config('test.export_filtered', public.begin_workspace_attendance_export('f4200000-0000-4000-8000-0000000000aa', array['sources', 'eventTitles'], '{"attendedEventId":"f4200000-0000-4000-8000-0000000000e1"}')->>'id', true);
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_filtered')::uuid, null, 1000)->>'count', '1', 'Group filter follows active event attendance');
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_filtered')::uuid, null, 1000)->'rows'->0->'sources'->0->>'fileLabel', 'overlap.csv', 'Sources exclude reverted files');
select is(public.export_workspace_attendance('f4200000-0000-4000-8000-0000000000aa', current_setting('test.export_filtered')::uuid, null, 1000)->'rows'->0->'sources'->0->>'rowNumber', '4', 'Sources retain file row number');
reset role;
select is((select safe_metadata->'filters'->>'attendedEventId' from public.audit_entries where entity_id = current_setting('test.export_filtered')::uuid), 'f4200000-0000-4000-8000-0000000000e1', 'Audit records filter choice without rows');

select * from finish();
rollback;
