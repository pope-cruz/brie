-- Supabase Auth owns OAuth registration, PKCE, codes and refresh tokens.
-- Brie grants a client access to one workspace and reuses the assistant surface.
-- A separate DB role prevents OAuth JWTs from inheriting browser RPC/Storage access.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'brie_assistant') then
    create role brie_assistant nologin noinherit;
  end if;
end $$;
grant brie_assistant to authenticator;

alter table public.assistant_tokens add column oauth_client_id uuid;
create unique index assistant_oauth_active_client_idx
  on public.assistant_tokens (created_by, oauth_client_id)
  where oauth_client_id is not null and revoked_at is null;

create function public.connect_assistant(
  p_workspace_id uuid, p_client_id uuid, p_label text, p_scope text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare saved public.assistant_tokens; secret text;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  if auth.jwt()->>'client_id' is not null or p_client_id is null
    or char_length(trim(coalesce(p_label, ''))) not between 1 and 80
    or p_scope is null or p_scope not in ('read', 'read_draft') then
    perform public.raise_app_error('VALIDATION', 'Check the connection details and try again.');
  end if;
  -- Serialize one user's grants across workspaces. Reconnecting never revives an old JWT.
  perform 1 from public.profiles where user_id = auth.uid() for update;
  perform 1 from public.workspaces where id = p_workspace_id for update;
  update public.assistant_tokens set revoked_at = now(), revoked_by = auth.uid()
    where created_by = auth.uid() and oauth_client_id = p_client_id and revoked_at is null;
  if (select count(*) from public.assistant_tokens
      where workspace_id = p_workspace_id and revoked_at is null and expires_at > now()) >= 20 then
    perform public.raise_app_error('VALIDATION', 'This workspace already has 20 active assistant connections. Revoke one first.');
  end if;
  -- This random placeholder is never returned and cannot be used as a manual key.
  secret := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.assistant_tokens
    (workspace_id, created_by, label, scope, token_hash, token_prefix, expires_at, oauth_client_id)
  values (p_workspace_id, auth.uid(), trim(p_label), p_scope,
    encode(extensions.digest(secret, 'sha256'), 'hex'), 'Browser sign-in', now() + interval '365 days', p_client_id)
  returning * into saved;
  perform public.write_audit(p_workspace_id, 'connect_assistant', 'assistant_token', saved.id,
    jsonb_build_object('scope', p_scope, 'clientId', p_client_id));
  return public.assistant_token_to_json(saved);
end;
$$;
revoke all on function public.connect_assistant(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.connect_assistant(uuid, uuid, text, text) to authenticated;

-- Install as the Supabase Custom Access Token Hook BEFORE enabling OAuth.
-- Fail closed if a client has no active Brie grant. Normal login is untouched.
create function public.assistant_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  claims jsonb := event->'claims';
  client_id text := coalesce(event->>'client_id', event->'claims'->>'client_id');
  connection public.assistant_tokens;
  issuer text := event->'claims'->>'iss';
begin
  if client_id is not null then
    select t.* into connection from public.assistant_tokens t
      join public.memberships m on m.workspace_id = t.workspace_id and m.user_id = t.created_by
      where t.created_by = (event->>'user_id')::uuid and t.oauth_client_id = client_id::uuid
        and t.revoked_at is null and t.expires_at > now()
        and m.removed_at is null and m.role in ('owner', 'organizer');
    if connection.id is null or issuer is null or issuer not like '%/auth/v1' then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403,
        'message', 'Connect this assistant to a Brie workspace first.'));
    end if;
    claims := claims || jsonb_build_object(
      'client_id', client_id, 'role', 'brie_assistant',
      'aud', left(issuer, char_length(issuer) - 8) || '/functions/v1/mcp',
      'brie_connection_id', connection.id);
  end if;
  return jsonb_build_object('claims', claims);
end;
$$;
revoke all on function public.assistant_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.assistant_access_token_hook(jsonb) to supabase_auth_admin;

-- Also reject OAuth tokens at the Data API if an operator forgets the hook.
-- This is defense in depth; the dedicated role also denies Storage and app RPCs.
create function public.reject_assistant_api_tokens()
returns void language plpgsql stable set search_path = ''
as $$
begin
  if auth.jwt()->>'client_id' is not null then
    raise sqlstate 'PT403' using message = 'Assistant tokens can only use the Brie MCP server.';
  end if;
end;
$$;
alter role authenticator set pgrst.db_pre_request = 'public.reject_assistant_api_tokens';
notify pgrst, 'reload config';

create function public.resolve_assistant_token_id(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  token public.assistant_tokens;
  membership public.memberships;
begin
  select * into token from public.assistant_tokens
  where id = p_id;
  if token.id is null or token.revoked_at is not null or token.expires_at <= now() then
    perform public.raise_app_error('UNAUTHORIZED', 'This assistant key isn’t valid.');
  end if;
  select * into membership from public.memberships
  where workspace_id = token.workspace_id and user_id = token.created_by and removed_at is null;
  if membership.id is null or membership.role not in ('owner', 'organizer') then
    perform public.raise_app_error('UNAUTHORIZED', 'This assistant key no longer has access. Its creator must be an owner or organizer.');
  end if;
  update public.assistant_tokens set last_used_at = now() where id = token.id;
  return jsonb_build_object(
    'tokenId', token.id, 'workspaceId', token.workspace_id, 'userId', token.created_by,
    'scope', token.scope, 'role', membership.role
  );
end;
$$;
revoke all on function public.resolve_assistant_token_id(uuid) from public, anon, authenticated;

create function public.assistant_call_resolved(p_resolved jsonb, p_tool text, p_args jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  resolved jsonb;
  result jsonb;
  outcome text := 'ok';
  error_code text;
  error_message text;
begin
  resolved := p_resolved;
  begin
    if char_length(coalesce(p_tool, '')) not between 1 and 64 then
      perform public.raise_app_error('VALIDATION', 'Unknown tool.');
    end if;
    result := public.assistant_run_tool((resolved->>'workspaceId')::uuid, (resolved->>'tokenId')::uuid,
      (resolved->>'userId')::uuid, (resolved->>'role')::public.member_role, resolved->>'scope',
      p_tool, coalesce(p_args, '{}'::jsonb));
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics error_code = message_text, error_message = pg_exception_detail;
      outcome := error_code;
    when data_exception then
      error_code := 'VALIDATION';
      error_message := 'Check the tool arguments (IDs, numbers, and ISO 8601 times) and try again.';
      outcome := error_code;
  end;
  insert into public.assistant_actions (workspace_id, token_id, tool, arguments, outcome)
  values ((resolved->>'workspaceId')::uuid, (resolved->>'tokenId')::uuid,
    left(coalesce(p_tool, ''), 64), public.assistant_log_arguments(p_args), outcome);
  if outcome = 'ok' then
    return jsonb_build_object('ok', true, 'result', result);
  end if;
  return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', error_code, 'message', error_message));
end;
$$;

revoke all on function public.assistant_call_resolved(jsonb, text, jsonb) from public, anon, authenticated;

create or replace function public.resolve_assistant_token(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare token_id uuid;
begin
  if p_token is null or p_token !~ '^brie_[0-9a-f]{64}$' then
    perform public.raise_app_error('UNAUTHORIZED', 'This assistant key isn’t valid.');
  end if;
  select id into token_id from public.assistant_tokens
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and oauth_client_id is null;
  return public.resolve_assistant_token_id(token_id);
end;
$$;

create or replace function public.assistant_call(p_token text, p_tool text, p_args jsonb)
returns jsonb language sql security definer set search_path = ''
as $$
  select public.assistant_call_resolved(public.resolve_assistant_token(p_token), p_tool, p_args);
$$;

-- These identities come ONLY from a cryptographically verified JWT in the Edge Function.
create function public.resolve_assistant_oauth(p_user_id uuid, p_client_id uuid, p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.assistant_tokens where id = p_connection_id
      and created_by = p_user_id and oauth_client_id = p_client_id) then
    perform public.raise_app_error('UNAUTHORIZED', 'This assistant connection isn’t valid.');
  end if;
  return public.resolve_assistant_token_id(p_connection_id);
end;
$$;
revoke all on function public.resolve_assistant_oauth(uuid, uuid, uuid) from public, anon, authenticated;

create function public.assistant_oauth_check(p_user_id uuid, p_client_id uuid, p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare resolved jsonb; ws public.workspaces;
begin
  resolved := public.resolve_assistant_oauth(p_user_id, p_client_id, p_connection_id);
  select * into ws from public.workspaces where id = (resolved->>'workspaceId')::uuid;
  return jsonb_build_object('workspaceId', ws.id, 'workspaceName', ws.name, 'timezone', ws.timezone,
    'scope', resolved->'scope', 'role', resolved->'role');
end;
$$;
revoke all on function public.assistant_oauth_check(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assistant_oauth_check(uuid, uuid, uuid) to service_role;

create function public.assistant_oauth_call(
  p_user_id uuid, p_client_id uuid, p_connection_id uuid, p_tool text, p_args jsonb
) returns jsonb language sql security definer set search_path = ''
as $$
  select public.assistant_call_resolved(public.resolve_assistant_oauth(p_user_id, p_client_id, p_connection_id), p_tool, p_args);
$$;
revoke all on function public.assistant_oauth_call(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.assistant_oauth_call(uuid, uuid, uuid, text, jsonb) to service_role;

-- Include the client ID in browser connection lists for resetting native consent.
create or replace function public.assistant_token_to_json(p_token public.assistant_tokens)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_token.id, 'label', p_token.label, 'scope', p_token.scope,
    'prefix', p_token.token_prefix, 'createdAt', p_token.created_at,
    'expiresAt', p_token.expires_at, 'lastUsedAt', p_token.last_used_at,
    'revokedAt', p_token.revoked_at, 'oauthClientId', p_token.oauth_client_id,
    'status', case when p_token.revoked_at is not null then 'revoked'
      when p_token.expires_at <= now() then 'expired' else 'active' end,
    'createdBy', p_token.created_by,
    'createdByName', coalesce((select p.display_name from public.profiles p where p.user_id = p_token.created_by), 'Former member')
  );
$$;
