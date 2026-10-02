begin;
select plan(22);

insert into auth.users (id, email) values
  ('f6400000-0000-4000-8000-000000000001', 'files-owner@example.test'),
  ('f6400000-0000-4000-8000-000000000002', 'files-member@example.test'),
  ('f6400000-0000-4000-8000-000000000003', 'files-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
  ('f6400000-0000-4000-8000-0000000000aa', 'Files', 'UTC'),
  ('f6400000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-000000000001', 'owner', 'files-owner@example.test'),
  ('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-000000000002', 'member', 'files-member@example.test'),
  ('f6400000-0000-4000-8000-0000000000bb', 'f6400000-0000-4000-8000-000000000003', 'owner', 'files-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by, archived_at) values
  ('f6400000-0000-4000-8000-0000000000e1', 'f6400000-0000-4000-8000-0000000000aa', 'Screening', now() + interval '2 days', now() + interval '3 days', 'UTC', 'f6400000-0000-4000-8000-000000000001', null),
  ('f6400000-0000-4000-8000-0000000000e2', 'f6400000-0000-4000-8000-0000000000aa', 'Old mixer', now() - interval '3 days', now() - interval '2 days', 'UTC', 'f6400000-0000-4000-8000-000000000001', now());
-- An uploaded object, as Storage would record it.
insert into storage.objects (bucket_id, name, metadata) values
  ('event-files', 'f6400000-0000-4000-8000-0000000000aa/f6400000-0000-4000-8000-0000000000e1/f6400000-0000-4000-8000-0000000000f1/Partnership-agreement.pdf',
   '{"size": 245760, "mimetype": "application/pdf"}');

select is((select public from storage.buckets where id = 'event-files'), false, 'The event-files bucket is private');

set local role authenticated;

-- Owner adds a link and a file.
select set_config('request.jwt.claim.sub', 'f6400000-0000-4000-8000-000000000001', true);
select is(public.add_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1',
  'f6400000-0000-4000-8000-0000000000f0', 'link', 'Screening slides', 'https://www.figma.com/deck/abc/Screening-slides', null)->>'kind',
  'link', 'Organizer adds a link');
select is(public.add_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1',
  'f6400000-0000-4000-8000-0000000000f0', 'link', 'Screening slides', 'https://www.figma.com/deck/abc/Screening-slides', null)->>'version',
  '1', 'Retrying an add with the same id returns the same record');
select throws_ok($$select public.add_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1',
  gen_random_uuid(), 'link', 'Bad', 'javascript:alert(1)', null)$$, 'P0001', 'VALIDATION', 'Only web links are accepted');
select is((public.add_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1',
  'f6400000-0000-4000-8000-0000000000f1', 'file', 'Partnership agreement.pdf', null,
  'f6400000-0000-4000-8000-0000000000aa/f6400000-0000-4000-8000-0000000000e1/f6400000-0000-4000-8000-0000000000f1/Partnership-agreement.pdf')->>'sizeBytes')::bigint,
  245760::bigint, 'A file records the stored object''s size, not a browser claim');
select throws_ok($$select public.add_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1',
  'f6400000-0000-4000-8000-0000000000f2', 'file', 'Missing.pdf', null,
  'f6400000-0000-4000-8000-0000000000aa/f6400000-0000-4000-8000-0000000000e1/f6400000-0000-4000-8000-0000000000f2/Missing.pdf')$$,
  'P0001', 'VALIDATION', 'A file must be uploaded before it is recorded');
select throws_ok($$select public.add_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1',
  'f6400000-0000-4000-8000-0000000000f3', 'file', 'Elsewhere.pdf', null,
  'f6400000-0000-4000-8000-0000000000bb/f6400000-0000-4000-8000-0000000000e1/f6400000-0000-4000-8000-0000000000f3/Elsewhere.pdf')$$,
  'P0001', 'VALIDATION', 'A file path must belong to this workspace, event, and id');
select throws_ok($$select public.add_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e2',
  gen_random_uuid(), 'link', 'Late', 'https://example.test', null)$$, 'P0001', 'FORBIDDEN', 'Archived events take no new attachments');
select ok(public.event_file_access('f6400000-0000-4000-8000-0000000000aa/f6400000-0000-4000-8000-0000000000e1/f6400000-0000-4000-8000-0000000000f9/order.png', true),
  'Organizer may upload under a fresh id');
select ok(not public.event_file_access('f6400000-0000-4000-8000-0000000000aa/f6400000-0000-4000-8000-0000000000e1/f6400000-0000-4000-8000-0000000000f1/again.pdf', true),
  'An id already recorded cannot be uploaded to again');
select ok(not public.event_file_access('f6400000-0000-4000-8000-0000000000aa/f6400000-0000-4000-8000-0000000000e2/f6400000-0000-4000-8000-0000000000f9/order.png', true),
  'Nothing uploads to an archived event');

-- A member reads but does not change.
select set_config('request.jwt.claim.sub', 'f6400000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.list_event_attachments('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1', false)), 2, 'Member sees the event''s files and links');
select ok(public.event_file_access('f6400000-0000-4000-8000-0000000000aa/f6400000-0000-4000-8000-0000000000e1/f6400000-0000-4000-8000-0000000000f1/Partnership-agreement.pdf', false),
  'Member may open a stored file');
select ok(not public.event_file_access('f6400000-0000-4000-8000-0000000000aa/f6400000-0000-4000-8000-0000000000e1/f6400000-0000-4000-8000-0000000000f8/x.pdf', true),
  'Member may not upload');
select throws_ok($$select public.add_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1',
  gen_random_uuid(), 'link', 'Mine', 'https://example.test', null)$$, 'P0001', 'FORBIDDEN', 'Member cannot add');
select throws_ok($$select public.remove_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000f0', 1)$$,
  'P0001', 'FORBIDDEN', 'Member cannot remove');

-- Another workspace sees nothing.
select set_config('request.jwt.claim.sub', 'f6400000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.list_event_attachments('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1', false)$$,
  'P0001', 'UNAVAILABLE', 'Another workspace cannot list attachments');
select ok(not public.event_file_access('f6400000-0000-4000-8000-0000000000aa/f6400000-0000-4000-8000-0000000000e1/f6400000-0000-4000-8000-0000000000f1/Partnership-agreement.pdf', false),
  'Another workspace cannot open a stored file');

-- Remove and restore, version-checked; removed items stay out of a member's list.
select set_config('request.jwt.claim.sub', 'f6400000-0000-4000-8000-000000000001', true);
select is(public.remove_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000f0', 1)->>'version', '2', 'Organizer removes with a version bump');
select throws_ok($$select public.restore_event_attachment('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000f0', 1)$$,
  'P0001', 'CONFLICT', 'A stale restore is rejected');
select is(jsonb_array_length(public.list_event_attachments('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1', true)), 2, 'Organizer can list removed items to restore them');
select set_config('request.jwt.claim.sub', 'f6400000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.list_event_attachments('f6400000-0000-4000-8000-0000000000aa', 'f6400000-0000-4000-8000-0000000000e1', true)), 1, 'Member never sees removed items');

reset role;
select * from finish();
rollback;
