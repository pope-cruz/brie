-- Attendance rules: privacy from members and other workspaces, overlapping imports, stale and expired previews, and reversion.
begin;
select plan(27);

insert into auth.users (id, email) values
 ('e4000000-0000-4000-8000-000000000001', 'att-owner@example.test'),
 ('e4000000-0000-4000-8000-000000000002', 'att-organizer@example.test'),
 ('e4000000-0000-4000-8000-000000000003', 'att-organizer-2@example.test'),
 ('e4000000-0000-4000-8000-000000000004', 'att-member@example.test'),
 ('e4000000-0000-4000-8000-000000000009', 'att-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
 ('e4000000-0000-4000-8000-0000000000aa', 'Attendance test', 'UTC'),
 ('e4000000-0000-4000-8000-0000000000bb', 'Other workspace', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
 ('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-000000000001', 'owner', 'att-owner@example.test'),
 ('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-000000000002', 'organizer', 'att-organizer@example.test'),
 ('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-000000000003', 'organizer', 'att-organizer-2@example.test'),
 ('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-000000000004', 'member', 'att-member@example.test'),
 ('e4000000-0000-4000-8000-0000000000bb', 'e4000000-0000-4000-8000-000000000009', 'owner', 'att-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, archived_at, created_by) values
 ('e4000000-0000-4000-8000-0000000000e1', 'e4000000-0000-4000-8000-0000000000aa', 'Welcome night', now() - interval '2 hours', now() - interval '1 hour', 'UTC', null, 'e4000000-0000-4000-8000-000000000001'),
 ('e4000000-0000-4000-8000-0000000000e2', 'e4000000-0000-4000-8000-0000000000aa', 'Archived night', now() - interval '2 days', now() - interval '47 hours', 'UTC', now(), 'e4000000-0000-4000-8000-000000000001');

set local role authenticated;

-- Members and other workspaces cannot see attendees.
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.prepare_attendance_import('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', 'a.csv', 'hash-member', 'brie-csv-1', '{}', '[{"rowNumber":2,"email":"ana@example.test","name":"Ana"}]', 0)$$, 'P0001', 'FORBIDDEN', 'Member cannot import attendance');
select throws_ok($$select public.list_event_people('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', '', 1)$$, 'P0001', 'FORBIDDEN', 'Member cannot see who attended an event');
select throws_ok($$select public.list_attendance_history('e4000000-0000-4000-8000-0000000000aa', '', null, null, 1)$$, 'P0001', 'FORBIDDEN', 'Member cannot open attendance history');
select throws_ok($$select public.list_event_imports('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1')$$, 'P0001', 'FORBIDDEN', 'Member cannot see import receipts');
select throws_ok($$select * from public.attendees$$, '42501', 'permission denied for table attendees', 'Direct attendee reads are denied');
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000009', true);
select throws_ok($$select public.list_event_people('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', '', 1)$$, 'P0001', 'UNAVAILABLE', 'Another workspace cannot see attendees');

-- Batch A (Ana, Bo). Only the organizer who made a preview can commit it, and retries return one receipt.
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', true);
select set_config('test.preview_a', public.prepare_attendance_import('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', 'batch-a.csv', 'hash-a', 'brie-csv-1', '{}', '[{"rowNumber":2,"email":"ana@example.test","name":"Ana"},{"rowNumber":3,"email":"bo@example.test","name":"Bo"}]', 0)->>'id', true);
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.commit_attendance_import(current_setting('test.preview_a')::uuid, false, 'other-organizer-key')$$, 'P0001', 'FORBIDDEN', 'Only the organizer who made a preview can commit it');
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', true);
select set_config('test.batch_a', public.commit_attendance_import(current_setting('test.preview_a')::uuid, false, 'commit-key-a')->>'id', true);
select is(public.commit_attendance_import(current_setting('test.preview_a')::uuid, false, 'commit-key-a')->>'id', current_setting('test.batch_a'), 'Retrying a commit returns the same receipt');
select is(public.get_event('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1')->>'attendanceCount', '2', 'Batch A records two people');

-- Batch B (Bo, Cy) overlaps batch A.
select set_config('test.preview_b', public.prepare_attendance_import('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', 'batch-b.csv', 'hash-b', 'brie-csv-1', '{}', '[{"rowNumber":2,"email":"bo@example.test","name":"Bo"},{"rowNumber":3,"email":"cy@example.test","name":"Cy"}]', 0)->>'id', true);
select set_config('test.batch_b', public.commit_attendance_import(current_setting('test.preview_b')::uuid, false, 'commit-key-b')->>'id', true);
select is(public.get_event('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1')->>'attendanceCount', '3', 'Overlapping batches count a shared person once');

-- A preview made before another import is stale.
select set_config('test.preview_c', public.prepare_attendance_import('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', 'batch-c.csv', 'hash-c', 'brie-csv-1', '{}', '[{"rowNumber":2,"email":"dan@example.test","name":"Dan"}]', 0)->>'id', true);
select set_config('test.preview_d', public.prepare_attendance_import('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', 'batch-d.csv', 'hash-d', 'brie-csv-1', '{}', '[{"rowNumber":2,"email":"eve@example.test","name":"Eve"}]', 0)->>'id', true);
select public.commit_attendance_import(current_setting('test.preview_d')::uuid, false, 'commit-key-d');
select throws_ok($$select public.commit_attendance_import(current_setting('test.preview_c')::uuid, false, 'commit-key-c')$$, 'P0001', 'CONFLICT', 'A preview made before another import is stale');
select is(public.get_event('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1')->>'attendanceCount', '4', 'The stale commit adds nobody');

-- Invalid rows must be acknowledged.
select set_config('test.preview_e', public.prepare_attendance_import('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', 'batch-e.csv', 'hash-e', 'brie-csv-1', '{}', '[{"rowNumber":2,"email":"fay@example.test","name":"Fay"},{"rowNumber":3,"email":"not-an-email","name":"Nobody"}]', 0)->>'id', true);
select is(public.get_import_preview(current_setting('test.preview_e')::uuid)->'counts'->>'invalid', '1', 'Preview counts the invalid row');
select throws_ok($$select public.commit_attendance_import(current_setting('test.preview_e')::uuid, false, 'commit-key-e')$$, 'P0001', 'VALIDATION', 'Invalid rows must be acknowledged before committing');
select is(public.commit_attendance_import(current_setting('test.preview_e')::uuid, true, 'commit-key-e')->>'added', '1', 'The acknowledged import records only the valid row');

-- Expired previews cannot be committed.
select set_config('test.preview_f', public.prepare_attendance_import('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', 'batch-f.csv', 'hash-f', 'brie-csv-1', '{}', '[{"rowNumber":2,"email":"gus@example.test","name":"Gus"}]', 0)->>'id', true);
reset role;
update public.import_previews set expires_at = now() - interval '1 minute' where id = current_setting('test.preview_f')::uuid;
set local role authenticated;
select throws_ok($$select public.commit_attendance_import(current_setting('test.preview_f')::uuid, false, 'commit-key-f')$$, 'P0001', 'PREVIEW_EXPIRED', 'An expired preview cannot be committed');

-- Reverting batch A removes Ana but keeps Bo, who batch B also recorded.
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.preview_revert_import('e4000000-0000-4000-8000-0000000000aa', current_setting('test.batch_a')::uuid)$$, 'P0001', 'FORBIDDEN', 'Member cannot revert imports');
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', true);
select set_config('test.impact_a', public.preview_revert_import('e4000000-0000-4000-8000-0000000000aa', current_setting('test.batch_a')::uuid)::text, true);
select is(current_setting('test.impact_a')::jsonb->>'disappear', '1', 'Reverting batch A removes one person');
select is(current_setting('test.impact_a')::jsonb->>'retained', '1', 'Reverting batch A keeps the person batch B also recorded');
select throws_ok($$select public.revert_attendance_import('e4000000-0000-4000-8000-0000000000aa', current_setting('test.batch_a')::uuid, (current_setting('test.impact_a')::jsonb->>'batchVersion')::int, (current_setting('test.impact_a')::jsonb->>'attendanceVersion')::int - 1)$$, 'P0001', 'CONFLICT', 'A revert based on an outdated impact preview conflicts');
select is(public.revert_attendance_import('e4000000-0000-4000-8000-0000000000aa', current_setting('test.batch_a')::uuid, (current_setting('test.impact_a')::jsonb->>'batchVersion')::int, (current_setting('test.impact_a')::jsonb->>'attendanceVersion')::int)->>'status', 'reverted', 'Batch A is reverted');
select is(public.list_event_people('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', '', 1)->>'total', '4', 'Bo, Cy, Eve, and Fay remain');
select is(public.list_event_people('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', 'ana', 1)->>'total', '0', 'Ana no longer appears at the event');
select is(public.revert_attendance_import('e4000000-0000-4000-8000-0000000000aa', current_setting('test.batch_a')::uuid, 1, 1)->>'status', 'reverted', 'Reverting again is a harmless no-op');

-- Archived events, size limits, and organizer history lookup.
select throws_ok($$select public.prepare_attendance_import('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e2', 'late.csv', 'hash-late', 'brie-csv-1', '{}', '[{"rowNumber":2,"email":"hal@example.test","name":"Hal"}]', 0)$$, 'P0001', 'FORBIDDEN', 'Archived events cannot receive attendance');
select throws_ok($$select public.prepare_attendance_import('e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1', 'big.csv', 'hash-big', 'brie-csv-1', '{}', (select jsonb_agg(jsonb_build_object('rowNumber', g + 1, 'email', 'person' || g || '@example.test')) from generate_series(1, 5001) g), 0)$$, 'P0001', 'LIMIT_EXCEEDED', 'Files over 5,000 rows are rejected');
select is(public.list_attendance_history('e4000000-0000-4000-8000-0000000000aa', 'bo', null, null, 1)->>'peopleCount', '1', 'Organizer can look up attendance history');

reset role;
select * from finish();
rollback;
