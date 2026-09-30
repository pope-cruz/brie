-- Mixed attendance imports: PR 2–5 checks.
-- Fixtures (the database cannot read these files during supabase test db, so the
-- rows are copied below with the organizer's source columns sent as rsvp/attendance):
--   tests/fixtures/mixed-attendance-luma.csv
--   tests/fixtures/mixed-attendance-google-form.csv
-- Unit coverage of the same rows: tests/unit/mixed-attendance.test.ts
--
-- Organizer map assumed below:
--   Luma approval_status: approved = rsvp yes, declined = rsvp no, blank = unknown.
--   Luma checked_in_at: any non-blank value means attended; blank means unknown.
--   Google "Will you attend?": Yes = rsvp yes, No = rsvp no, blank = unknown.
--   Google "Checked in at the door?": Yes = attended, No = no_show;
--     Maybe, blank, and any other value mean unknown.
-- RSVP never implies attendance. Identity stays normalized email.
-- A missing email is staged unresolved and is not merged by name or phone.
--
begin;
select plan(73);

insert into auth.users (id, email) values
 ('e5000000-0000-4000-8000-000000000001', 'mixed-owner@example.test'),
 ('e5000000-0000-4000-8000-000000000002', 'mixed-organizer@example.test'),
 ('e5000000-0000-4000-8000-000000000003', 'mixed-organizer-2@example.test'),
 ('e5000000-0000-4000-8000-000000000004', 'mixed-member@example.test'),
 ('e5000000-0000-4000-8000-000000000009', 'mixed-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
 ('e5000000-0000-4000-8000-0000000000aa', 'Mixed attendance test', 'UTC'),
 ('e5000000-0000-4000-8000-0000000000bb', 'Other workspace', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
 ('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-000000000001', 'owner', 'mixed-owner@example.test'),
 ('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-000000000002', 'organizer', 'mixed-organizer@example.test'),
 ('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-000000000003', 'organizer', 'mixed-organizer-2@example.test'),
 ('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-000000000004', 'member', 'mixed-member@example.test'),
 ('e5000000-0000-4000-8000-0000000000bb', 'e5000000-0000-4000-8000-000000000009', 'owner', 'mixed-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
 ('e5000000-0000-4000-8000-0000000000e1', 'e5000000-0000-4000-8000-0000000000aa', 'Luma night', now() - interval '2 hours', now() - interval '1 hour', 'UTC', 'e5000000-0000-4000-8000-000000000001'),
 ('e5000000-0000-4000-8000-0000000000e2', 'e5000000-0000-4000-8000-0000000000aa', 'Form night', now() - interval '2 hours', now() - interval '1 hour', 'UTC', 'e5000000-0000-4000-8000-000000000001'),
 ('e5000000-0000-4000-8000-0000000000e9', 'e5000000-0000-4000-8000-0000000000bb', 'Outsider night', now() - interval '2 hours', now() - interval '1 hour', 'UTC', 'e5000000-0000-4000-8000-000000000009');

select set_config('test.luma_rows', '[
  {"rowNumber": 2, "email": "mira.okonkwo@example.test", "name": "Mira Okonkwo", "rsvp": "approved", "attendance": "2026-09-12 18:04:00", "phone": "+12125550148"},
  {"rowNumber": 3, "email": "jules.navarro@example.test", "name": "Jules Navarro", "rsvp": "approved", "attendance": "", "phone": "+12125550172"},
  {"rowNumber": 4, "email": "ren.sato@example.test", "name": "Ren Sato", "rsvp": "declined", "attendance": "", "phone": "+12125550190"},
  {"rowNumber": 5, "email": "noor.elsayed@example.test", "name": "Noor El-Sayed", "rsvp": "", "attendance": "", "phone": "+12125550163"},
  {"rowNumber": 6, "email": "guest.desk@example.test", "name": "", "rsvp": "approved", "attendance": "2026-09-12 18:10:00", "phone": "+12125550111"},
  {"rowNumber": 7, "email": "mira.okonkwo@example.test", "name": "Mira Okonkwo", "rsvp": "approved", "attendance": "2026-09-12 18:04:00", "phone": "+12125550148"},
  {"rowNumber": 8, "email": "sasha.quinn@example.test", "name": "Sasha Quinn", "rsvp": "approved", "attendance": "2026-09-12 18:22:00", "phone": "+12125550184"},
  {"rowNumber": 9, "email": "", "name": "Sasha Quinn", "rsvp": "approved", "attendance": "2026-09-12 18:30:00", "phone": "+12125550188"}
]', true);
select set_config('test.luma_map', '{
  "rsvp": {"values": {"approved": "yes", "declined": "no"}},
  "attendance": {"otherNonBlank": "attended"}
}', true);
select set_config('test.google_rows', '[
  {"rowNumber": 2, "email": "priya.raman@example.test", "name": "Priya Raman", "rsvp": "Yes", "attendance": "Yes", "phone": "+12125550201"},
  {"rowNumber": 3, "email": "elio.marquez@example.test", "name": "Elio Marquez", "rsvp": "Yes", "attendance": "No", "phone": "+12125550218"},
  {"rowNumber": 4, "email": "casey.adebayo@example.test", "name": "Casey Adebayo", "rsvp": "No", "attendance": "", "phone": "+12125550225"},
  {"rowNumber": 5, "email": "rowan.kim@example.test", "name": "Rowan Kim", "rsvp": "Yes", "attendance": "", "phone": "+12125550233"},
  {"rowNumber": 6, "email": "elio.marquez@example.test", "name": "Elio Marquez", "rsvp": "Yes", "attendance": "No", "phone": "+12125550218"},
  {"rowNumber": 7, "email": "", "name": "Quinn Ibarra", "rsvp": "Yes", "attendance": "Yes", "phone": "+12125550240"},
  {"rowNumber": 8, "email": "samira.costa@example.test", "name": "Samira Costa", "rsvp": "", "attendance": "", "phone": "+12125550257"},
  {"rowNumber": 9, "email": "niall.berg@example.test", "name": "Niall Berg", "rsvp": "Yes", "attendance": "Maybe", "phone": "+12125550264"},
  {"rowNumber": 10, "email": "quinn.ibarra@example.test", "name": "Quinn Ibarra", "rsvp": "Yes", "attendance": "No", "phone": "+12125550271"}
]', true);
select set_config('test.google_map', '{
  "rsvp": {"values": {"Yes": "yes", "No": "no"}},
  "attendance": {"values": {"Yes": "attended", "No": "no_show"}}
}', true);

-- email/rsvp/attendance/outcome of one staged row, read as the table owner.
create function pg_temp.staged(p_preview text, p_row integer)
returns text
language sql
as $$
  select concat_ws('/', coalesce(email_normalized, '<none>'), rsvp_status, attendance_status, outcome)
  from public.import_preview_rows
  where preview_id = p_preview::uuid and source_row_number = p_row;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
select set_config('test.luma', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'luma-guests.csv', 'hash-luma', 'brie-csv-1',
  '{"emailIndex":1,"nameIndex":0,"rsvpIndex":3,"attendanceIndex":4}',
  current_setting('test.luma_map')::jsonb, current_setting('test.luma_rows')::jsonb, 0)::text, true);
select set_config('test.google', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2',
  'form-responses.csv', 'hash-google', 'brie-csv-1',
  '{"emailIndex":1,"nameIndex":2,"rsvpIndex":3,"attendanceIndex":4}',
  current_setting('test.google_map')::jsonb, current_setting('test.google_rows')::jsonb, 0)::text, true);
select set_config('test.luma_id', current_setting('test.luma')::jsonb->>'id', true);
select set_config('test.google_id', current_setting('test.google')::jsonb->>'id', true);
-- The Luma file again with the attendance column left unmapped.
select set_config('test.luma_unmapped_id', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'luma-guests.csv', 'hash-luma', 'brie-csv-1', '{}',
  '{"rsvp": {"values": {"approved": "yes", "declined": "no"}}}',
  current_setting('test.luma_rows')::jsonb, 0)->>'id', true);
reset role;

-- PR 2. Preview rows store RSVP and attendance separately.
select is(pg_temp.staged(current_setting('test.luma_id'), 2), 'mira.okonkwo@example.test/yes/attended/new',
  'Luma row 2 (Mira Okonkwo) is staged as rsvp yes and attendance attended');
select is(pg_temp.staged(current_setting('test.google_id'), 2), 'priya.raman@example.test/yes/attended/new',
  'Google row 2 (Priya Raman) is staged as rsvp yes and attendance attended');

-- PR 2. Blank check-in is unknown, not attended.
select is(pg_temp.staged(current_setting('test.luma_id'), 3), 'jules.navarro@example.test/yes/unknown/not_counted',
  'Luma row 3 (Jules Navarro): rsvp yes with a blank check-in is attendance unknown');
select is(pg_temp.staged(current_setting('test.google_id'), 5), 'rowan.kim@example.test/yes/unknown/not_counted',
  'Google row 5 (Rowan Kim): rsvp yes with a blank check-in is attendance unknown');

-- PR 2. RSVP no does not count as attended.
select is(pg_temp.staged(current_setting('test.luma_id'), 4), 'ren.sato@example.test/no/unknown/not_counted',
  'Luma row 4 (Ren Sato): declined is rsvp no and attendance unknown');
select is(pg_temp.staged(current_setting('test.google_id'), 4), 'casey.adebayo@example.test/no/unknown/not_counted',
  'Google row 4 (Casey Adebayo): rsvp no and attendance unknown');

-- PR 2. Explicit no-show is its own status (no contribution: checked after commit).
select is(pg_temp.staged(current_setting('test.google_id'), 3), 'elio.marquez@example.test/yes/no_show/not_counted',
  'Google row 3 (Elio Marquez): no-show is stored separately from rsvp yes');
select is(pg_temp.staged(current_setting('test.google_id'), 10), 'quinn.ibarra@example.test/yes/no_show/not_counted',
  'Google row 10 (Quinn Ibarra): no-show is stored separately from rsvp yes');

-- PR 2. Blank status is unknown.
select is(pg_temp.staged(current_setting('test.luma_id'), 5), 'noor.elsayed@example.test/unknown/unknown/not_counted',
  'Luma row 5 (Noor El-Sayed): blank statuses are rsvp unknown and attendance unknown');
select is(pg_temp.staged(current_setting('test.google_id'), 8), 'samira.costa@example.test/unknown/unknown/not_counted',
  'Google row 8 (Samira Costa): blank statuses are rsvp unknown and attendance unknown');

-- PR 2. Unrecognized and unmapped attendance values are unknown.
select is(pg_temp.staged(current_setting('test.google_id'), 9), 'niall.berg@example.test/yes/unknown/not_counted',
  'Google row 9 (Niall Berg): unrecognized attendance value Maybe is unknown');
select is((select attendance_source from public.import_preview_rows
    where preview_id = current_setting('test.google_id')::uuid and source_row_number = 9), 'Maybe',
  'The unrecognized source value is kept on the staged row for review');
select is(pg_temp.staged(current_setting('test.luma_unmapped_id'), 2), 'mira.okonkwo@example.test/yes/unknown/not_counted',
  'An unmapped attendance column stages a check-in timestamp as unknown');
select is((select count(*)::integer from public.import_preview_rows
    where preview_id = current_setting('test.luma_unmapped_id')::uuid and attendance_status <> 'unknown'), 0,
  'With attendance unmapped, no Luma row is attended or no-show');

-- PR 2. Missing email is unresolved and is not merged by name or phone.
select is(pg_temp.staged(current_setting('test.luma_id'), 9), '<none>/yes/attended/unresolved',
  'Luma row 9 (Sasha Quinn, no email) is unresolved even though it is checked in');
select is(pg_temp.staged(current_setting('test.luma_id'), 8), 'sasha.quinn@example.test/yes/attended/new',
  'Luma row 8 (sasha.quinn@example.test) is its own person, not merged with row 9 by name');
select is(pg_temp.staged(current_setting('test.google_id'), 7), '<none>/yes/attended/unresolved',
  'Google row 7 (Quinn Ibarra, no email) is unresolved');
select is((select display_name from public.import_preview_rows
    where preview_id = current_setting('test.google_id')::uuid and source_row_number = 7), 'Quinn Ibarra',
  'The unresolved row keeps its name for review');

-- PR 2. Duplicate email is one person.
select is(pg_temp.staged(current_setting('test.luma_id'), 7), 'mira.okonkwo@example.test/yes/attended/duplicate',
  'Luma row 7 repeats mira.okonkwo@example.test and is a duplicate');
select is(pg_temp.staged(current_setting('test.google_id'), 6), 'elio.marquez@example.test/yes/no_show/duplicate',
  'Google row 6 repeats elio.marquez@example.test and is a duplicate');

-- PR 3. Timestamp, phone, and affiliation are staged for review only.
select is((select concat_ws('/', phone_source, timestamp_source, affiliation_source) from public.import_preview_rows
    where preview_id = current_setting('test.luma_id')::uuid and source_row_number = 9), '+12125550188',
  'The email-less Luma row keeps its phone for review; unmapped context columns stay empty');
select is((select x->>'phone' from jsonb_array_elements(current_setting('test.luma')::jsonb->'rows') x
    where (x->>'rowNumber')::integer = 9), '+12125550188',
  'The preview response carries the phone of the row that needs review');
set local role authenticated;
select set_config('test.context_id', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'context.csv', 'hash-context', 'brie-csv-1', '{}',
  '{"attendance": {"otherNonBlank": "attended"}}',
  '[{"rowNumber": 2, "email": "sasha.quinn@example.test", "name": "Sasha Quinn", "attendance": "x", "phone": "+12125550184", "affiliation": "Lumen Lab", "timestamp": "2026-09-06 10:01:00"},
    {"rowNumber": 3, "email": "", "name": "Sasha Quinn", "attendance": "x", "phone": "+12125550184", "affiliation": "Lumen Lab", "timestamp": "2026-09-06 10:01:00"},
    {"rowNumber": 4, "email": "noor.elsayed@example.test", "name": "Noor El-Sayed", "phone": "+12125550163", "timestamp": "yes"}]', 0)->>'id', true);
reset role;
select is(array(select outcome || '/' || attendance_status from public.import_preview_rows
    where preview_id = current_setting('test.context_id')::uuid order by position),
  array['new/attended', 'unresolved/attended', 'not_counted/unknown'],
  'A matching phone, affiliation, or timestamp never resolves a row or sets attendance');
select is((select affiliation_source || ' ' || timestamp_source from public.import_preview_rows
    where preview_id = current_setting('test.context_id')::uuid and source_row_number = 2), 'Lumen Lab 2026-09-06 10:01:00',
  'Affiliation and timestamp are staged as source text');

select is(current_setting('test.luma')::jsonb->'counts',
  '{"newAttendance":3,"alreadyRecorded":0,"duplicates":1,"invalid":0,"blank":0,"accepted":3,"notCounted":3,"unresolved":1}'::jsonb,
  'Luma preview counts partition all eight rows; only three will count');
select is(current_setting('test.google')::jsonb->'counts',
  '{"newAttendance":1,"alreadyRecorded":0,"duplicates":1,"invalid":0,"blank":0,"accepted":1,"notCounted":6,"unresolved":1}'::jsonb,
  'Google preview counts partition all nine rows; only one will count');
select is(current_setting('test.google')::jsonb->'rows'->2->>'attendance', 'unknown',
  'Preview response carries each row''s attendance status (Casey Adebayo)');

-- Mapping validation: statuses must be known and a value cannot mean two things.
set local role authenticated;
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1', 'bad.csv', 'hash-bad', 'brie-csv-1', '{}', '{"attendance":{"values":{"here":"present"}}}', '[{"rowNumber":2,"email":"a@example.test","attendance":"here"}]', 0)$$,
  'P0001', 'VALIDATION', 'An attendance status outside attended/no_show/unknown is rejected');
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1', 'bad.csv', 'hash-bad', 'brie-csv-1', '{}', '{"attendance":{"values":{"Yes":"attended","yes ":"no_show"}}}', '[{"rowNumber":2,"email":"a@example.test","attendance":"Yes"}]', 0)$$,
  'P0001', 'VALIDATION', 'One source value mapped to two statuses is rejected');

-- PR 2. Only attendance attended creates contributions.
select throws_ok($$select public.commit_attendance_import(current_setting('test.luma_id')::uuid, false, 'mixed-luma-key')$$,
  'P0001', 'VALIDATION', 'Rows without an email must be acknowledged before committing');
select is(public.commit_attendance_import(current_setting('test.luma_id')::uuid, true, 'mixed-luma-key')->>'added', '3',
  'Committing the Luma preview records three people');
select is(public.commit_attendance_import(current_setting('test.google_id')::uuid, true, 'mixed-google-key')->>'skipped', '8',
  'The Google receipt reports the eight rows it left out');
select is(public.get_event('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1')->>'attendanceCount', '3',
  'Luma attendance count is 3');
select is((select jsonb_agg(x->>'email' order by x->>'email') from jsonb_array_elements(public.export_event_attendance('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1')) x),
  '["guest.desk@example.test","mira.okonkwo@example.test","sasha.quinn@example.test"]'::jsonb,
  'Luma attendees are mira.okonkwo, guest.desk, and sasha.quinn');
select is(public.get_event('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2')->>'attendanceCount', '1',
  'Google attendance count is 1');
select is((select jsonb_agg(x->>'email') from jsonb_array_elements(public.export_event_attendance('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2')) x),
  '["priya.raman@example.test"]'::jsonb, 'Google attendee is priya.raman only');
reset role;
select is((select array_agg(c.source_row_number order by c.source_row_number)
    from public.attendance_contributions c join public.attendees a on a.id = c.attendee_id
    where a.workspace_id = 'e5000000-0000-4000-8000-0000000000aa'
      and a.email_normalized = 'mira.okonkwo@example.test'), array[2],
  'The duplicate Mira row adds no second contribution');
select is((select count(*)::integer from public.attendees
    where workspace_id = 'e5000000-0000-4000-8000-0000000000aa'
      and email_normalized in ('elio.marquez@example.test', 'quinn.ibarra@example.test', 'jules.navarro@example.test',
        'ren.sato@example.test', 'noor.elsayed@example.test', 'casey.adebayo@example.test', 'rowan.kim@example.test',
        'samira.costa@example.test', 'niall.berg@example.test')), 0,
  'No-show, RSVP-only, blank, and unrecognized rows create no attendee or contribution');
select is((select array_agg(c.source_row_number) from public.attendance_contributions c
    join public.attendees a on a.id = c.attendee_id
    where a.workspace_id = 'e5000000-0000-4000-8000-0000000000aa' and a.display_name = 'Sasha Quinn'), array[8],
  'Only the emailed Sasha Quinn row contributes; the email-less row is not merged by name or phone');
select is((select count(*)::integer from public.import_preview_rows
    where preview_id in (current_setting('test.luma_id')::uuid, current_setting('test.google_id')::uuid)), 0,
  'Committing deletes the staged rows, including RSVP and unresolved detail');
set local role authenticated;
select throws_ok($$select public.commit_attendance_import(current_setting('test.luma_unmapped_id')::uuid, true, 'mixed-unmapped-key')$$,
  'P0001', 'VALIDATION', 'A mixed preview with nobody marked attended records nothing');

-- PR 2. New mixed-attendance functions follow the privilege allowlist.
reset role;
select is(array(
    select p.proname || ' ' || grantee
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['public', 'anon', 'authenticated']) grantee
    where n.nspname = 'public'
      and p.proname in ('normalize_status_rule', 'apply_status_rule', 'staged_preview_rows_json', 'receipt_to_json',
        'prepare_mixed_attendance_import', 'get_import_preview', 'commit_attendance_import')
      and has_function_privilege(grantee, p.oid, 'execute')
      and not (grantee = 'authenticated' and p.proname in (
        'prepare_mixed_attendance_import', 'get_import_preview', 'commit_attendance_import'))
    order by 1),
  '{}'::text[], 'New and changed functions are revoked from public and anon; helpers from authenticated too');
select ok(has_function_privilege('authenticated',
    'public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer)', 'execute'),
  'Signed-in users can call prepare_mixed_attendance_import (listed in function_privileges.sql)');
select ok(not has_table_privilege('authenticated', 'public.import_preview_rows', 'select')
    and not has_table_privilege('anon', 'public.import_preview_rows', 'select'),
  'Staged rows cannot be read directly');

-- PR 2. Unresolved rows and mixed preview detail stay inside the workspace and with organizers.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
select set_config('test.review_id', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2',
  'form-responses.csv', 'hash-google', 'brie-csv-1', '{}',
  current_setting('test.google_map')::jsonb, current_setting('test.google_rows')::jsonb, 0)->>'id', true);
select is((select x->>'outcome' from jsonb_array_elements(public.get_import_preview(current_setting('test.review_id')::uuid)->'rows') x
    where (x->>'rowNumber')::integer = 7), 'unresolved',
  'The organizer who made the preview can review its unresolved row');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000009', true);
select throws_ok($$select public.get_import_preview(current_setting('test.review_id')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'An organizer in another workspace cannot read unresolved rows or mixed preview detail');
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2', 'x.csv', 'hash-x', 'brie-csv-1', '{}', '{}', '[{"rowNumber":2,"email":"x@example.test"}]', 0)$$,
  'P0001', 'UNAVAILABLE', 'An organizer in another workspace cannot stage rows into this workspace');
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000bb', 'e5000000-0000-4000-8000-0000000000e2', 'x.csv', 'hash-x', 'brie-csv-1', '{}', '{}', '[{"rowNumber":2,"email":"x@example.test"}]', 0)$$,
  'P0001', 'UNAVAILABLE', 'Another workspace cannot stage rows against this workspace''s event ID');
select throws_ok($$select public.commit_attendance_import(current_setting('test.review_id')::uuid, true, 'outsider-mixed-key')$$,
  'P0001', 'UNAVAILABLE', 'An organizer in another workspace cannot commit a mixed preview');
select throws_ok($$select * from public.import_preview_rows$$, '42501', 'permission denied for table import_preview_rows',
  'Direct staged-row reads are denied');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2', 'x.csv', 'hash-x', 'brie-csv-1', '{}', '{}', '[{"rowNumber":2,"email":"x@example.test"}]', 0)$$,
  'P0001', 'FORBIDDEN', 'A member cannot stage a mixed import');
select throws_ok($$select public.get_import_preview(current_setting('test.review_id')::uuid)$$,
  'P0001', 'FORBIDDEN', 'A member cannot read mixed preview detail');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.get_import_preview(current_setting('test.review_id')::uuid)$$,
  'P0001', 'FORBIDDEN', 'Another organizer cannot read a preview they did not make');
reset role;

-- PR 4. Preview groups, from the preview responses made before commit.
create function pg_temp.groups(p_preview jsonb)
returns jsonb
language sql
as $$
  select jsonb_object_agg(g, people)
  from (
    select x->>'group' as g,
      jsonb_agg(coalesce(nullif(x->>'email', ''), 'no email: ' || (x->>'name')) order by (x->>'rowNumber')::integer) as people
    from jsonb_array_elements(p_preview->'rows') x
    group by 1
  ) s;
$$;
select is(pg_temp.groups(current_setting('test.luma')::jsonb), '{
    "will-count": ["mira.okonkwo@example.test", "guest.desk@example.test", "sasha.quinn@example.test"],
    "wont-count": ["jules.navarro@example.test", "ren.sato@example.test", "noor.elsayed@example.test"],
    "needs-review": ["no email: Sasha Quinn"],
    "duplicate": ["mira.okonkwo@example.test"]
  }'::jsonb,
  'PR 4: Luma groups will-count as mira.okonkwo@example.test, guest.desk@example.test, and sasha.quinn@example.test; wont-count as jules.navarro@example.test, ren.sato@example.test, and noor.elsayed@example.test; needs-review as the email-less Sasha Quinn row; the second Mira row is a duplicate');

select is(pg_temp.groups(current_setting('test.google')::jsonb), '{
    "will-count": ["priya.raman@example.test"],
    "wont-count": ["elio.marquez@example.test", "casey.adebayo@example.test", "rowan.kim@example.test",
      "samira.costa@example.test", "niall.berg@example.test", "quinn.ibarra@example.test"],
    "needs-review": ["no email: Quinn Ibarra"],
    "duplicate": ["elio.marquez@example.test"]
  }'::jsonb,
  'PR 4: Google groups will-count as priya.raman@example.test only; wont-count as elio.marquez@example.test, casey.adebayo@example.test, rowan.kim@example.test, samira.costa@example.test, niall.berg@example.test, and quinn.ibarra@example.test; needs-review as the email-less Quinn Ibarra row; the second Elio row is a duplicate');

select is((select count(*)::integer from jsonb_array_elements(current_setting('test.luma')::jsonb->'rows') x
    where x->>'group' = 'will-count' and x->>'attendance' <> 'attended'), 0,
  'PR 4: every will-count row is confirmed attended');

-- PR 5. Repeat imports show proposals and never double-count or overwrite.
select set_config('test.people_before', (select count(*) from public.attendees
  where workspace_id = 'e5000000-0000-4000-8000-0000000000aa')::text, true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
select set_config('test.repeat', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'luma-guests.csv', 'hash-luma', 'brie-csv-1', '{}',
  current_setting('test.luma_map')::jsonb, current_setting('test.luma_rows')::jsonb, 0)::text, true);
select is(current_setting('test.repeat')::jsonb->'counts'->>'newAttendance' || '/'
    || (current_setting('test.repeat')::jsonb->'counts'->>'alreadyRecorded'), '0/3',
  'PR 5: importing the Luma fixture again proposes no additions; its three attendees are already recorded');
select is((select count(*)::integer from jsonb_array_elements(current_setting('test.repeat')::jsonb->'rows') x
    where jsonb_array_length(x->'changes') > 0), 0,
  'PR 5: the same file proposes no changes');
select isnt(current_setting('test.repeat')::jsonb->>'existingReceiptId', null,
  'PR 5: the preview points out that an active import used this same file');
select is(public.commit_attendance_import((current_setting('test.repeat')::jsonb->>'id')::uuid, true, 'mixed-luma-repeat-key')->>'added', '0',
  'PR 5: recording the repeat adds nobody');
select is(public.get_event('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1')->>'attendanceCount', '3',
  'PR 5: importing the Luma fixture again proposes no additions, creates no second attendance, and leaves the attendance count at 3');
reset role;
select is((select count(*) from public.attendees where workspace_id = 'e5000000-0000-4000-8000-0000000000aa')::text,
  current_setting('test.people_before'), 'PR 5: the repeat creates no attendee');

set local role authenticated;
select set_config('test.rename', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'luma-renamed.csv', 'hash-luma-renamed', 'brie-csv-1', '{}',
  current_setting('test.luma_map')::jsonb,
  jsonb_set(current_setting('test.luma_rows')::jsonb, '{0,name}', '"Mira O."'), 0)::text, true);
select is((select x->'changes' from jsonb_array_elements(current_setting('test.rename')::jsonb->'rows') x
    where (x->>'rowNumber')::integer = 2),
  '[{"field": "name", "from": "Mira Okonkwo", "to": "Mira O."}]'::jsonb,
  'PR 5: a repeat row that renames Mira Okonkwo to Mira O. is reported as a proposed change');
select is((select x->>'name' from jsonb_array_elements(current_setting('test.rename')::jsonb->'rows') x
    where (x->>'rowNumber')::integer = 2), 'Mira Okonkwo',
  'PR 5: the preview shows the stored name the import will keep');
select is(public.commit_attendance_import((current_setting('test.rename')::jsonb->>'id')::uuid, true, 'mixed-luma-rename-key')->>'alreadyRecorded', '3',
  'PR 5: the renamed file records the same three people');
reset role;
select is((select display_name from public.attendees where workspace_id = 'e5000000-0000-4000-8000-0000000000aa'
    and email_normalized = 'mira.okonkwo@example.test'), 'Mira Okonkwo',
  'PR 5: a repeat row that renames Mira Okonkwo to Mira O. does not overwrite the stored name');

set local role authenticated;
select set_config('test.no_show', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'door-list.csv', 'hash-door', 'brie-csv-1', '{}',
  current_setting('test.google_map')::jsonb,
  '[{"rowNumber": 2, "email": "mira.okonkwo@example.test", "name": "Mira Okonkwo", "attendance": "No"},
    {"rowNumber": 3, "email": "jules.navarro@example.test", "name": "Jules Navarro", "attendance": "No"}]', 0)::text, true);
select is((select jsonb_agg(x->'changes' order by (x->>'rowNumber')::integer)
    from jsonb_array_elements(current_setting('test.no_show')::jsonb->'rows') x),
  '[[{"field": "attendance", "from": "attended", "to": "no_show"}], []]'::jsonb,
  'PR 5: a later no-show for someone recorded as attended is a proposed change; a new no-show is not');
select is(public.get_event('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1')->>'attendanceCount', '3',
  'PR 5: previewing that no-show leaves the recorded attendance in place');
reset role;

-- PR 5. A failure late in a mixed commit, after some contributions were written,
-- rolls back the batch, contributions, and revision, and keeps the staged rows.
create function pg_temp.fail_on_sasha()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.attendees a
    where a.id = new.attendee_id and a.email_normalized = 'sasha.quinn@example.test') then
    raise exception 'late failure';
  end if;
  return new;
end;
$$;
create trigger fail_on_sasha before insert on public.attendance_contributions
  for each row execute function pg_temp.fail_on_sasha();
set local role authenticated;
select set_config('test.rollback_id', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2',
  'luma-guests.csv', 'hash-luma', 'brie-csv-1', '{}',
  current_setting('test.luma_map')::jsonb, current_setting('test.luma_rows')::jsonb, 0)->>'id', true);
reset role;
select set_config('test.rollback_version', (select version from public.event_attendance_revisions
  where event_id = 'e5000000-0000-4000-8000-0000000000e2')::text, true);
set local role authenticated;
select throws_ok($$select public.commit_attendance_import(current_setting('test.rollback_id')::uuid, true, 'mixed-rollback-key')$$,
  'P0001', 'late failure', 'The commit fails after Mira and guest.desk were written and before Sasha');
reset role;
select is((select count(*)::integer from public.attendance_batches where preview_id = current_setting('test.rollback_id')::uuid)
    + (select count(*)::integer from public.attendance_contributions where event_id = 'e5000000-0000-4000-8000-0000000000e2'
      and batch_id not in (select id from public.attendance_batches where file_label = 'form-responses.csv')), 0,
  'PR 5: a failed commit of a mixed preview rolls back contributions and unresolved rows together (no batch, no contributions)');
select is((select version from public.event_attendance_revisions where event_id = 'e5000000-0000-4000-8000-0000000000e2')::text,
  current_setting('test.rollback_version'), 'The failed commit leaves the attendance revision unchanged');
select is((select count(*)::integer from public.import_preview_rows where preview_id = current_setting('test.rollback_id')::uuid
    and outcome = 'unresolved'), 1,
  'The staged rows, including the unresolved one, are still there to retry');
drop trigger fail_on_sasha on public.attendance_contributions;
set local role authenticated;
select is(public.commit_attendance_import(current_setting('test.rollback_id')::uuid, true, 'mixed-rollback-key')->>'added', '3',
  'Retrying the same commit after the failure records the three attendees once');
reset role;

select * from finish();
rollback;
