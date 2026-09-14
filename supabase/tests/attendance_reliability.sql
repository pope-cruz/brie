-- Preview classification and safe receipt recovery after timeout/expiry.
begin;
select plan(15);

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
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', true);
select set_config('test.mixed', public.prepare_attendance_import(
 'e4000000-0000-4000-8000-0000000000aa', 'e4000000-0000-4000-8000-0000000000e1',
 'mixed.csv', 'hash', 'brie-csv-1', '{}',
 '[{"rowNumber":2,"email":" Bo@Example.test ","name":"First Bo"},
   {"rowNumber":3,"email":"bad","name":"Invalid"},
   {"rowNumber":4,"email":"bo@example.test","name":"Later Bo"},
   {"rowNumber":5,"email":"ana@example.test","name":"Ana"}]', 2)::text, true);
select is(current_setting('test.mixed')::jsonb->'counts',
 '{"newAttendance":2,"alreadyRecorded":0,"duplicates":1,"invalid":1,"blank":2,"accepted":2}'::jsonb,
 'Set-based preview counts partition all input rows');
select is((select jsonb_agg(x->>'outcome') from jsonb_array_elements(current_setting('test.mixed')::jsonb->'rows') x),
 '["new","invalid","duplicate","new"]'::jsonb, 'Outcome order follows original input order');
select is(current_setting('test.mixed')::jsonb->'rows'->0->>'email', 'bo@example.test', 'Normalization precedes duplicate detection');
select set_config('test.preview', current_setting('test.mixed')::jsonb->>'id', true);
select set_config('test.receipt', public.commit_attendance_import(current_setting('test.preview')::uuid, true, 'reliable-commit-key')::text, true);
reset role;
select is((select display_name from public.attendees where email_normalized='bo@example.test'), 'First Bo', 'First valid name wins');
select is((select accepted_rows from public.import_previews where id=current_setting('test.preview')::uuid), '[]'::jsonb, 'Committed accepted payload is purged');
select is((select row_outcomes from public.import_previews where id=current_setting('test.preview')::uuid), '[]'::jsonb, 'Committed invalid-row details are purged');
update public.import_previews set expires_at=now()-interval '1 minute' where id=current_setting('test.preview')::uuid;
set local role authenticated;
select is(public.commit_attendance_import(current_setting('test.preview')::uuid, true, 'reliable-commit-key')->>'id',
 current_setting('test.receipt')::jsonb->>'id', 'Expired committed preview still recovers its receipt');
select public.archive_event('e4000000-0000-4000-8000-0000000000aa','e4000000-0000-4000-8000-0000000000e1',1);
select is(public.commit_attendance_import(current_setting('test.preview')::uuid, true, 'reliable-commit-key')->>'id',
 current_setting('test.receipt')::jsonb->>'id', 'Archived event still recovers an existing receipt');
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.commit_attendance_import(current_setting('test.preview')::uuid,true,'reliable-commit-key')$$,
 'P0001','FORBIDDEN','Member cannot recover organizer receipt');
reset role;
-- Exercise defensive receipt recovery when the preview row has been purged externally.
delete from public.import_previews where id=current_setting('test.preview')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000009', true);
select throws_ok($$select public.commit_attendance_import(current_setting('test.preview')::uuid,true,'reliable-commit-key')$$,
 'P0001','UNAVAILABLE','Missing preview cannot expose another workspace receipt');
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.commit_attendance_import(current_setting('test.preview')::uuid,true,'reliable-commit-key')$$,
 'P0001','FORBIDDEN','Missing preview still checks original creator');
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000002', true);
select is(public.commit_attendance_import(current_setting('test.preview')::uuid,true,'reliable-commit-key')->>'id',
 current_setting('test.receipt')::jsonb->>'id', 'Original creator recovers receipt without preview row');
select public.restore_event('e4000000-0000-4000-8000-0000000000aa','e4000000-0000-4000-8000-0000000000e1',2);
select set_config('test.repeat', public.prepare_attendance_import(
 'e4000000-0000-4000-8000-0000000000aa','e4000000-0000-4000-8000-0000000000e1',
 'repeat.csv','repeat','brie-csv-1','{}','[{"rowNumber":2,"email":"bo@example.test","name":"Changed Bo"}]',0)::text,true);
select is(current_setting('test.repeat')::jsonb->'rows'->0->>'name', 'First Bo', 'Overlapping preview keeps stored name');
select throws_ok($$select public.commit_attendance_import((current_setting('test.repeat')::jsonb->>'id')::uuid,false,'reliable-commit-key')$$,
 'P0001','VALIDATION','Request key cannot be reused for a different preview');
select set_config('test.invalid',public.prepare_attendance_import(
 'e4000000-0000-4000-8000-0000000000aa','e4000000-0000-4000-8000-0000000000e1',
 'invalid.csv','invalid','brie-csv-1','{}','[{"rowNumber":2,"email":"bad","name":"Invalid"}]',0)->>'id',true);
select throws_ok($$select public.commit_attendance_import(current_setting('test.invalid')::uuid,true,'all-invalid-key')$$,
 'P0001','VALIDATION','All-invalid preview has no accepted rows to commit');
reset role;
select * from finish();
rollback;
