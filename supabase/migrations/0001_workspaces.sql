create extension if not exists pgcrypto with schema extensions;

create type public.member_role as enum ('owner', 'organizer', 'member');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1)
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  user_id uuid not null references auth.users (id),
  role public.member_role not null,
  email_normalized text not null,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  unique (workspace_id, id)
);

create table public.command_requests (
  user_id uuid not null references auth.users (id) on delete cascade,
  command text not null,
  request_key text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, command, request_key)
);

create unique index memberships_active_user
  on public.memberships (workspace_id, user_id)
  where removed_at is null;

create unique index memberships_one_owner
  on public.memberships (workspace_id)
  where role = 'owner' and removed_at is null;

create index memberships_by_user
  on public.memberships (user_id, workspace_id)
  where removed_at is null;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute procedure public.touch_updated_at();
create trigger workspaces_touch before update on public.workspaces
  for each row execute procedure public.touch_updated_at();
create trigger memberships_touch before update on public.memberships
  for each row execute procedure public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_name text;
begin
  chosen_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'Member'
  );
  if char_length(chosen_name) > 80 then
    chosen_name := left(chosen_name, 80);
  end if;
  insert into public.profiles (user_id, display_name)
  values (new.id, chosen_name)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.raise_app_error(
  p_code text,
  p_message text,
  p_fields jsonb default '{}'::jsonb
)
returns void
language plpgsql
immutable
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail = p_message,
    hint = coalesce(p_fields, '{}'::jsonb)::text;
end;
$$;

create or replace function public.require_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    perform public.raise_app_error('UNAUTHENTICATED', 'Sign in to continue.');
  end if;
  return uid;
end;
$$;

create or replace function public.is_valid_timezone(p_timezone text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from pg_timezone_names where name = p_timezone);
$$;

create or replace function public.active_membership(p_workspace_id uuid)
returns public.memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rec public.memberships;
begin
  select * into rec
  from public.memberships
  where workspace_id = p_workspace_id
    and user_id = auth.uid()
    and removed_at is null;
  return rec;
end;
$$;

create or replace function public.require_roles(p_workspace_id uuid, p_roles public.member_role[])
returns public.memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rec public.memberships;
begin
  rec := public.active_membership(p_workspace_id);
  if rec.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  if not (rec.role = any (p_roles)) then
    perform public.raise_app_error('FORBIDDEN', 'You don’t have permission to do that.');
  end if;
  return rec;
end;
$$;

create or replace function public.remember_request(
  p_command text,
  p_request_key text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  existing jsonb;
begin
  uid := public.require_user_id();
  if p_request_key is null or char_length(p_request_key) < 8 or char_length(p_request_key) > 80 then
    perform public.raise_app_error('VALIDATION', 'A request key is required.');
  end if;
  select result into existing
  from public.command_requests
  where user_id = uid and command = p_command and request_key = p_request_key;
  if existing is not null then
    return existing;
  end if;
  insert into public.command_requests (user_id, command, request_key, result)
  values (uid, p_command, p_request_key, p_result);
  return p_result;
end;
$$;

create or replace function public.peek_request(p_command text, p_request_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  existing jsonb;
begin
  if p_request_key is null then
    return null;
  end if;
  select result into existing
  from public.command_requests
  where user_id = auth.uid() and command = p_command and request_key = p_request_key;
  return existing;
end;
$$;

create or replace function public.create_workspace(
  p_name text,
  p_timezone text,
  p_display_name text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  workspace_name text;
  display_name text;
  user_email text;
  existing jsonb;
  new_workspace public.workspaces;
  new_membership public.memberships;
  result jsonb;
begin
  uid := public.require_user_id();
  perform pg_advisory_xact_lock(hashtext(uid::text || 'create_workspace' || coalesce(p_request_key, '')));
  existing := public.peek_request('create_workspace', p_request_key);
  if existing is not null then
    return existing;
  end if;

  workspace_name := trim(coalesce(p_name, ''));
  display_name := trim(coalesce(p_display_name, ''));

  if char_length(workspace_name) < 1 or char_length(workspace_name) > 80 then
    perform public.raise_app_error(
      'VALIDATION',
      'Enter a workspace name between 1 and 80 characters.',
      jsonb_build_object('name', 'Enter a name between 1 and 80 characters.')
    );
  end if;
  if char_length(display_name) < 1 or char_length(display_name) > 80 then
    perform public.raise_app_error(
      'VALIDATION',
      'Enter a display name between 1 and 80 characters.',
      jsonb_build_object('displayName', 'Enter a display name between 1 and 80 characters.')
    );
  end if;
  if not public.is_valid_timezone(p_timezone) then
    perform public.raise_app_error(
      'VALIDATION',
      'Choose a valid time zone.',
      jsonb_build_object('timezone', 'Choose a valid time zone.')
    );
  end if;

  select email into user_email from auth.users where id = uid;
  if user_email is null then
    perform public.raise_app_error('UNAUTHENTICATED', 'Sign in to continue.');
  end if;

  insert into public.profiles (user_id, display_name)
  values (uid, display_name)
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        version = public.profiles.version + 1;

  insert into public.workspaces (name, timezone)
  values (workspace_name, p_timezone)
  returning * into new_workspace;

  insert into public.memberships (workspace_id, user_id, role, email_normalized)
  values (new_workspace.id, uid, 'owner', lower(trim(user_email)))
  returning * into new_membership;

  result := jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', new_workspace.id,
      'name', new_workspace.name,
      'timezone', new_workspace.timezone,
      'version', new_workspace.version
    ),
    'membership', jsonb_build_object(
      'id', new_membership.id,
      'role', new_membership.role
    )
  );
  return public.remember_request('create_workspace', p_request_key, result);
end;
$$;

create or replace function public.list_my_workspaces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_user_id();
  return coalesce(
    (
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'name', w.name,
        'timezone', w.timezone,
        'version', w.version,
        'role', m.role,
        'membershipId', m.id
      ) order by w.created_at desc)
      from public.memberships m
      join public.workspaces w on w.id = m.workspace_id
      where m.user_id = auth.uid()
        and m.removed_at is null
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.get_workspace(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rec public.memberships;
  w public.workspaces;
  profile_name text;
begin
  rec := public.active_membership(p_workspace_id);
  if rec.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  select * into w from public.workspaces where id = p_workspace_id;
  select display_name into profile_name from public.profiles where user_id = auth.uid();
  return jsonb_build_object(
    'id', w.id,
    'name', w.name,
    'timezone', w.timezone,
    'version', w.version,
    'role', rec.role,
    'membershipId', rec.id,
    'displayName', profile_name,
    'email', rec.email_normalized
  );
end;
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.command_requests enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.workspaces from public, anon, authenticated;
revoke all on table public.memberships from public, anon, authenticated;
revoke all on table public.command_requests from public, anon, authenticated;

revoke all on function public.create_workspace(text, text, text, text) from public, anon;
revoke all on function public.list_my_workspaces() from public, anon;
revoke all on function public.get_workspace(uuid) from public, anon;
revoke all on function public.active_membership(uuid) from public, anon;
revoke all on function public.require_roles(uuid, public.member_role[]) from public, anon;
revoke all on function public.remember_request(text, text, jsonb) from public, anon;
revoke all on function public.peek_request(text, text) from public, anon;

grant execute on function public.create_workspace(text, text, text, text) to authenticated;
grant execute on function public.list_my_workspaces() to authenticated;
grant execute on function public.get_workspace(uuid) to authenticated;
