-- Assistant access keys and the assistant call log.
--
-- An owner or organizer creates a key for one workspace. Brie stores only its
-- SHA-256 hash and shows the key once. A key acts as the person who created
-- it, with that person's *current* role: removal, demotion to member, expiry,
-- or revocation stops it on the next call. Scope `read` can use read tools;
-- `read_draft` can also propose draft plans (a later migration).
--
-- The assistant server holds the service-role key and calls only
-- `assistant_check` and `assistant_call`. Browser roles cannot call either.
-- `assistant_call` resolves the key, checks scope, runs one tool through the
-- same builders the app uses, and records the call (tool, bounded arguments,
-- outcome) whether it succeeds or fails.

create table public.assistant_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  created_by uuid not null references auth.users (id),
  label text not null check (char_length(label) between 1 and 80),
  scope text not null check (scope in ('read', 'read_draft')),
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  unique (workspace_id, id)
);
create index assistant_tokens_workspace_idx on public.assistant_tokens (workspace_id, created_at desc, id);
alter table public.assistant_tokens enable row level security;
revoke all on table public.assistant_tokens from public, anon, authenticated;

create table public.assistant_actions (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id),
  token_id uuid not null,
  tool text not null,
  arguments jsonb not null default '{}'::jsonb,
  outcome text not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, token_id) references public.assistant_tokens (workspace_id, id)
);
create index assistant_actions_workspace_idx on public.assistant_actions (workspace_id, created_at desc, id desc);
alter table public.assistant_actions enable row level security;
revoke all on table public.assistant_actions from public, anon, authenticated;

create function public.assistant_token_to_json(p_token public.assistant_tokens)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_token.id, 'label', p_token.label, 'scope', p_token.scope,
    'prefix', p_token.token_prefix, 'createdAt', p_token.created_at,
    'expiresAt', p_token.expires_at, 'lastUsedAt', p_token.last_used_at,
    'revokedAt', p_token.revoked_at,
    'status', case when p_token.revoked_at is not null then 'revoked'
      when p_token.expires_at <= now() then 'expired' else 'active' end,
    'createdBy', p_token.created_by,
    'createdByName', coalesce((select p.display_name from public.profiles p where p.user_id = p_token.created_by), 'Former member')
  );
$$;
revoke all on function public.assistant_token_to_json(public.assistant_tokens) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Venue builders shared by the app and the assistant.

create function public.venue_comparison_json(
  p_workspace_id uuid, p_include_archived boolean, p_event_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  ev public.events;
  start_day date;
  today date;
begin
  if p_event_id is not null then
    select * into ev from public.events where id = p_event_id and workspace_id = p_workspace_id;
    if ev.id is null then
      perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
    end if;
    start_day := (ev.starts_at at time zone ev.timezone)::date;
    today := (now() at time zone ev.timezone)::date;
  end if;
  return coalesce((
    select jsonb_agg(public.venue_to_json(v) || jsonb_build_object(
      'usage', (
        select jsonb_build_object(
          'pastEventCount', count(*),
          'lastUsedOn', max((e.starts_at at time zone e.timezone)::date),
          'largestAttendance', max(public.event_attendance_count(p_workspace_id, e.id))
        )
        from public.events e
        where e.workspace_id = p_workspace_id and e.venue_id = v.id
          and e.ends_at < now() and e.status <> 'canceled'
      ),
      'fit', case when ev.id is null then null else jsonb_build_object(
        'requestBy', start_day - v.lead_time_days,
        'requestByPassed', start_day - v.lead_time_days < today,
        'linkedToEvent', ev.venue_id is not distinct from v.id,
        'conflicts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', o.id, 'title', o.title, 'startsAt', o.starts_at,
            'endsAt', o.ends_at, 'timezone', o.timezone
          ) order by o.starts_at, o.id)
          from public.events o
          where o.workspace_id = p_workspace_id and o.venue_id = v.id
            and o.id <> ev.id and o.archived_at is null and o.status <> 'canceled'
            and tstzrange(o.starts_at, o.ends_at) && tstzrange(ev.starts_at, ev.ends_at)
        ), '[]'::jsonb)
      ) end
    ) order by lower(v.name), v.id)
    from public.venues v
    where v.workspace_id = p_workspace_id
      and (coalesce(p_include_archived, false) or v.removed_at is null)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.venue_comparison_json(uuid, boolean, uuid) from public, anon, authenticated;

create or replace function public.compare_venues(
  p_workspace_id uuid, p_include_archived boolean, p_event_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  return public.venue_comparison_json(p_workspace_id, p_include_archived, p_event_id);
end;
$$;

create function public.venue_detail_json(p_workspace_id uuid, p_venue_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare venue public.venues;
begin
  select * into venue from public.venues where workspace_id = p_workspace_id and id = p_venue_id;
  if venue.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  return public.venue_to_json(venue) || jsonb_build_object('pastEvents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'startsAt', e.starts_at,
      'timezone', e.timezone, 'location', e.location
    ) order by e.starts_at desc, e.id)
    from public.events e
    where e.workspace_id = p_workspace_id and e.venue_id = p_venue_id
      and e.ends_at < now() and e.status <> 'canceled'
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.venue_detail_json(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_venue(p_workspace_id uuid, p_venue_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  return public.venue_detail_json(p_workspace_id, p_venue_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- App RPCs: create, list, and revoke keys; read the call log.

create function public.create_assistant_token(
  p_workspace_id uuid, p_label text, p_scope text, p_expires_in_days integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  secret text;
  saved public.assistant_tokens;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  if char_length(trim(coalesce(p_label, ''))) not between 1 and 80
    or p_scope is null or p_scope not in ('read', 'read_draft')
    or p_expires_in_days is null or p_expires_in_days not in (7, 30, 90, 365)
  then
    perform public.raise_app_error('VALIDATION', 'Check the key details and try again.');
  end if;
  -- Serialize key creation per workspace so the active-key limit holds.
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if (select count(*) from public.assistant_tokens
      where workspace_id = p_workspace_id and revoked_at is null and expires_at > now()) >= 20 then
    perform public.raise_app_error('VALIDATION', 'This workspace already has 20 active assistant keys. Revoke one first.');
  end if;
  secret := 'brie_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.assistant_tokens (workspace_id, created_by, label, scope, token_hash, token_prefix, expires_at)
  values (p_workspace_id, auth.uid(), trim(p_label), p_scope,
    encode(extensions.digest(secret, 'sha256'), 'hex'), left(secret, 13),
    now() + make_interval(days => p_expires_in_days))
  returning * into saved;
  perform public.write_audit(p_workspace_id, 'create_assistant_token', 'assistant_token', saved.id,
    jsonb_build_object('scope', p_scope, 'expiresInDays', p_expires_in_days));
  return public.assistant_token_to_json(saved) || jsonb_build_object('secret', secret);
end;
$$;
revoke all on function public.create_assistant_token(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_assistant_token(uuid, text, text, integer) to authenticated;

-- Owners see every key in the workspace; organizers see their own.
create function public.list_assistant_tokens(p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare membership public.memberships;
begin
  membership := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  return coalesce((
    select jsonb_agg(public.assistant_token_to_json(t) order by t.created_at desc, t.id)
    from public.assistant_tokens t
    where t.workspace_id = p_workspace_id
      and (membership.role = 'owner' or t.created_by = auth.uid())
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_assistant_tokens(uuid) from public, anon, authenticated;
grant execute on function public.list_assistant_tokens(uuid) to authenticated;

create function public.revoke_assistant_token(p_workspace_id uuid, p_token_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  membership public.memberships;
  saved public.assistant_tokens;
begin
  membership := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  update public.assistant_tokens
  set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid())
  where workspace_id = p_workspace_id and id = p_token_id
    and (membership.role = 'owner' or created_by = auth.uid())
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This key isn’t available.');
  end if;
  perform public.write_audit(p_workspace_id, 'revoke_assistant_token', 'assistant_token', saved.id, '{}'::jsonb);
  return public.assistant_token_to_json(saved);
end;
$$;
revoke all on function public.revoke_assistant_token(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_assistant_token(uuid, uuid) to authenticated;

create function public.list_assistant_actions(p_workspace_id uuid, p_limit integer)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare membership public.memberships;
begin
  membership := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'tool', a.tool, 'arguments', a.arguments, 'outcome', a.outcome,
      'createdAt', a.created_at, 'tokenId', a.token_id, 'tokenLabel', t.label
    ) order by a.created_at desc, a.id desc)
    from (
      select a.* from public.assistant_actions a
      join public.assistant_tokens t on t.id = a.token_id
      where a.workspace_id = p_workspace_id
        and (membership.role = 'owner' or t.created_by = auth.uid())
      order by a.created_at desc, a.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) a
    join public.assistant_tokens t on t.id = a.token_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_assistant_actions(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_assistant_actions(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Service-role entry points for the assistant server.

-- Resolves a presented key to its workspace, creator, scope, and the creator's
-- current role. Raises UNAUTHORIZED for anything that should not work.
create function public.resolve_assistant_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  token public.assistant_tokens;
  membership public.memberships;
begin
  if p_token is null or p_token !~ '^brie_[0-9a-f]{64}$' then
    perform public.raise_app_error('UNAUTHORIZED', 'This assistant key isn’t valid.');
  end if;
  select * into token from public.assistant_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
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
revoke all on function public.resolve_assistant_token(text) from public, anon, authenticated;

-- Lets the server reject a bad key before it starts an MCP session.
create function public.assistant_check(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  resolved jsonb;
  ws public.workspaces;
begin
  resolved := public.resolve_assistant_token(p_token);
  select * into ws from public.workspaces where id = (resolved->>'workspaceId')::uuid;
  return jsonb_build_object(
    'workspaceId', ws.id, 'workspaceName', ws.name, 'timezone', ws.timezone,
    'scope', resolved->'scope', 'role', resolved->'role'
  );
end;
$$;
revoke all on function public.assistant_check(text) from public, anon, authenticated;
grant execute on function public.assistant_check(text) to service_role;

-- Keeps only known arguments, with bounded text, for the call log.
create function public.assistant_log_arguments(p_args jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, case jsonb_typeof(value)
      when 'string' then to_jsonb(left(value #>> '{}', 120))
      when 'number' then value when 'boolean' then value
      else to_jsonb('…'::text) end), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_args) = 'object' then p_args else '{}'::jsonb end)
  where key in ('eventId', 'venueId', 'query', 'when', 'limit', 'includeArchived');
$$;
revoke all on function public.assistant_log_arguments(jsonb) from public, anon, authenticated;

create function public.assistant_run_tool(
  p_workspace_id uuid, p_role public.member_role, p_scope text, p_tool text, p_args jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare ws public.workspaces;
begin
  case p_tool
    when 'get_workspace' then
      select * into ws from public.workspaces where id = p_workspace_id;
      return jsonb_build_object('id', ws.id, 'name', ws.name, 'timezone', ws.timezone,
        'role', p_role, 'scope', p_scope, 'now', now());
    when 'list_events' then
      return public.event_search_json(p_workspace_id, '', coalesce(p_args->>'when', 'upcoming'),
        null, (p_args->>'limit')::integer);
    when 'search_events' then
      return public.event_search_json(p_workspace_id, p_args->>'query', coalesce(p_args->>'when', 'past'),
        (p_args->>'venueId')::uuid, (p_args->>'limit')::integer);
    when 'get_event_plan' then
      if p_args->>'eventId' is null then
        perform public.raise_app_error('VALIDATION', 'eventId is required.');
      end if;
      return public.event_plan_json(p_workspace_id, (p_args->>'eventId')::uuid, p_role);
    when 'list_venues' then
      return jsonb_build_object('venues', public.venue_comparison_json(p_workspace_id,
        coalesce((p_args->>'includeArchived')::boolean, false), null));
    when 'get_venue' then
      if p_args->>'venueId' is null then
        perform public.raise_app_error('VALIDATION', 'venueId is required.');
      end if;
      return public.venue_detail_json(p_workspace_id, (p_args->>'venueId')::uuid);
    else
      perform public.raise_app_error('VALIDATION', 'Unknown tool.');
  end case;
  return null;
end;
$$;
revoke all on function public.assistant_run_tool(uuid, public.member_role, text, text, jsonb) from public, anon, authenticated;

-- One assistant tool call. Returns {ok: true, result} or {ok: false, error:
-- {code, message}}; an invalid key raises instead, because there is no
-- workspace to log it in. Every resolved call is logged, including failures.
create function public.assistant_call(p_token text, p_tool text, p_args jsonb)
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
  resolved := public.resolve_assistant_token(p_token);
  begin
    if char_length(coalesce(p_tool, '')) not between 1 and 64 then
      perform public.raise_app_error('VALIDATION', 'Unknown tool.');
    end if;
    result := public.assistant_run_tool((resolved->>'workspaceId')::uuid,
      (resolved->>'role')::public.member_role, resolved->>'scope', p_tool, coalesce(p_args, '{}'::jsonb));
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics error_code = message_text, error_message = pg_exception_detail;
      outcome := error_code;
    when invalid_text_representation or numeric_value_out_of_range then
      error_code := 'VALIDATION';
      error_message := 'Check the tool arguments and try again.';
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
revoke all on function public.assistant_call(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.assistant_call(text, text, jsonb) to service_role;
