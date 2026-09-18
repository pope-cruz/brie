-- Schedule order is time order (start, end, then creation). Drop the stored
-- position and reorder command added in 0017; the app no longer uses them.

drop function if exists public.reorder_segments(uuid, uuid, uuid[]);

create or replace function public.segment_to_json(p_seg public.schedule_segments)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
  owner_name text;
  owner_removed boolean;
  flags jsonb;
begin
  select * into ev from public.events where id = p_seg.event_id;
  flags := public.segment_flags(p_seg, ev);
  if p_seg.owner_membership_id is not null then
    select pr.display_name, m.removed_at is not null
    into owner_name, owner_removed
    from public.memberships m
    join public.profiles pr on pr.user_id = m.user_id
    where m.id = p_seg.owner_membership_id;
  end if;
  return jsonb_build_object(
    'id', p_seg.id,
    'workspaceId', p_seg.workspace_id,
    'eventId', p_seg.event_id,
    'title', p_seg.title,
    'startsAt', p_seg.starts_at,
    'endsAt', p_seg.ends_at,
    'ownerMembershipId', p_seg.owner_membership_id,
    'ownerName', owner_name,
    'ownerFormer', coalesce(owner_removed, false),
    'instructions', p_seg.instructions,
    'removedAt', p_seg.removed_at,
    'version', p_seg.version,
    'overlaps', coalesce((flags ->> 'overlaps')::boolean, false),
    'outOfRange', coalesce((flags ->> 'outOfRange')::boolean, false)
  );
end;
$$;

create or replace function public.save_segment(
  p_workspace_id uuid,
  p_event_id uuid,
  p_segment_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_owner_membership_id uuid,
  p_instructions text,
  p_ack_warnings boolean,
  p_expected_version integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  existing jsonb;
  saved public.schedule_segments;
  flags jsonb;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  ev := public.require_event_writable(p_workspace_id, p_event_id);
  if p_segment_id is null then
    existing := public.peek_request('save_segment', p_request_key);
    if existing is not null then return existing; end if;
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 1 or char_length(trim(p_title)) > 120 then
    perform public.raise_app_error('VALIDATION', 'Enter an activity up to 120 characters.', jsonb_build_object('title', 'Enter an activity up to 120 characters.'));
  end if;
  if p_ends_at <= p_starts_at then
    perform public.raise_app_error('VALIDATION', 'End must be after start.', jsonb_build_object('endsAt', 'End must be after start.'));
  end if;
  if char_length(coalesce(p_instructions, '')) > 4000 then
    perform public.raise_app_error('VALIDATION', 'Notes must be 4,000 characters or fewer.');
  end if;
  perform public.assert_active_lead(p_workspace_id, p_owner_membership_id);

  if p_segment_id is null then
    insert into public.schedule_segments (
      workspace_id, event_id, title, starts_at, ends_at, owner_membership_id, instructions
    ) values (
      p_workspace_id, p_event_id, trim(p_title), p_starts_at, p_ends_at,
      p_owner_membership_id, coalesce(p_instructions, '')
    ) returning * into saved;
  else
    update public.schedule_segments
    set title = trim(p_title), starts_at = p_starts_at, ends_at = p_ends_at,
        owner_membership_id = p_owner_membership_id,
        instructions = coalesce(p_instructions, ''), version = version + 1
    where id = p_segment_id and workspace_id = p_workspace_id
      and event_id = p_event_id and version = p_expected_version and removed_at is null
    returning * into saved;
    if saved.id is null then
      perform public.raise_app_error('CONFLICT', 'This schedule item changed. Reload the latest version.');
    end if;
  end if;

  flags := public.segment_flags(saved, ev);
  if coalesce(p_ack_warnings, false) is not true
     and ((flags ->> 'overlaps')::boolean or (flags ->> 'outOfRange')::boolean) then
    perform public.raise_app_error('VALIDATION', 'This item overlaps another item or falls outside the event time.', jsonb_build_object('warnings', flags));
  end if;
  if p_segment_id is null then
    return public.remember_request('save_segment', p_request_key, public.segment_to_json(saved));
  end if;
  return public.segment_to_json(saved);
end;
$$;

create or replace function public.list_segments(p_workspace_id uuid, p_event_id uuid, p_include_removed boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  return coalesce((
    select jsonb_agg(public.segment_to_json(s) order by s.starts_at, s.ends_at, s.created_at, s.id)
    from public.schedule_segments s
    where s.workspace_id = p_workspace_id and s.event_id = p_event_id
      and (coalesce(p_include_removed, false) or s.removed_at is null)
  ), '[]'::jsonb);
end;
$$;

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
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  existing := public.peek_request('duplicate_event', p_request_key);
  if existing is not null then return existing; end if;
  select * into source from public.events where id = p_source_event_id and workspace_id = p_workspace_id;
  if source.id is null then perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.'); end if;
  perform public.validate_event_inputs(p_title, source.description, source.location, p_starts_at, p_ends_at, p_timezone, 'draft');
  delta := p_starts_at - source.starts_at;
  insert into public.events (
    workspace_id, title, description, location, starts_at, ends_at, timezone,
    lead_membership_id, status, created_by, team_briefing
  ) values (
    p_workspace_id, trim(p_title), source.description, source.location, p_starts_at, p_ends_at,
    p_timezone, null, 'draft', actor.user_id, source.team_briefing
  ) returning * into created;
  insert into public.tasks (workspace_id, event_id, title, notes, assignee_membership_id, due_date, status, created_by)
  select workspace_id, created.id, title, notes, null, null, 'todo', actor.user_id
  from public.tasks where event_id = source.id and removed_at is null;
  for seg in
    select * from public.schedule_segments where event_id = source.id and removed_at is null order by starts_at, ends_at, created_at, id
  loop
    insert into public.schedule_segments (
      workspace_id, event_id, title, starts_at, ends_at, owner_membership_id, instructions
    ) values (
      p_workspace_id, created.id, seg.title, seg.starts_at + delta, seg.ends_at + delta,
      null, seg.instructions
    );
  end loop;
  return public.remember_request('duplicate_event', p_request_key, public.event_to_json(created));
end;
$$;

alter table public.schedule_segments drop column if exists sort_order;
