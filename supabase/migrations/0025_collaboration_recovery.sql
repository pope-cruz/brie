-- An accepted invitation can guide its current member back to the workspace.
-- Everyone else still sees an unavailable link. Owners can distinguish expired
-- invitations from usable pending ones in Team settings.
create or replace function public.peek_invitation(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invite public.invitations;
  member public.memberships;
  workspace_name text;
begin
  if p_token is null or p_token = '' then
    perform public.raise_app_error('UNAVAILABLE', 'This invitation isn’t available.');
  end if;

  select * into invite
  from public.invitations
  where token_hash = extensions.digest(p_token, 'sha256');

  if invite.id is null or invite.revoked_at is not null then
    perform public.raise_app_error('UNAVAILABLE', 'This invitation isn’t available.');
  end if;

  if invite.accepted_at is not null then
    select * into member
    from public.memberships
    where workspace_id = invite.workspace_id
      and user_id = auth.uid()
      and email_normalized = invite.email_normalized
      and removed_at is null;
    if member.id is null then
      perform public.raise_app_error('UNAVAILABLE', 'This invitation isn’t available.');
    end if;
  elsif invite.expires_at < now() then
    perform public.raise_app_error('UNAVAILABLE', 'This invitation isn’t available.');
  end if;

  select name into workspace_name from public.workspaces where id = invite.workspace_id;
  return jsonb_build_object(
    'workspaceName', workspace_name,
    'role', case when member.id is not null then member.role else invite.role end,
    'emailMasked', concat(left(invite.email_normalized, 2), '***@', split_part(invite.email_normalized, '@', 2)),
    'expiresAt', invite.expires_at,
    'alreadyMember', member.id is not null,
    'workspaceId', case when member.id is not null then invite.workspace_id else null end
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
        'expiresAt', i.expires_at,
        'expired', i.expires_at < now()
      ) order by i.created_at desc)
      from public.invitations i
      where i.workspace_id = p_workspace_id
        and i.accepted_at is null
        and i.revoked_at is null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
