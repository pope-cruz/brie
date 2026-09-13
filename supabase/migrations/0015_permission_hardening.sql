-- accept_invitation failed for every new member: the display_name variable
-- collided with profiles.display_name ("column reference is ambiguous").
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
  profile_name text;
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

  select p.display_name into profile_name from public.profiles p where p.user_id = uid;

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
    'displayName', profile_name
  );
end;
$$;

-- Internal security-definer helpers were executable by anon and authenticated
-- (Supabase grants execute on new public functions by default). They skip the
-- membership checks the RPCs perform, e.g. anyone could call write_audit for any
-- workspace. Only the owning role, which runs the RPCs, keeps execute.
revoke execute on function public.write_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.active_event_attendee_ids(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.event_attendance_count(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.event_to_json(public.events) from public, anon, authenticated;
revoke execute on function public.task_to_json(public.tasks) from public, anon, authenticated;
revoke execute on function public.segment_to_json(public.schedule_segments) from public, anon, authenticated;
revoke execute on function public.receipt_to_json(public.attendance_batches) from public, anon, authenticated;
revoke execute on function public.require_attendance_event(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.require_event_writable(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.active_membership(uuid) from public, anon, authenticated;
revoke execute on function public.require_roles(uuid, public.member_role[]) from public, anon, authenticated;
revoke execute on function public.remember_request(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.peek_request(text, text) from public, anon, authenticated;
revoke execute on function public.purge_expired_previews() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
