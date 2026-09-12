begin;
select plan(10);

insert into auth.users (id, email) values
 ('11111111-1111-4111-8111-111111111111', 'owner-auth-test@example.test'),
 ('22222222-2222-4222-8222-222222222222', 'other-auth-test@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok($$select public.create_workspace('Auth test', 'UTC', 'Owner', 'auth-test-request')$$, 'Owner creates a workspace');
select lives_ok($$select public.create_workspace('Auth test', 'UTC', 'Owner', 'auth-test-request')$$, 'Same request can be retried');
select is(jsonb_array_length(public.list_my_workspaces()), 1, 'Retry creates exactly one workspace');
select is(public.list_my_workspaces()->0->>'role', 'owner', 'Creator is the owner');
select set_config('test.workspace_id', public.list_my_workspaces()->0->>'id', true);
select throws_ok($$insert into public.workspaces(name, timezone) values ('Bypass', 'UTC')$$, '42501', 'permission denied for table workspaces', 'Direct workspace writes are denied');
select throws_ok($$select public.create_workspace('', 'UTC', 'Owner', 'invalid-request')$$, 'P0001', 'VALIDATION', 'Invalid creation is rejected');
select is(jsonb_array_length(public.list_my_workspaces()), 1, 'Failed creation leaves no workspace');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is(jsonb_array_length(public.list_my_workspaces()), 0, 'Other account sees no workspaces');
select throws_ok($$select public.get_workspace(current_setting('test.workspace_id')::uuid)$$, 'P0001', 'UNAVAILABLE', 'Other account cannot open workspace by ID');

set local role anon;
select throws_ok($$select public.create_workspace('Anonymous', 'UTC', 'Anonymous', 'anon-request')$$, '42501', 'permission denied for function create_workspace', 'Anonymous creation is denied');
reset role;
select * from finish();
rollback;
