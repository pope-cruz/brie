begin;
select no_plan();
insert into auth.users (id, email) values
  ('fb000000-0000-4000-8000-000000000001', 'oauth-owner@example.test'),
  ('fb000000-0000-4000-8000-000000000002', 'oauth-member@example.test');
insert into public.workspaces (id, name, timezone) values
  ('fb000000-0000-4000-8000-0000000000aa', 'OAuth workspace', 'UTC'),
  ('fb000000-0000-4000-8000-0000000000bb', 'Another workspace', 'UTC');
insert into public.memberships (workspace_id, user_id, role, email_normalized) values
  ('fb000000-0000-4000-8000-0000000000aa', 'fb000000-0000-4000-8000-000000000001', 'owner', 'oauth-owner@example.test'),
  ('fb000000-0000-4000-8000-0000000000bb', 'fb000000-0000-4000-8000-000000000001', 'owner', 'oauth-owner@example.test'),
  ('fb000000-0000-4000-8000-0000000000aa', 'fb000000-0000-4000-8000-000000000002', 'member', 'oauth-member@example.test');
select set_config('request.jwt.claims', '{"sub":"fb000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.connection', (public.connect_assistant('fb000000-0000-4000-8000-0000000000aa',
  'fb000000-0000-4000-8000-0000000000cc', 'Cloud assistant', 'read')->>'id'), true);
select is(public.list_assistant_tokens('fb000000-0000-4000-8000-0000000000aa')->0->>'oauthClientId',
  'fb000000-0000-4000-8000-0000000000cc', 'Browser connection appears in existing management list');
select ok(not (public.list_assistant_tokens('fb000000-0000-4000-8000-0000000000aa')->0 ? 'secret'), 'No key is returned');
reset role;
select set_config('test.event', jsonb_build_object('user_id', 'fb000000-0000-4000-8000-000000000001', 'claims', jsonb_build_object(
  'iss', 'https://project.supabase.co/auth/v1', 'client_id', 'fb000000-0000-4000-8000-0000000000cc', 'aud', 'authenticated', 'role', 'authenticated'))::text, true);
select is(public.assistant_access_token_hook(current_setting('test.event')::jsonb)->'claims'->>'role', 'brie_assistant', 'OAuth gets a dedicated DB role');
select is(public.assistant_access_token_hook(current_setting('test.event')::jsonb)->'claims'->>'aud', 'https://project.supabase.co/functions/v1/mcp', 'OAuth audience is only the MCP resource');
select is(public.assistant_access_token_hook(current_setting('test.event')::jsonb)->'claims'->>'brie_connection_id', current_setting('test.connection'), 'JWT is bound to this exact connection');
select is(public.assistant_access_token_hook('{"user_id":"fb000000-0000-4000-8000-000000000001","claims":{"aud":"authenticated","role":"authenticated"}}')->'claims',
  '{"aud":"authenticated","role":"authenticated"}'::jsonb, 'Normal sign-in is unchanged');
select is(public.assistant_access_token_hook(jsonb_set(current_setting('test.event')::jsonb, '{claims,client_id}', '"fb000000-0000-4000-8000-0000000000dd"'))->'error'->>'http_code', '403', 'Unapproved client cannot mint an assistant token');
select is(array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('brie_assistant', p.oid, 'execute')), '{}'::text[], 'OAuth DB role cannot call privileged app RPCs');
select ok(not has_table_privilege('brie_assistant', 'public.memberships', 'select'), 'OAuth DB role cannot read team/contact tables');
set local role service_role;
select is(public.assistant_oauth_check('fb000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-0000000000cc', current_setting('test.connection')::uuid)->>'workspaceName', 'OAuth workspace', 'Service resolves only approved workspace');
select is(public.assistant_oauth_call('fb000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-0000000000cc', current_setting('test.connection')::uuid, 'get_workspace', '{}')->'result'->>'id', 'fb000000-0000-4000-8000-0000000000aa', 'Tools stay in the selected workspace');
select is(public.assistant_oauth_call('fb000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-0000000000cc', current_setting('test.connection')::uuid, 'create_event_plan_draft', '{}')->'error'->>'code', 'FORBIDDEN', 'Read-only OAuth cannot propose a draft');
select throws_ok($$select public.assistant_oauth_check('fb000000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-0000000000cc', current_setting('test.connection')::uuid)$$, 'P0001', 'UNAUTHORIZED', 'Cannot borrow another user connection');
select throws_ok($$select public.assistant_oauth_check('fb000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-0000000000dd', current_setting('test.connection')::uuid)$$, 'P0001', 'UNAUTHORIZED', 'Cannot borrow another client connection');
reset role;
select is((select count(*)::int from public.assistant_actions where token_id = current_setting('test.connection')::uuid), 2, 'Successful and rejected OAuth calls are logged');
set local role authenticated;
select set_config('test.replacement', public.connect_assistant('fb000000-0000-4000-8000-0000000000bb', 'fb000000-0000-4000-8000-0000000000cc', 'Cloud assistant', 'read_draft')->>'id', true);
reset role;
set local role service_role;
select throws_ok($$select public.assistant_oauth_check('fb000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-0000000000cc', current_setting('test.connection')::uuid)$$, 'P0001', 'UNAUTHORIZED', 'Reconnecting never revives the old JWT');
select is(public.assistant_oauth_check('fb000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-0000000000cc', current_setting('test.replacement')::uuid)->>'scope', 'read_draft', 'Reconnection can explicitly approve draft access');
reset role;
set local role authenticated;
select public.revoke_assistant_token('fb000000-0000-4000-8000-0000000000bb', current_setting('test.replacement')::uuid);
reset role;
set local role service_role;
select throws_ok($$select public.assistant_oauth_call('fb000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-0000000000cc', current_setting('test.replacement')::uuid, 'get_workspace', '{}')$$, 'P0001', 'UNAUTHORIZED', 'Revocation stops an already-issued token');
reset role;
select is(public.assistant_access_token_hook(current_setting('test.event')::jsonb)->'error'->>'http_code', '403', 'Revocation also prevents refresh issuance');
select set_config('request.jwt.claims', '{"sub":"fb000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
select throws_ok($$select public.connect_assistant('fb000000-0000-4000-8000-0000000000aa', 'fb000000-0000-4000-8000-0000000000cc', 'Assistant', 'read')$$, 'P0001', 'FORBIDDEN', 'Members cannot approve assistant access');
select set_config('request.jwt.claims', '{"sub":"fb000000-0000-4000-8000-000000000001","client_id":"fb000000-0000-4000-8000-0000000000cc"}', true);
select throws_ok($$select public.reject_assistant_api_tokens()$$, 'PT403', 'Assistant tokens can only use the Brie MCP server.', 'Data API refuses OAuth tokens even without a configured token hook');
reset role;
select * from finish();
rollback;
