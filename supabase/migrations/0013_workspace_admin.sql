create or replace function public.save_workspace(
  p_workspace_id uuid,
  p_name text,
  p_timezone text,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.workspaces;
begin
  perform public.require_roles(p_workspace_id, array['owner']::public.member_role[]);
  if char_length(trim(coalesce(p_name, ''))) < 1 or char_length(trim(p_name)) > 80 then
    perform public.raise_app_error('VALIDATION', 'Enter a workspace name between 1 and 80 characters.', jsonb_build_object('name', 'Enter a name between 1 and 80 characters.'));
  end if;
  if not public.is_valid_timezone(p_timezone) then
    perform public.raise_app_error('VALIDATION', 'Choose a valid time zone.', jsonb_build_object('timezone', 'Choose a valid time zone.'));
  end if;
  update public.workspaces
  set name = trim(p_name), timezone = p_timezone, version = version + 1
  where id = p_workspace_id and version = p_expected_version
  returning * into updated;
  if updated.id is null then
    perform public.raise_app_error('CONFLICT', 'Workspace settings changed. Reload the latest version.');
  end if;
  return jsonb_build_object(
    'id', updated.id,
    'name', updated.name,
    'timezone', updated.timezone,
    'version', updated.version
  );
end;
$$;

create or replace function public.change_member_role(
  p_workspace_id uuid,
  p_membership_id uuid,
  p_role public.member_role,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.memberships;
  updated public.memberships;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_roles(p_workspace_id, array['owner']::public.member_role[]);
  select * into target from public.memberships where id = p_membership_id and workspace_id = p_workspace_id;
  if target.id is null or target.removed_at is not null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  if target.role = 'owner' or p_role = 'owner' then
    perform public.raise_app_error('FORBIDDEN', 'Transfer ownership to change the owner.');
  end if;
  if p_role not in ('organizer', 'member') then
    perform public.raise_app_error('VALIDATION', 'Choose Organizer or Member.');
  end if;
  update public.memberships
  set role = p_role, version = version + 1
  where id = p_membership_id and version = p_expected_version and removed_at is null
  returning * into updated;
  if updated.id is null then
    perform public.raise_app_error('CONFLICT', 'This teammate changed. Reload the latest version.');
  end if;
  perform public.write_audit(p_workspace_id, 'change_member_role', 'membership', updated.id, jsonb_build_object('role', p_role));
  return public.list_team(p_workspace_id);
end;
$$;

create or replace function public.remove_member(
  p_workspace_id uuid,
  p_membership_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  target public.memberships;
  updated public.memberships;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.require_roles(p_workspace_id, array['owner']::public.member_role[]);
  select * into target from public.memberships where id = p_membership_id and workspace_id = p_workspace_id;
  if target.id is null or target.removed_at is not null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  if target.id = actor.id or target.role = 'owner' then
    perform public.raise_app_error('FORBIDDEN', 'Transfer ownership before leaving this workspace.');
  end if;
  update public.memberships
  set removed_at = now(), version = version + 1
  where id = p_membership_id and version = p_expected_version and removed_at is null
  returning * into updated;
  if updated.id is null then
    perform public.raise_app_error('CONFLICT', 'This teammate changed. Reload the latest version.');
  end if;
  perform public.write_audit(p_workspace_id, 'remove_member', 'membership', updated.id, '{}'::jsonb);
  return public.list_team(p_workspace_id);
end;
$$;

create or replace function public.transfer_ownership(
  p_workspace_id uuid,
  p_membership_id uuid,
  p_expected_owner_version integer,
  p_expected_target_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  target public.memberships;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.require_roles(p_workspace_id, array['owner']::public.member_role[]);
  select * into target
  from public.memberships
  where id = p_membership_id and workspace_id = p_workspace_id
  for update;
  if target.id is null or target.removed_at is not null or target.id = actor.id then
    perform public.raise_app_error('VALIDATION', 'Choose an active teammate to become owner.');
  end if;
  if actor.version is distinct from p_expected_owner_version
     or target.version is distinct from p_expected_target_version then
    perform public.raise_app_error('CONFLICT', 'The team changed. Reload and try again.');
  end if;

  update public.memberships
  set role = 'organizer', version = version + 1
  where id = actor.id;

  update public.memberships
  set role = 'owner', version = version + 1
  where id = target.id;

  perform public.write_audit(p_workspace_id, 'transfer_ownership', 'membership', target.id, '{}'::jsonb);
  return public.list_team(p_workspace_id);
end;
$$;

revoke all on function public.save_workspace(uuid, text, text, integer) from public, anon;
revoke all on function public.change_member_role(uuid, uuid, public.member_role, integer) from public, anon;
revoke all on function public.remove_member(uuid, uuid, integer) from public, anon;
revoke all on function public.transfer_ownership(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.save_workspace(uuid, text, text, integer) to authenticated;
grant execute on function public.change_member_role(uuid, uuid, public.member_role, integer) to authenticated;
grant execute on function public.remove_member(uuid, uuid, integer) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid, integer, integer) to authenticated;
