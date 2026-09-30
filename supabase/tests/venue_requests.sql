begin;
select plan(19);

insert into auth.users (id, email) values
  ('f5200000-0000-4000-8000-000000000001', 'request-owner@example.test'),
  ('f5200000-0000-4000-8000-000000000002', 'request-member@example.test'),
  ('f5200000-0000-4000-8000-000000000003', 'request-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
  ('f5200000-0000-4000-8000-0000000000aa', 'Requests', 'UTC'),
  ('f5200000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f5200000-0000-4000-8000-0000000000aa', 'f5200000-0000-4000-8000-000000000001', 'owner', 'request-owner@example.test'),
  ('f5200000-0000-4000-8000-0000000000aa', 'f5200000-0000-4000-8000-000000000002', 'member', 'request-member@example.test'),
  ('f5200000-0000-4000-8000-0000000000bb', 'f5200000-0000-4000-8000-000000000003', 'owner', 'request-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
  ('f5200000-0000-4000-8000-0000000000e1', 'f5200000-0000-4000-8000-0000000000aa', 'Campus dinner', '2026-12-01 18:00+00', '2026-12-01 21:00+00', 'UTC', 'f5200000-0000-4000-8000-000000000001'),
  ('f5200000-0000-4000-8000-0000000000e2', 'f5200000-0000-4000-8000-0000000000aa', 'Outside dinner', '2026-12-02 18:00+00', '2026-12-02 21:00+00', 'UTC', 'f5200000-0000-4000-8000-000000000001');
insert into public.venues (id, workspace_id, name, venue_type, lead_time_days, created_by) values
  ('f5200000-0000-4000-8000-0000000000d1', 'f5200000-0000-4000-8000-0000000000aa', 'NYU room', 'nyu_room', 30, 'f5200000-0000-4000-8000-000000000001'),
  ('f5200000-0000-4000-8000-0000000000d2', 'f5200000-0000-4000-8000-0000000000aa', 'Outside hall', 'outside', 30, 'f5200000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f5200000-0000-4000-8000-000000000001', true);
select public.set_event_venue('f5200000-0000-4000-8000-0000000000aa', 'f5200000-0000-4000-8000-0000000000e1', 'f5200000-0000-4000-8000-0000000000d1', 1);
select public.set_event_venue('f5200000-0000-4000-8000-0000000000aa', 'f5200000-0000-4000-8000-0000000000e2', 'f5200000-0000-4000-8000-0000000000d2', 1);
select set_config('test.nyu_booking', public.start_event_booking('f5200000-0000-4000-8000-0000000000aa', 'f5200000-0000-4000-8000-0000000000e1')->>'id', true);
select set_config('test.outside_booking', public.start_event_booking('f5200000-0000-4000-8000-0000000000aa', 'f5200000-0000-4000-8000-0000000000e2')->>'id', true);
select is(jsonb_array_length(public.get_booking_request_checks('f5200000-0000-4000-8000-0000000000aa', current_setting('test.nyu_booking')::uuid)), 0, 'NYU checklist begins unchecked');
select is(public.set_booking_request_check('f5200000-0000-4000-8000-0000000000aa', current_setting('test.nyu_booking')::uuid, 'event_details', true, null)->>'version', '1', 'Organizer checks a request item');
select isnt(public.get_booking_request_checks('f5200000-0000-4000-8000-0000000000aa', current_setting('test.nyu_booking')::uuid)->0->>'checkedAt', null, 'Checklist stores dated completion');
select throws_ok($$select public.set_booking_request_check('f5200000-0000-4000-8000-0000000000aa', current_setting('test.nyu_booking')::uuid, 'event_details', false, null)$$, 'P0001', 'CONFLICT', 'Checklist retry needs current version');
select is(public.set_booking_request_check('f5200000-0000-4000-8000-0000000000aa', current_setting('test.nyu_booking')::uuid, 'event_details', false, 1)->>'version', '2', 'Checklist can be unchecked with version');
select throws_ok($$select public.set_booking_request_check('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid, 'event_details', true, null)$$, 'P0001', 'VALIDATION', 'NYU checklist cannot be added to outside venue');
select is(public.save_booking_request_draft('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid, 'Editable draft for outside hall', 1)->>'version', '2', 'Organizer saves versioned email draft');
select throws_ok($$select public.save_booking_request_draft('f5200000-0000-4000-8000-0000000000aa', current_setting('test.nyu_booking')::uuid, 'Wrong venue type', 1)$$, 'P0001', 'VALIDATION', 'Email draft cannot be saved for NYU room');
select is(public.get_booking_request_draft('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid)->>'draft', 'Editable draft for outside hall', 'Saved draft can be reopened');
select set_config('test.log_id', public.save_booking_log_entry('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid, null, 'quote', '2026-10-01 12:00+00', 'Quoted 200', null)->>'id', true);
select is(public.list_booking_log_entries('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid, false)->0->>'entryType', 'quote', 'Dated quote appears in booking log');
select is(public.archive_booking_log_entry('f5200000-0000-4000-8000-0000000000aa', current_setting('test.log_id')::uuid, 1)->>'version', '2', 'Log entry archives with version');
select is(jsonb_array_length(public.list_booking_log_entries('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid, false)), 0, 'Archived log entry leaves active list');
select is(public.restore_booking_log_entry('f5200000-0000-4000-8000-0000000000aa', current_setting('test.log_id')::uuid, 2)->>'version', '3', 'Log entry can be restored');
select set_config('request.jwt.claim.sub', 'f5200000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.list_booking_log_entries('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid, false)), 1, 'Member can read log');
select throws_ok($$select public.save_booking_request_draft('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid, 'No', 2)$$, 'P0001', 'FORBIDDEN', 'Member cannot save draft');
select throws_ok($$select public.set_booking_request_check('f5200000-0000-4000-8000-0000000000aa', current_setting('test.nyu_booking')::uuid, 'attendance', true, null)$$, 'P0001', 'FORBIDDEN', 'Member cannot check request item');
select throws_ok($$select public.save_booking_log_entry('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid, null, 'reply', now(), 'No', null)$$, 'P0001', 'FORBIDDEN', 'Member cannot log reply');
select set_config('request.jwt.claim.sub', 'f5200000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.list_booking_log_entries('f5200000-0000-4000-8000-0000000000aa', current_setting('test.outside_booking')::uuid, false)$$, 'P0001', 'UNAVAILABLE', 'Other workspace cannot read log');
reset role;
select is((select safe_metadata ? 'draft' from public.audit_entries where action = 'save_booking_request_draft' and entity_id = current_setting('test.outside_booking')::uuid), false, 'Audit excludes draft content');

select * from finish();
rollback;
