-- A run of show is an ordered briefing, not only a set of time-sorted records.
-- Keep content versions independent from ordering so moving a row never creates
-- a false edit conflict or changes its scheduled time.

alter table public.events
  add column team_briefing text not null default ''
  check (char_length(team_briefing) <= 4000);

alter table public.schedule_segments add column sort_order bigint;

with ordered as (
  select id, row_number() over (partition by event_id order by starts_at, id) * 1000 as position
  from public.schedule_segments
)
update public.schedule_segments s
set sort_order = ordered.position
from ordered
where ordered.id = s.id;

alter table public.schedule_segments
  alter column sort_order set default 1000,
  alter column sort_order set not null;

create or replace function public.event_to_json(p_event public.events)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lead_name text;
  lead_removed boolean;
  task_done integer;
  task_total integer;
  attendance_total integer;
begin
  if p_event.lead_membership_id is not null then
    select pr.display_name, m.removed_at is not null
    into lead_name, lead_removed
    from public.memberships m
    join public.profiles pr on pr.user_id = m.user_id
    where m.id = p_event.lead_membership_id;
  end if;
  select count(*) filter (where status = 'done'), count(*)
  into task_done, task_total
  from public.tasks
  where event_id = p_event.id and removed_at is null;
  attendance_total := public.event_attendance_count(p_event.workspace_id, p_event.id);

  return jsonb_build_object(
    'id', p_event.id,
    'workspaceId', p_event.workspace_id,
    'title', p_event.title,
    'description', p_event.description,
    'location', p_event.location,
    'startsAt', p_event.starts_at,
    'endsAt', p_event.ends_at,
    'timezone', p_event.timezone,
    'teamBriefing', p_event.team_briefing,
    'leadMembershipId', p_event.lead_membership_id,
    'leadName', lead_name,
    'leadFormer', coalesce(lead_removed, false),
    'status', p_event.status,
    'archivedAt', p_event.archived_at,
    'version', p_event.version,
    'createdBy', p_event.created_by,
    'taskDone', coalesce(task_done, 0),
    'taskTotal', coalesce(task_total, 0),
    'attendanceCount', attendance_total
  );
end;
$$;

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
    'sortOrder', p_seg.sort_order,
    'overlaps', coalesce((flags ->> 'overlaps')::boolean, false),
    'outOfRange', coalesce((flags ->> 'outOfRange')::boolean, false)
  );
end;
$$;

create or replace function public.save_team_briefing(
  p_workspace_id uuid,
  p_event_id uuid,
  p_team_briefing text,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.events;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_event_writable(p_workspace_id, p_event_id);
  if char_length(coalesce(p_team_briefing, '')) > 4000 then
    perform public.raise_app_error('VALIDATION', 'Team briefing must be 4,000 characters or fewer.');
  end if;
  update public.events
  set team_briefing = coalesce(p_team_briefing, ''), version = version + 1
  where id = p_event_id
    and workspace_id = p_workspace_id
    and version = p_expected_version
    and archived_at is null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This event changed. Reload the latest version.');
  end if;
  return public.event_to_json(saved);
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
  next_order bigint;
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
    select coalesce(max(sort_order), 0) + 1000 into next_order
    from public.schedule_segments
    where workspace_id = p_workspace_id and event_id = p_event_id and removed_at is null;
    insert into public.schedule_segments (
      workspace_id, event_id, title, starts_at, ends_at, owner_membership_id, instructions, sort_order
    ) values (
      p_workspace_id, p_event_id, trim(p_title), p_starts_at, p_ends_at,
      p_owner_membership_id, coalesce(p_instructions, ''), next_order
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
    select jsonb_agg(public.segment_to_json(s) order by s.sort_order, s.starts_at, s.id)
    from public.schedule_segments s
    where s.workspace_id = p_workspace_id and s.event_id = p_event_id
      and (coalesce(p_include_removed, false) or s.removed_at is null)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.reorder_segments(
  p_workspace_id uuid,
  p_event_id uuid,
  p_segment_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_count integer;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_event_writable(p_workspace_id, p_event_id);
  select count(*) into expected_count
  from public.schedule_segments
  where workspace_id = p_workspace_id and event_id = p_event_id and removed_at is null;
  if coalesce(array_length(p_segment_ids, 1), 0) <> expected_count
     or (select count(distinct id) from unnest(p_segment_ids) as ids(id)) <> expected_count
     or exists (
       select 1 from unnest(p_segment_ids) as ids(id)
       where not exists (
         select 1 from public.schedule_segments s
         where s.id = ids.id and s.workspace_id = p_workspace_id
           and s.event_id = p_event_id and s.removed_at is null
       )
     ) then
    perform public.raise_app_error('CONFLICT', 'The schedule changed. Reload it before reordering.');
  end if;
  update public.schedule_segments s
  set sort_order = ordered.ordinality * 1000
  from unnest(p_segment_ids) with ordinality as ordered(id, ordinality)
  where s.id = ordered.id and s.workspace_id = p_workspace_id and s.event_id = p_event_id;
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
    select * from public.schedule_segments where event_id = source.id and removed_at is null order by sort_order, starts_at, id
  loop
    insert into public.schedule_segments (
      workspace_id, event_id, title, starts_at, ends_at, owner_membership_id, instructions, sort_order
    ) values (
      p_workspace_id, created.id, seg.title, seg.starts_at + delta, seg.ends_at + delta,
      null, seg.instructions, seg.sort_order
    );
  end loop;
  return public.remember_request('duplicate_event', p_request_key, public.event_to_json(created));
end;
$$;

revoke all on function public.save_team_briefing(uuid, uuid, text, integer) from public, anon;
revoke all on function public.reorder_segments(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.save_team_briefing(uuid, uuid, text, integer) to authenticated;
grant execute on function public.reorder_segments(uuid, uuid, uuid[]) to authenticated;
