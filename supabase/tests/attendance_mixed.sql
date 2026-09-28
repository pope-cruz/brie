-- Mixed attendance imports (PRs 2-6).
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
begin;
select plan(83);

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
 ('e5000000-0000-4000-8000-0000000000e3', 'e5000000-0000-4000-8000-0000000000aa', 'Source night', now() - interval '2 hours', now() - interval '1 hour', 'UTC', 'e5000000-0000-4000-8000-000000000001'),
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

-- The Luma rows as the import screen sends them when the organizer keeps the original rows.
select set_config('test.luma_headers', '["name", "email", "phone_number", "approval_status", "checked_in_at", "created_at"]', true);
select set_config('test.luma_source_rows', '[
  {"rowNumber": 2, "email": "mira.okonkwo@example.test", "name": "Mira Okonkwo", "rsvp": "approved", "attendance": "2026-09-12 18:04:00", "timestamp": "2026-09-01 09:12:00", "phone": "+12125550148", "values": ["Mira Okonkwo", "mira.okonkwo@example.test", "+12125550148", "approved", "2026-09-12 18:04:00", "2026-09-01 09:12:00"]},
  {"rowNumber": 3, "email": "jules.navarro@example.test", "name": "Jules Navarro", "rsvp": "approved", "attendance": "", "timestamp": "2026-09-02 11:03:00", "phone": "+12125550172", "values": ["Jules Navarro", "jules.navarro@example.test", "+12125550172", "approved", "", "2026-09-02 11:03:00"]},
  {"rowNumber": 4, "email": "ren.sato@example.test", "name": "Ren Sato", "rsvp": "declined", "attendance": "", "timestamp": "2026-09-03 14:40:00", "phone": "+12125550190", "values": ["Ren Sato", "ren.sato@example.test", "+12125550190", "declined", "", "2026-09-03 14:40:00"]},
  {"rowNumber": 5, "email": "noor.elsayed@example.test", "name": "Noor El-Sayed", "rsvp": "", "attendance": "", "timestamp": "2026-09-04 08:15:00", "phone": "+12125550163", "values": ["Noor El-Sayed", "noor.elsayed@example.test", "+12125550163", "", "", "2026-09-04 08:15:00"]},
  {"rowNumber": 6, "email": "guest.desk@example.test", "name": "", "rsvp": "approved", "attendance": "2026-09-12 18:10:00", "timestamp": "2026-09-05 16:22:00", "phone": "+12125550111", "values": ["", "guest.desk@example.test", "+12125550111", "approved", "2026-09-12 18:10:00", "2026-09-05 16:22:00"]},
  {"rowNumber": 7, "email": "mira.okonkwo@example.test", "name": "Mira Okonkwo", "rsvp": "approved", "attendance": "2026-09-12 18:04:00", "timestamp": "2026-09-01 09:12:00", "phone": "+12125550148", "values": ["Mira Okonkwo", "mira.okonkwo@example.test", "+12125550148", "approved", "2026-09-12 18:04:00", "2026-09-01 09:12:00"]},
  {"rowNumber": 8, "email": "sasha.quinn@example.test", "name": "Sasha Quinn", "rsvp": "approved", "attendance": "2026-09-12 18:22:00", "timestamp": "2026-09-06 10:01:00", "phone": "+12125550184", "values": ["Sasha Quinn", "sasha.quinn@example.test", "+12125550184", "approved", "2026-09-12 18:22:00", "2026-09-06 10:01:00"]},
  {"rowNumber": 9, "email": "", "name": "Sasha Quinn", "rsvp": "approved", "attendance": "2026-09-12 18:30:00", "timestamp": "2026-09-06 10:05:00", "phone": "+12125550188", "values": ["Sasha Quinn", "", "+12125550188", "approved", "2026-09-12 18:30:00", "2026-09-06 10:05:00"]}
]', true);

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
  current_setting('test.luma_map')::jsonb, current_setting('test.luma_rows')::jsonb, 0, null)::text, true);
select set_config('test.google', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2',
  'form-responses.csv', 'hash-google', 'brie-csv-1',
  '{"emailIndex":1,"nameIndex":2,"rsvpIndex":3,"attendanceIndex":4}',
  current_setting('test.google_map')::jsonb, current_setting('test.google_rows')::jsonb, 0, null)::text, true);
select set_config('test.luma_id', current_setting('test.luma')::jsonb->>'id', true);
select set_config('test.google_id', current_setting('test.google')::jsonb->>'id', true);
-- The Luma file again with the attendance column left unmapped.
select set_config('test.luma_unmapped_id', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'luma-guests.csv', 'hash-luma', 'brie-csv-1', '{}',
  '{"rsvp": {"values": {"approved": "yes", "declined": "no"}}}',
  current_setting('test.luma_rows')::jsonb, 0, null)->>'id', true);
select set_config('test.luma_source', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'luma-guests.csv', 'hash-luma', 'brie-csv-1', '{}',
  current_setting('test.luma_map')::jsonb, current_setting('test.luma_source_rows')::jsonb, 0, null)::text, true);
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
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1', 'bad.csv', 'hash-bad', 'brie-csv-1', '{}', '{"attendance":{"values":{"here":"present"}}}', '[{"rowNumber":2,"email":"a@example.test","attendance":"here"}]', 0, null)$$,
  'P0001', 'VALIDATION', 'An attendance status outside attended/no_show/unknown is rejected');
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1', 'bad.csv', 'hash-bad', 'brie-csv-1', '{}', '{"attendance":{"values":{"Yes":"attended","yes ":"no_show"}}}', '[{"rowNumber":2,"email":"a@example.test","attendance":"Yes"}]', 0, null)$$,
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
    where a.workspace_id = 'e5000000-0000-4000-8000-0000000000aa' and a.email_normalized = 'mira.okonkwo@example.test'), array[2],
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
        'staged_preview_proposals', 'mixed_preview_to_json', 'purge_expired_import_sources',
        'prepare_mixed_attendance_import', 'get_import_preview', 'commit_attendance_import',
        'revert_attendance_import', 'get_import_source', 'erase_import_source')
      and has_function_privilege(grantee, p.oid, 'execute')
      and not (grantee = 'authenticated' and p.proname in (
        'prepare_mixed_attendance_import', 'get_import_preview', 'commit_attendance_import',
        'revert_attendance_import', 'get_import_source', 'erase_import_source'))
    order by 1),
  '{}'::text[], 'New and changed functions are revoked from public and anon; helpers from authenticated too');
select ok(has_function_privilege('authenticated',
    'public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer, jsonb)', 'execute'),
  'Signed-in users can call prepare_mixed_attendance_import (listed in function_privileges.sql)');
select ok(not has_table_privilege('authenticated', 'public.import_preview_rows', 'select')
    and not has_table_privilege('anon', 'public.import_preview_rows', 'select')
    and not has_table_privilege('authenticated', 'public.attendance_import_sources', 'select')
    and not has_table_privilege('authenticated', 'public.attendance_import_source_rows', 'select')
    and not has_table_privilege('anon', 'public.attendance_import_source_rows', 'select'),
  'Staged rows and kept original rows cannot be read directly');

-- PR 2. Unresolved rows and mixed preview detail stay inside the workspace and with organizers.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
select set_config('test.review_id', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2',
  'form-responses.csv', 'hash-google', 'brie-csv-1', '{}',
  current_setting('test.google_map')::jsonb, current_setting('test.google_rows')::jsonb, 0, null)->>'id', true);
select is((select x->>'outcome' from jsonb_array_elements(public.get_import_preview(current_setting('test.review_id')::uuid)->'rows') x
    where (x->>'rowNumber')::integer = 7), 'unresolved',
  'The organizer who made the preview can review its unresolved row');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000009', true);
select throws_ok($$select public.get_import_preview(current_setting('test.review_id')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'An organizer in another workspace cannot read unresolved rows or mixed preview detail');
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2', 'x.csv', 'hash-x', 'brie-csv-1', '{}', '{}', '[{"rowNumber":2,"email":"x@example.test"}]', 0, null)$$,
  'P0001', 'UNAVAILABLE', 'An organizer in another workspace cannot stage rows into this workspace');
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000bb', 'e5000000-0000-4000-8000-0000000000e2', 'x.csv', 'hash-x', 'brie-csv-1', '{}', '{}', '[{"rowNumber":2,"email":"x@example.test"}]', 0, null)$$,
  'P0001', 'UNAVAILABLE', 'Another workspace cannot stage rows against this workspace''s event ID');
select throws_ok($$select public.commit_attendance_import(current_setting('test.review_id')::uuid, true, 'outsider-mixed-key')$$,
  'P0001', 'UNAVAILABLE', 'An organizer in another workspace cannot commit a mixed preview');
select throws_ok($$select * from public.import_preview_rows$$, '42501', 'permission denied for table import_preview_rows',
  'Direct staged-row reads are denied');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e2', 'x.csv', 'hash-x', 'brie-csv-1', '{}', '{}', '[{"rowNumber":2,"email":"x@example.test"}]', 0, null)$$,
  'P0001', 'FORBIDDEN', 'A member cannot stage a mixed import');
select throws_ok($$select public.get_import_preview(current_setting('test.review_id')::uuid)$$,
  'P0001', 'FORBIDDEN', 'A member cannot read mixed preview detail');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.get_import_preview(current_setting('test.review_id')::uuid)$$,
  'P0001', 'FORBIDDEN', 'Another organizer cannot read a preview they did not make');
reset role;

-- PR 3. Optional context columns and an explicit "every row attended" choice.
select is((select concat_ws('/', r->>'timestamp', r->>'phone', r->>'attendance')
    from jsonb_array_elements(current_setting('test.luma_source')::jsonb->'rows') r where (r->>'rowNumber')::integer = 3),
  '2026-09-02 11:03:00/+12125550172/unknown',
  'Timestamp and phone are staged for review and do not set attendance (Jules Navarro)');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
select is(public.prepare_mixed_attendance_import(
    'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e3',
    'attendees.csv', 'hash-plain', 'brie-csv-1', '{}', '{"attendance": {"everyRow": "attended"}}',
    '[{"rowNumber":2,"email":"ana@example.test","name":"Ana"},{"rowNumber":3,"email":"","name":"No email"}]', 0, null)->'counts',
  '{"newAttendance":1,"alreadyRecorded":0,"duplicates":0,"invalid":0,"blank":0,"accepted":1,"notCounted":0,"unresolved":1}'::jsonb,
  'An organizer can say every row of a plain attendee list attended; a row without email stays unresolved');
select throws_ok($$select public.prepare_mixed_attendance_import('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e3', 'bad.csv', 'hash-bad', 'brie-csv-1', '{}', '{"attendance":{"everyRow":"attended","values":{"no":"no_show"}}}', '[{"rowNumber":2,"email":"a@example.test"}]', 0, null)$$,
  'P0001', 'VALIDATION', '"Every row attended" cannot be combined with per-value rules');

-- PR 4. Preview groups.
select is((select jsonb_object_agg(g.grp, g.emails) from (
    select r->>'group' as grp, jsonb_agg(coalesce(nullif(r->>'email', ''), 'row ' || (r->>'rowNumber')) order by (r->>'rowNumber')::integer) as emails
    from jsonb_array_elements(current_setting('test.luma')::jsonb->'rows') r group by 1) g),
  '{"will-count": ["mira.okonkwo@example.test", "guest.desk@example.test", "sasha.quinn@example.test"],
    "wont-count": ["jules.navarro@example.test", "ren.sato@example.test", "noor.elsayed@example.test"],
    "needs-review": ["row 9"], "duplicate": ["mira.okonkwo@example.test"]}'::jsonb,
  'Luma groups: three will count, three won''t, the email-less Sasha Quinn row needs review, the second Mira row is a duplicate');
select is((select jsonb_object_agg(g.grp, g.emails) from (
    select r->>'group' as grp, jsonb_agg(coalesce(nullif(r->>'email', ''), 'row ' || (r->>'rowNumber')) order by (r->>'rowNumber')::integer) as emails
    from jsonb_array_elements(current_setting('test.google')::jsonb->'rows') r group by 1) g),
  '{"will-count": ["priya.raman@example.test"],
    "wont-count": ["elio.marquez@example.test", "casey.adebayo@example.test", "rowan.kim@example.test",
      "samira.costa@example.test", "niall.berg@example.test", "quinn.ibarra@example.test"],
    "needs-review": ["row 7"], "duplicate": ["elio.marquez@example.test"]}'::jsonb,
  'Google groups: only Priya will count, six won''t, the email-less Quinn Ibarra row needs review, the second Elio row is a duplicate');

-- PR 5. Repeat import shows proposals and does not double-count or overwrite.
select set_config('test.repeat', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'luma-guests.csv', 'hash-luma', 'brie-csv-1', '{}',
  current_setting('test.luma_map')::jsonb, current_setting('test.luma_rows')::jsonb, 0, null)::text, true);
select is(current_setting('test.repeat')::jsonb->'proposals', '{"additions": [], "changes": []}'::jsonb,
  'Importing the Luma fixture again proposes no additions and no changes');
select is(current_setting('test.repeat')::jsonb->'counts'->>'accepted', '0',
  'The repeat of the same file would add no contribution');
select throws_ok($$select public.commit_attendance_import((current_setting('test.repeat')::jsonb->>'id')::uuid, true, 'mixed-repeat-key')$$,
  'P0001', 'VALIDATION', 'Committing the same file again is refused as having nothing new');
select is(public.get_event('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1')->>'attendanceCount', '3',
  'The Luma attendance count stays at 3');
select set_config('test.renamed', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
  'luma-guests-renamed.csv', 'hash-luma-renamed', 'brie-csv-1', '{}', current_setting('test.luma_map')::jsonb,
  jsonb_set(current_setting('test.luma_rows')::jsonb, '{0,name}', '"Mira O."'), 0, null)::text, true);
select is(current_setting('test.renamed')::jsonb->'proposals',
  '{"additions": [], "changes": [{"email": "mira.okonkwo@example.test", "field": "name", "from": "Mira Okonkwo", "to": "Mira O."}]}'::jsonb,
  'A repeat row renaming Mira Okonkwo to Mira O. is a proposed change');
select is(public.commit_attendance_import((current_setting('test.renamed')::jsonb->>'id')::uuid, true, 'mixed-renamed-key')->>'added', '0',
  'Recording the renamed file adds nobody new');
select is(public.get_event('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1')->>'attendanceCount', '3',
  'The count stays at 3 after the renamed file is recorded');
select is((select x->>'name' from jsonb_array_elements(public.export_event_attendance('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1')) x
    where x->>'email' = 'mira.okonkwo@example.test'), 'Mira Okonkwo',
  'The stored name is not overwritten');
select is(public.prepare_mixed_attendance_import(
    'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e1',
    'late-no-show.csv', 'hash-late', 'brie-csv-1', '{}', current_setting('test.google_map')::jsonb,
    '[{"rowNumber":2,"email":"guest.desk@example.test","name":"","rsvp":"Yes","attendance":"No"}]', 0, null)->'proposals'->'changes',
  '[{"email": "guest.desk@example.test", "field": "attendance", "from": "attended", "to": "no_show"}]'::jsonb,
  'A later no-show for someone recorded as attended is a proposed change, not applied');

-- PR 5. A failed commit rolls back contributions and unresolved rows together.
select set_config('test.failing', public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e3',
  'luma-guests.csv', 'hash-luma-e3', 'brie-csv-1', '{}', current_setting('test.luma_map')::jsonb,
  current_setting('test.luma_source_rows')::jsonb, 0, current_setting('test.luma_headers')::jsonb)->>'id', true);
reset role;
create function pg_temp.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'INJECTED_FAILURE'; end $$;
create trigger mixed_fail_audit before insert on public.audit_entries for each row execute function pg_temp.fail_audit();
set local role authenticated;
select throws_ok($$select public.commit_attendance_import(current_setting('test.failing')::uuid, true, 'mixed-failing-key')$$,
  'P0001', 'INJECTED_FAILURE', 'A late failure aborts the mixed commit');
reset role;
drop trigger mixed_fail_audit on public.audit_entries;
select is((select count(*)::integer from public.attendance_contributions where event_id = 'e5000000-0000-4000-8000-0000000000e3'), 0,
  'The failed commit left no contributions');
select is((select count(*)::integer from public.import_preview_rows
    where preview_id = current_setting('test.failing')::uuid and outcome = 'unresolved'), 1,
  'The failed commit left the unresolved row staged');
select is((select count(*)::integer from public.attendance_import_sources where event_id = 'e5000000-0000-4000-8000-0000000000e3'), 0,
  'The failed commit kept no original rows');

-- PR 6. Original rows are kept only on request, for 90 days, and only organizers can read or erase them.
set local role authenticated;
select set_config('test.kept', public.commit_attendance_import(current_setting('test.failing')::uuid, true, 'mixed-failing-key')::text, true);
select ok((current_setting('test.kept')::jsonb->>'sourceRetainedUntil')::timestamptz between now() + interval '89 days' and now() + interval '91 days',
  'The receipt says the original rows are kept for 90 days');
select set_config('test.kept_batch', current_setting('test.kept')::jsonb->>'id', true);
select is(public.get_import_source('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept_batch')::uuid)->'headers',
  '["name", "email", "phone_number", "approval_status", "checked_in_at", "created_at"]'::jsonb,
  'The original headers are kept');
select is((select r->'values' from jsonb_array_elements(public.get_import_source('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept_batch')::uuid)->'rows') r
    where (r->>'rowNumber')::integer = 9),
  '["Sasha Quinn", "", "+12125550188", "approved", "2026-09-12 18:30:00", "2026-09-06 10:05:00"]'::jsonb,
  'Every original row is kept, including the unresolved one');
select is(current_setting('test.luma')::jsonb->>'keepsSource', 'false', 'Nothing is kept unless the organizer asks');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.get_import_source('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept_batch')::uuid)$$,
  'P0001', 'FORBIDDEN', 'A member cannot read original rows');
select throws_ok($$select public.erase_import_source('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept_batch')::uuid)$$,
  'P0001', 'FORBIDDEN', 'A member cannot erase original rows');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000009', true);
select throws_ok($$select public.get_import_source('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept_batch')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'Another workspace cannot read original rows');
select throws_ok($$select public.get_import_source('e5000000-0000-4000-8000-0000000000bb', current_setting('test.kept_batch')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'Another workspace cannot read original rows through its own workspace ID');
select throws_ok($$select public.erase_import_source('e5000000-0000-4000-8000-0000000000bb', current_setting('test.kept_batch')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'Another workspace cannot erase original rows');
select throws_ok($$select * from public.attendance_import_source_rows$$, '42501', 'permission denied for table attendance_import_source_rows',
  'Direct reads of original rows are denied');
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000003', true);
select is(public.erase_import_source('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept_batch')::uuid)->>'sourceRetainedUntil', null,
  'Any organizer can erase the original rows now');
select throws_ok($$select public.get_import_source('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept_batch')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'Erased original rows cannot be read');
select is(public.get_event('e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e3')->>'attendanceCount', '3',
  'Erasing original rows leaves attendance unchanged');

-- Reverting erases kept rows; retention expiry hides and purges them.
select set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
select set_config('test.kept2', public.commit_attendance_import((public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e3',
  'second.csv', 'hash-second', 'brie-csv-1', '{}', '{"attendance": {"everyRow": "attended"}}',
  '[{"rowNumber":2,"email":"kept@example.test","name":"Kept","values":["Kept","kept@example.test"]}]', 0, '["name","email"]')->>'id')::uuid,
  true, 'mixed-kept2-key')->>'id', true);
select set_config('test.kept2_impact', public.preview_revert_import('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept2')::uuid)::text, true);
select public.revert_attendance_import('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept2')::uuid,
  (current_setting('test.kept2_impact')::jsonb->>'batchVersion')::int, (current_setting('test.kept2_impact')::jsonb->>'attendanceVersion')::int);
reset role;
select is((select count(*)::integer from public.attendance_import_source_rows where batch_id = current_setting('test.kept2')::uuid), 0,
  'Reverting a batch erases its original rows');
set local role authenticated;
select set_config('test.kept3', public.commit_attendance_import((public.prepare_mixed_attendance_import(
  'e5000000-0000-4000-8000-0000000000aa', 'e5000000-0000-4000-8000-0000000000e3',
  'third.csv', 'hash-third', 'brie-csv-1', '{}', '{"attendance": {"everyRow": "attended"}}',
  '[{"rowNumber":2,"email":"old@example.test","name":"Old","values":["Old","old@example.test"]}]', 0, '["name","email"]')->>'id')::uuid,
  true, 'mixed-kept3-key')->>'id', true);
reset role;
update public.attendance_import_sources set retained_until = now() - interval '1 minute'
where batch_id = current_setting('test.kept3')::uuid;
set local role authenticated;
select throws_ok($$select public.get_import_source('e5000000-0000-4000-8000-0000000000aa', current_setting('test.kept3')::uuid)$$,
  'P0001', 'UNAVAILABLE', 'Original rows past retention cannot be read');
reset role;
select is(public.purge_expired_import_sources(), 1, 'Expired original rows are purged');

select * from finish();
rollback;
