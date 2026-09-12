create or replace function public.duplicate_event(
  p_workspace_id uuid,
  p_source_event_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  source public.events;
  existing jsonb;
  created public.events;
  delta interval;
  seg public.schedule_segments;
  new_end timestamptz;
begin
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  existing := public.peek_request('duplicate_event', p_request_key);
  if existing is not null then
    return existing;
  end if;

  select * into source
  from public.events
  where id = p_source_event_id and workspace_id = p_workspace_id;
  if source.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;

  perform public.validate_event_inputs(p_title, source.description, source.location, p_starts_at, p_ends_at, p_timezone, 'draft');
  delta := p_starts_at - source.starts_at;

  insert into public.events (
    workspace_id, title, description, location, starts_at, ends_at, timezone, lead_membership_id, status, created_by
  ) values (
    p_workspace_id, trim(p_title), source.description, source.location, p_starts_at, p_ends_at, p_timezone, null, 'draft', actor.user_id
  ) returning * into created;

  insert into public.tasks (
    workspace_id, event_id, title, notes, assignee_membership_id, due_date, status, created_by
  )
  select workspace_id, created.id, title, notes, null, null, 'todo', actor.user_id
  from public.tasks
  where event_id = source.id and removed_at is null;

  for seg in
    select * from public.schedule_segments
    where event_id = source.id and removed_at is null
  loop
    new_end := (seg.starts_at + delta) + (seg.ends_at - seg.starts_at);
    insert into public.schedule_segments (
      workspace_id, event_id, title, starts_at, ends_at, owner_membership_id, instructions
    ) values (
      p_workspace_id, created.id, seg.title, seg.starts_at + delta, new_end, null, seg.instructions
    );
  end loop;

  return public.remember_request('duplicate_event', p_request_key, public.event_to_json(created));
end;
$$;

revoke all on function public.duplicate_event(uuid, uuid, text, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.duplicate_event(uuid, uuid, text, timestamptz, timestamptz, text, text) to authenticated;
