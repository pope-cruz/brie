-- Kept original rows for mixed imports (PR 6, 0031_mixed_attendance_kept_rows.sql).
-- Opt-in per import; owner/organizer read and delete; deleted after 180 days, on
-- revert, or on request; operator purge and per-email erasure only.
begin;
select plan(32);

insert into auth.users (id, email) values
 ('e6000000-0000-4000-8000-000000000001', 'kept-owner@example.test'),
 ('e6000000-0000-4000-8000-000000000002', 'kept-organizer@example.test'),
 ('e6000000-0000-4000-8000-000000000004', 'kept-member@example.test'),
 ('e6000000-0000-4000-8000-000000000009', 'kept-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
 ('e6000000-0000-4000-8000-0000000000aa', 'Kept rows test', 'UTC'),
 ('e6000000-0000-4000-8000-0000000000bb', 'Other workspace', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
 ('e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-000000000001', 'owner', 'kept-owner@example.test'),
 ('e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-000000000002', 'organizer', 'kept-organizer@example.test'),
 ('e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-000000000004', 'member', 'kept-member@example.test'),
 ('e6000000-0000-4000-8000-0000000000bb', 'e6000000-0000-4000-8000-000000000009', 'owner', 'kept-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
 ('e6000000-0000-4000-8000-0000000000e1', 'e6000000-0000-4000-8000-0000000000aa', 'Kept night', now() - interval '2 hours', now() - interval '1 hour', 'UTC', 'e6000000-0000-4000-8000-000000000001'),
 ('e6000000-0000-4000-8000-0000000000e2', 'e6000000-0000-4000-8000-0000000000aa', 'Unkept night', now() - interval '2 hours', now() - interval '1 hour', 'UTC', 'e6000000-0000-4000-8000-000000000001');

-- tests/fixtures/mixed-attendance-luma.csv, with every original cell in "values".
select set_config('test.rows', (select jsonb_agg(r || jsonb_build_object('values',
    jsonb_build_array(r->>'name', r->>'email', r->>'phone', r->>'rsvp', r->>'attendance', r->>'created')) order by ord)
  from jsonb_array_elements('[
  {"rowNumber": 2, "email": "mira.okonkwo@example.test", "name": "Mira Okonkwo", "rsvp": "approved", "attendance": "2026-09-12 18:04:00", "phone": "+12125550148", "created": "2026-09-01 09:12:00"},
  {"rowNumber": 3, "email": "jules.navarro@example.test", "name": "Jules Navarro", "rsvp": "approved", "attendance": "", "phone": "+12125550172", "created": "2026-09-02 11:03:00"},
  {"rowNumber": 4, "email": "ren.sato@example.test", "name": "Ren Sato", "rsvp": "declined", "attendance": "", "phone": "+12125550190", "created": "2026-09-03 14:40:00"},
  {"rowNumber": 5, "email": "noor.elsayed@example.test", "name": "Noor El-Sayed", "rsvp": "", "attendance": "", "phone": "+12125550163", "created": "2026-09-04 08:15:00"},
  {"rowNumber": 6, "email": "guest.desk@example.test", "name": "", "rsvp": "approved", "attendance": "2026-09-12 18:10:00", "phone": "+12125550111", "created": "2026-09-05 16:22:00"},
  {"rowNumber": 7, "email": "mira.okonkwo@example.test", "name": "Mira Okonkwo", "rsvp": "approved", "attendance": "2026-09-12 18:04:00", "phone": "+12125550148", "created": "2026-09-01 09:12:00"},
  {"rowNumber": 8, "email": "sasha.quinn@example.test", "name": "Sasha Quinn", "rsvp": "approved", "attendance": "2026-09-12 18:22:00", "phone": "+12125550184", "created": "2026-09-06 10:01:00"},
  {"rowNumber": 9, "email": "", "name": "Sasha Quinn", "rsvp": "approved", "attendance": "2026-09-12 18:30:00", "phone": "+12125550188", "created": "2026-09-06 10:05:00"}
  ]'::jsonb) with ordinality as x(r, ord))::text, true);
select set_config('test.map', '{"rsvp": {"values": {"approved": "yes", "declined": "no"}}, "attendance": {"otherNonBlank": "attended"}}', true);
select set_config('test.keep', '{"emailIndex": 1, "keepSource": true, "headers": ["name", "email", "phone_number", "approval_status", "checked_in_at", "created_at"]}', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
select set_config('test.kept', public.prepare_mixed_attendance_import(
  'e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e1', 'luma-guests.csv', 'hash-kept', 'brie-csv-1',
  current_setting('test.keep')::jsonb, current_setting('test.map')::jsonb, current_setting('test.rows')::jsonb, 0)::text, true);
select set_config('test.unkept', public.prepare_mixed_attendance_import(
  'e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e2', 'luma-guests.csv', 'hash-kept', 'brie-csv-1',
  '{"emailIndex": 1, "headers": ["name"]}', current_setting('test.map')::jsonb, current_setting('test.rows')::jsonb, 0)::text, true);
reset role;

select is(current_setting('test.kept')::jsonb->>'keepSource', 'true', 'A preview made with keepSource says rows will be kept');
select is((select count(*)::integer from public.import_preview_rows
    where preview_id = (current_setting('test.unkept')::jsonb->>'id')::uuid and raw_values is not null), 0,
  'Without keepSource, sent values are not staged');
select is((select mapping from public.import_previews where id = (current_setting('test.kept')::jsonb->>'id')::uuid) ? 'headers', false,
  'Headers are stored on the preview, not in its mapping');

set local role authenticated;
select throws_ok($$select public.prepare_mixed_attendance_import('e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e1', 'x.csv', 'x', 'brie-csv-1', '{"keepSource": true}', '{}', '[{"rowNumber": 2, "email": "a@example.test", "values": ["a@example.test"]}]', 0)$$,
  'P0001', 'VALIDATION', 'Keeping rows requires the original headers');
select throws_ok($$select public.prepare_mixed_attendance_import('e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e1', 'x.csv', 'x', 'brie-csv-1', '{"keepSource": true, "headers": ["email"]}', '{}', '[{"rowNumber": 2, "email": "a@example.test"}]', 0)$$,
  'P0001', 'VALIDATION', 'Keeping rows requires every row''s values');
select throws_ok($$select public.prepare_mixed_attendance_import('e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e1', 'x.csv', 'x', 'brie-csv-1', '{"keepSource": true, "headers": ["email"]}', '{}', '[{"rowNumber": 2, "email": "a@example.test", "values": [1]}]', 0)$$,
  'P0001', 'VALIDATION', 'Kept cells must be text');
select throws_ok(format($$select public.prepare_mixed_attendance_import('e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e1', 'x.csv', 'x', 'brie-csv-1', '{"keepSource": true, "headers": ["email"]}', '{}', '[{"rowNumber": 2, "email": "a@example.test", "values": [%s]}]', 0)$$,
    (select string_agg('"x"', ',') from generate_series(1, 201)))::text,
  'P0001', 'VALIDATION', 'A row with more than 200 cells cannot be kept');
select throws_ok(format($$select public.prepare_mixed_attendance_import('e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e1', 'x.csv', 'x', 'brie-csv-1', '{"keepSource": true, "headers": ["email"]}', '{}', '[{"rowNumber": 2, "email": "a@example.test", "values": ["%s"]}]', 0)$$,
    repeat('x', 2001))::text,
  'P0001', 'VALIDATION', 'A cell longer than 2,000 characters cannot be kept');

select set_config('test.receipt', public.commit_attendance_import((current_setting('test.kept')::jsonb->>'id')::uuid, true, 'kept-key')::text, true);
select set_config('test.batch', current_setting('test.receipt')::jsonb->>'id', true);
select is(current_setting('test.receipt')::jsonb->>'sourceRowCount', '8', 'The receipt says all eight rows are kept');
select ok((current_setting('test.receipt')::jsonb->>'sourceDeleteAfter')::timestamptz between now() + interval '179 days' and now() + interval '181 days',
  'Kept rows are deleted 180 days after the import');
select is(public.get_import_source('e6000000-0000-4000-8000-0000000000aa', current_setting('test.batch')::uuid)->'headers',
  current_setting('test.keep')::jsonb->'headers', 'The organizer can read the original headers');
select is(public.get_import_source('e6000000-0000-4000-8000-0000000000aa', current_setting('test.batch')::uuid)->'rows'->7,
  '["Sasha Quinn", "", "+12125550188", "approved", "2026-09-12 18:30:00", "2026-09-06 10:05:00"]'::jsonb,
  'Every row is kept in file order, including the row without an email');
select is(jsonb_array_length(public.get_import_source('e6000000-0000-4000-8000-0000000000aa', current_setting('test.batch')::uuid)->'rows'), 8,
  'Rows that did not count are kept too');
select is(public.get_event('e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e1')->>'attendanceCount', '3',
  'Keeping rows does not change what counts');
select is(public.commit_attendance_import((current_setting('test.unkept')::jsonb->>'id')::uuid, true, 'unkept-key')->>'sourceRowCount', null,
  'An import without keepSource keeps no rows');
reset role;
select is((select source_headers from public.import_previews where id = (current_setting('test.kept')::jsonb->>'id')::uuid), null,
  'Committing clears the preview''s copy of the headers');
select is((select count(*)::integer from public.import_sources where event_id = 'e6000000-0000-4000-8000-0000000000e2'), 0,
  'No kept rows exist for the import without keepSource');

-- Access.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.get_import_source('e6000000-0000-4000-8000-0000000000aa', current_setting('test.batch')::uuid)$$,
  'P0001', 'FORBIDDEN', 'A member cannot read kept rows');
select throws_ok($$select public.delete_import_source('e6000000-0000-4000-8000-0000000000aa', current_setting('test.batch')::uuid)$$,
  'P0001', 'FORBIDDEN', 'A member cannot delete kept rows');
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000009', true);
select throws_ok($$select public.get_import_source('e6000000-0000-4000-8000-0000000000aa', current_setting('test.batch')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'Another workspace cannot read kept rows');
select throws_ok($$select public.get_import_source('e6000000-0000-4000-8000-0000000000bb', current_setting('test.batch')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'Another workspace cannot read kept rows through its own workspace ID');
select throws_ok($$select * from public.import_source_rows$$, '42501', 'permission denied for table import_source_rows',
  'Kept rows cannot be read directly');
select throws_ok($$select public.erase_import_source_rows('e6000000-0000-4000-8000-0000000000aa', 'mira.okonkwo@example.test')$$,
  '42501', 'permission denied for function erase_import_source_rows', 'Erasure is an operator action, not callable from the app');
select throws_ok($$select public.purge_expired_import_sources()$$,
  '42501', 'permission denied for function purge_expired_import_sources', 'Purging is an operator action, not callable from the app');
reset role;

-- Operator erasure of one person's rows.
select is(public.erase_import_source_rows('e6000000-0000-4000-8000-0000000000aa', ' Mira.Okonkwo@example.test '), 2,
  'Erasure removes both of Mira''s kept rows');
select is((select count(*)::integer from public.import_source_rows where batch_id = current_setting('test.batch')::uuid), 6,
  'Other kept rows stay');

-- Expiry.
update public.import_sources set delete_after = now() - interval '1 second' where batch_id = current_setting('test.batch')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e6000000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.get_import_source('e6000000-0000-4000-8000-0000000000aa', current_setting('test.batch')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'Expired kept rows are hidden immediately');
reset role;
select is(public.purge_expired_import_sources(), 1, 'The operator purge deletes expired kept rows');
select is((select count(*)::integer from public.import_source_rows where batch_id = current_setting('test.batch')::uuid), 0,
  'Purging removes the rows with their import');

-- Deleting on request, and on revert.
set local role authenticated;
select set_config('test.again', public.prepare_mixed_attendance_import(
  'e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e2', 'luma-again.csv', 'hash-again', 'brie-csv-1',
  current_setting('test.keep')::jsonb, current_setting('test.map')::jsonb, current_setting('test.rows')::jsonb, 0)->>'id', true);
select set_config('test.again_batch', public.commit_attendance_import(current_setting('test.again')::uuid, true, 'again-key')->>'id', true);
select is(public.delete_import_source('e6000000-0000-4000-8000-0000000000aa', current_setting('test.again_batch')::uuid)->>'sourceRowCount', null,
  'An organizer can delete kept rows; the receipt stays');
select set_config('test.third', public.prepare_mixed_attendance_import(
  'e6000000-0000-4000-8000-0000000000aa', 'e6000000-0000-4000-8000-0000000000e2', 'luma-third.csv', 'hash-third', 'brie-csv-1',
  current_setting('test.keep')::jsonb, current_setting('test.map')::jsonb, current_setting('test.rows')::jsonb, 0)->>'id', true);
select set_config('test.third_batch', public.commit_attendance_import(current_setting('test.third')::uuid, true, 'third-key')->>'id', true);
select set_config('test.impact', public.preview_revert_import('e6000000-0000-4000-8000-0000000000aa', current_setting('test.third_batch')::uuid)::text, true);
select is(public.revert_attendance_import('e6000000-0000-4000-8000-0000000000aa', current_setting('test.third_batch')::uuid,
    (current_setting('test.impact')::jsonb->>'batchVersion')::integer, (current_setting('test.impact')::jsonb->>'attendanceVersion')::integer)->>'sourceRowCount', null,
  'Reverting an import deletes its kept rows');
reset role;
select is((select count(*)::integer from public.audit_entries
    where workspace_id = 'e6000000-0000-4000-8000-0000000000aa' and action = 'delete_import_source'), 1,
  'Deleting kept rows is audited');

select * from finish();
rollback;
