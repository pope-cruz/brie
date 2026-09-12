create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  email_normalized text not null,
  role public.member_role not null check (role in ('organizer', 'member')),
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create unique index invitations_one_outstanding
  on public.invitations (workspace_id, email_normalized)
  where accepted_at is null and revoked_at is null;

create trigger invitations_touch before update on public.invitations
  for each row execute procedure public.touch_updated_at();

create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select lower(trim(p_email));
$$;

create or replace function public.create_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role public.member_role
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  email_norm text;
  token text;
  token_raw bytea;
  invite public.invitations;
begin
  actor := public.require_roles(p_workspace_id, array['owner']::public.member_role[]);
  email_norm := public.normalize_email(p_email);
  if email_norm is null or email_norm !~* '^[^@]+@[^@]+\.[^@]+$' or char_length(email_norm) > 254 then
    perform public.raise_app_error(
      'VALIDATION',
      'Enter a valid email address.',
      jsonb_build_object('email', 'Enter a valid email address.')
    );
  end if;
  if p_role not in ('organizer', 'member') then
    perform public.raise_app_error('VALIDATION', 'Choose Organizer or Member.');
  end if;

  if exists (
    select 1 from public.memberships
    where workspace_id = p_workspace_id
      and email_normalized = email_norm
      and removed_at is null
  ) then
    perform public.raise_app_error('VALIDATION', 'That person already belongs to this workspace.');
  end if;

  update public.invitations
  set revoked_at = now(), version = version + 1
  where workspace_id = p_workspace_id
    and email_normalized = email_norm
    and accepted_at is null
    and revoked_at is null;

  token_raw := extensions.gen_random_bytes(32);
  token := encode(token_raw, 'hex');

  insert into public.invitations (
    workspace_id, email_normalized, role, token_hash, expires_at, created_by
  ) values (
    p_workspace_id,
    email_norm,
    p_role,
    extensions.digest(token, 'sha256'),
    now() + interval '7 days',
    actor.user_id
  ) returning * into invite;

  return jsonb_build_object(
    'id', invite.id,
    'email', invite.email_normalized,
    'role', invite.role,
    'expiresAt', invite.expires_at,
    'token', token
  );
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.invitations;
begin
  select * into invite from public.invitations where id = p_invitation_id;
  if invite.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  perform public.require_roles(invite.workspace_id, array['owner']::public.member_role[]);
  if invite.revoked_at is not null or invite.accepted_at is not null then
    return jsonb_build_object('id', invite.id, 'revoked', true);
  end if;
  update public.invitations
  set revoked_at = now(), version = version + 1
  where id = invite.id;
  return jsonb_build_object('id', invite.id, 'revoked', true);
end;
$$;

create or replace function public.peek_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invite public.invitations;
  workspace_name text;
begin
  if p_token is null or p_token = '' then
    perform public.raise_app_error('UNAVAILABLE', 'This invitation isn’t available.');
  end if;
  select * into invite
  from public.invitations
  where token_hash = extensions.digest(p_token, 'sha256');
  if invite.id is null or invite.revoked_at is not null or invite.accepted_at is not null or invite.expires_at < now() then
    perform public.raise_app_error('UNAVAILABLE', 'This invitation isn’t available.');
  end if;
  select name into workspace_name from public.workspaces where id = invite.workspace_id;
  return jsonb_build_object(
    'workspaceName', workspace_name,
    'role', invite.role,
    'emailMasked', concat(left(invite.email_normalized, 2), '***@', split_part(invite.email_normalized, '@', 2)),
    'expiresAt', invite.expires_at
  );
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  user_email text;
  invite public.invitations;
  existing public.memberships;
  new_membership public.memberships;
  display_name text;
begin
  uid := public.require_user_id();
  select email into user_email from auth.users where id = uid;
  select * into invite
  from public.invitations
  where token_hash = extensions.digest(p_token, 'sha256')
  for update;
  if invite.id is null or invite.revoked_at is not null or invite.expires_at < now() then
    perform public.raise_app_error('UNAVAILABLE', 'This invitation isn’t available.');
  end if;
  if public.normalize_email(user_email) <> invite.email_normalized then
    perform public.raise_app_error(
      'FORBIDDEN',
      'Sign in with the invited email to accept this invitation.'
    );
  end if;

  select * into existing
  from public.memberships
  where workspace_id = invite.workspace_id
    and user_id = uid
    and removed_at is null;

  if existing.id is not null then
    update public.invitations
    set accepted_at = coalesce(accepted_at, now()), version = version + 1
    where id = invite.id and accepted_at is null;
    return jsonb_build_object(
      'workspaceId', invite.workspace_id,
      'alreadyMember', true,
      'role', existing.role
    );
  end if;

  if invite.accepted_at is not null then
    perform public.raise_app_error('UNAVAILABLE', 'This invitation isn’t available.');
  end if;

  select display_name into display_name from public.profiles where user_id = uid;

  insert into public.memberships (workspace_id, user_id, role, email_normalized)
  values (invite.workspace_id, uid, invite.role, invite.email_normalized)
  returning * into new_membership;

  update public.invitations
  set accepted_at = now(), version = version + 1
  where id = invite.id;

  return jsonb_build_object(
    'workspaceId', invite.workspace_id,
    'alreadyMember', false,
    'role', new_membership.role,
    'displayName', display_name
  );
end;
$$;

create or replace function public.list_team(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
begin
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'userId', m.user_id,
        'role', m.role,
        'email', case when actor.role = 'owner' then m.email_normalized else null end,
        'displayName', p.display_name,
        'joinedAt', m.joined_at,
        'removedAt', m.removed_at,
        'former', m.removed_at is not null,
        'version', m.version
      ) order by m.removed_at nulls first, p.display_name)
      from public.memberships m
      join public.profiles p on p.user_id = m.user_id
      where m.workspace_id = p_workspace_id
        and (m.removed_at is null or actor.role = 'owner')
    ), '[]'::jsonb),
    'invitations', case when actor.role = 'owner' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'email', i.email_normalized,
        'role', i.role,
        'expiresAt', i.expires_at
      ) order by i.created_at desc)
      from public.invitations i
      where i.workspace_id = p_workspace_id
        and i.accepted_at is null
        and i.revoked_at is null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

alter table public.invitations enable row level security;
revoke all on table public.invitations from public, anon, authenticated;

revoke all on function public.create_invitation(uuid, text, public.member_role) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.peek_invitation(text) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.list_team(uuid) from public, anon;

grant execute on function public.create_invitation(uuid, text, public.member_role) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.peek_invitation(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.list_team(uuid) to authenticated;
grant execute on function public.peek_invitation(text) to anon;
