begin;
select plan(37);

insert into auth.users (id, email) values
  ('f8000000-0000-4000-8000-000000000001', 'assist-owner@example.test'),
  ('f8000000-0000-4000-8000-000000000002', 'assist-organizer@example.test'),
  ('f8000000-0000-4000-8000-000000000003', 'assist-member@example.test'),
  ('f8000000-0000-4000-8000-000000000004', 'assist-outsider@example.test');
update public.profiles set display_name = 'Olive Owner' where user_id = 'f8000000-0000-4000-8000-000000000001';
update public.profiles set display_name = 'Orin Organizer' where user_id = 'f8000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, timezone) values
  ('f8000000-0000-4000-8000-0000000000aa', 'Assist', 'UTC'),
  ('f8000000-0000-4000-8000-0000000000bb', 'Elsewhere', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('f8000000-0000-4000-8000-0000000000aa', 'f8000000-0000-4000-8000-000000000001', 'owner', 'assist-owner@example.test'),
  ('f8000000-0000-4000-8000-0000000000aa', 'f8000000-0000-4000-8000-000000000002', 'organizer', 'assist-organizer@example.test'),
  ('f8000000-0000-4000-8000-0000000000aa', 'f8000000-0000-4000-8000-000000000003', 'member', 'assist-member@example.test'),
  ('f8000000-0000-4000-8000-0000000000bb', 'f8000000-0000-4000-8000-000000000004', 'owner', 'assist-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
  ('f8000000-0000-4000-8000-0000000000e1', 'f8000000-0000-4000-8000-0000000000aa', 'Dinner', now() - interval '10 days', now() - interval '10 days' + interval '2 hours', 'UTC', 'f8000000-0000-4000-8000-000000000001'),
  ('f8000000-0000-4000-8000-0000000000f1', 'f8000000-0000-4000-8000-0000000000bb', 'Private', now() - interval '10 days', now() - interval '10 days' + interval '2 hours', 'UTC', 'f8000000-0000-4000-8000-000000000004');

set local role authenticated;

-- Owner creates a key; the secret is returned once, never listed.
select set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000001', true);
select set_config('test.owner_token', public.create_assistant_token('f8000000-0000-4000-8000-0000000000aa', 'Claude on my laptop', 'read', 90)::text, true);
select matches(current_setting('test.owner_token')::jsonb->>'secret', '^brie_[0-9a-f]{64}$', 'Secret has the documented format');
select is(current_setting('test.owner_token')::jsonb->>'prefix', left(current_setting('test.owner_token')::jsonb->>'secret', 13), 'Prefix identifies the key without revealing it');
select ok(position(current_setting('test.owner_token')::jsonb->>'secret' in public.list_assistant_tokens('f8000000-0000-4000-8000-0000000000aa')::text) = 0, 'Listing never shows the secret');
select ok(not (public.list_assistant_tokens('f8000000-0000-4000-8000-0000000000aa')->0 ? 'tokenHash'), 'Listing never shows the hash');
select throws_ok($$select public.create_assistant_token('f8000000-0000-4000-8000-0000000000aa', 'x', 'write', 90)$$, 'P0001', 'VALIDATION', 'Unknown scope is rejected');
select throws_ok($$select public.create_assistant_token('f8000000-0000-4000-8000-0000000000aa', 'x', 'read', 5000)$$, 'P0001', 'VALIDATION', 'Unsupported lifetime is rejected');
select throws_ok($$select public.create_assistant_token('f8000000-0000-4000-8000-0000000000aa', '  ', 'read', 30)$$, 'P0001', 'VALIDATION', 'Blank label is rejected');

-- Organizer creates and sees only their own keys.
select set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000002', true);
select set_config('test.organizer_token', public.create_assistant_token('f8000000-0000-4000-8000-0000000000aa', 'Organizer key', 'read_draft', 30)::text, true);
select is(jsonb_array_length(public.list_assistant_tokens('f8000000-0000-4000-8000-0000000000aa')), 1, 'Organizer lists only their own key');
select throws_ok(format($$select public.revoke_assistant_token('f8000000-0000-4000-8000-0000000000aa', %L)$$, current_setting('test.owner_token')::jsonb->>'id'), 'P0001', 'UNAVAILABLE', 'Organizer cannot revoke the owner''s key');

-- Members and other workspaces cannot manage keys.
select set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.create_assistant_token('f8000000-0000-4000-8000-0000000000aa', 'Member key', 'read', 30)$$, 'P0001', 'FORBIDDEN', 'Member cannot create a key');
select throws_ok($$select public.list_assistant_tokens('f8000000-0000-4000-8000-0000000000aa')$$, 'P0001', 'FORBIDDEN', 'Member cannot list keys');
select set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.list_assistant_tokens('f8000000-0000-4000-8000-0000000000aa')$$, 'P0001', 'UNAVAILABLE', 'Another workspace cannot list keys');

-- Owner sees every key.
select set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000001', true);
select is(jsonb_array_length(public.list_assistant_tokens('f8000000-0000-4000-8000-0000000000aa')), 2, 'Owner lists every key in the workspace');
select is((select t->>'createdByName' from jsonb_array_elements(public.list_assistant_tokens('f8000000-0000-4000-8000-0000000000aa')) t where t->>'label' = 'Organizer key'), 'Orin Organizer', 'Listing names each key''s creator');

-- Browser roles cannot reach the assistant entry points.
select throws_ok(format($$select public.assistant_call(%L, 'get_workspace', '{}')$$, current_setting('test.owner_token')::jsonb->>'secret'), '42501', null, 'Signed-in users cannot call assistant_call');
select throws_ok(format($$select public.assistant_check(%L)$$, current_setting('test.owner_token')::jsonb->>'secret'), '42501', null, 'Signed-in users cannot call assistant_check');
reset role;
set local role anon;
select throws_ok($$select public.assistant_call('brie_x', 'get_workspace', '{}')$$, '42501', null, 'Signed-out visitors cannot call assistant_call');
reset role;

-- The assistant server (service role).
set local role service_role;
select is(public.assistant_check(current_setting('test.owner_token')::jsonb->>'secret')->>'workspaceName', 'Assist', 'A valid key resolves to its workspace');
select is(public.assistant_call(current_setting('test.owner_token')::jsonb->>'secret', 'get_event_plan', jsonb_build_object('eventId', 'f8000000-0000-4000-8000-0000000000e1'))->'result'->'event'->>'title', 'Dinner', 'A key reads its workspace''s plans');
select is(public.assistant_call(current_setting('test.owner_token')::jsonb->>'secret', 'get_event_plan', jsonb_build_object('eventId', 'f8000000-0000-4000-8000-0000000000f1'))->'error'->>'code', 'UNAVAILABLE', 'A key cannot read another workspace''s event');
select is(public.assistant_call(current_setting('test.owner_token')::jsonb->>'secret', 'get_event_plan', '{"eventId": "not-a-uuid"}')->'error'->>'code', 'VALIDATION', 'Malformed IDs are a validation error, not a crash');
select is(public.assistant_call(current_setting('test.owner_token')::jsonb->>'secret', 'drop_tables', '{}')->'error'->>'code', 'VALIDATION', 'Unknown tools are rejected');
select is(jsonb_array_length(public.assistant_call(current_setting('test.owner_token')::jsonb->>'secret', 'search_events', '{"query": "dinner", "when": "past"}')->'result'->'events'), 1, 'Search runs inside the key''s workspace');
select is(public.assistant_call(current_setting('test.owner_token')::jsonb->>'secret', 'search_events', jsonb_build_object('query', repeat('z', 150), 'secretField', 'hidden'))->>'ok', 'true', 'A long query still runs');
select throws_ok($$select public.assistant_call('brie_' || repeat('0', 64), 'get_workspace', '{}')$$, 'P0001', 'UNAUTHORIZED', 'An unknown key is rejected');
select throws_ok($$select public.assistant_check('not a key')$$, 'P0001', 'UNAUTHORIZED', 'A malformed key is rejected');
reset role;

select is((select count(*)::int from public.assistant_actions where workspace_id = 'f8000000-0000-4000-8000-0000000000aa'), 6, 'Every resolved call is logged, including failures');
select is((select outcome from public.assistant_actions where tool = 'get_event_plan' and arguments->>'eventId' = 'f8000000-0000-4000-8000-0000000000f1'), 'UNAVAILABLE', 'A failed call logs its outcome');
select is((select arguments from public.assistant_actions where tool = 'search_events' order by id desc limit 1), jsonb_build_object('query', repeat('z', 120)), 'Logged arguments are known keys only, with bounded text');
select isnt((select last_used_at from public.assistant_tokens where id = (current_setting('test.owner_token')::jsonb->>'id')::uuid), null, 'Use is recorded on the key');

-- Organizer sees only their own keys' activity.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000002', true);
select is(jsonb_array_length(public.list_assistant_actions('f8000000-0000-4000-8000-0000000000aa', 50)), 0, 'Organizer does not see the owner''s key activity');
select set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000001', true);
select is(jsonb_array_length(public.list_assistant_actions('f8000000-0000-4000-8000-0000000000aa', 50)), 6, 'Owner sees workspace key activity');

-- Demotion, removal, expiry, and revocation stop a key immediately.
reset role;
update public.memberships set role = 'member' where user_id = 'f8000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok(format($$select public.assistant_check(%L)$$, current_setting('test.organizer_token')::jsonb->>'secret'), 'P0001', 'UNAUTHORIZED', 'Demoting the creator to member stops the key');
reset role;
update public.memberships set role = 'organizer', removed_at = now() where user_id = 'f8000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok(format($$select public.assistant_check(%L)$$, current_setting('test.organizer_token')::jsonb->>'secret'), 'P0001', 'UNAUTHORIZED', 'Removing the creator stops the key');
reset role;
update public.assistant_tokens set expires_at = now() - interval '1 second' where id = (current_setting('test.owner_token')::jsonb->>'id')::uuid;
set local role service_role;
select throws_ok(format($$select public.assistant_check(%L)$$, current_setting('test.owner_token')::jsonb->>'secret'), 'P0001', 'UNAUTHORIZED', 'An expired key stops working');
reset role;
update public.assistant_tokens set expires_at = now() + interval '1 day' where id = (current_setting('test.owner_token')::jsonb->>'id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f8000000-0000-4000-8000-000000000001', true);
select is(public.revoke_assistant_token('f8000000-0000-4000-8000-0000000000aa', (current_setting('test.owner_token')::jsonb->>'id')::uuid)->>'status', 'revoked', 'Owner revokes a key');
reset role;
set local role service_role;
select throws_ok(format($$select public.assistant_check(%L)$$, current_setting('test.owner_token')::jsonb->>'secret'), 'P0001', 'UNAUTHORIZED', 'A revoked key stops working');

reset role;
select * from finish();
rollback;
