-- A schedule item can involve several teammates. An empty set means Everyone.
create table public.schedule_segment_people (
  workspace_id uuid not null,
  segment_id uuid not null,
  membership_id uuid not null,
  primary key (workspace_id, segment_id, membership_id),
  foreign key (workspace_id, segment_id) references public.schedule_segments (workspace_id, id) on delete cascade,
  foreign key (workspace_id, membership_id) references public.memberships (workspace_id, id)
);
create index schedule_people_member_idx on public.schedule_segment_people (workspace_id, membership_id, segment_id);

insert into public.schedule_segment_people (workspace_id, segment_id, membership_id)
select workspace_id, id, owner_membership_id from public.schedule_segments where owner_membership_id is not null;

alter table public.schedule_segment_people enable row level security;
revoke all on table public.schedule_segment_people from public, anon, authenticated;

create or replace function public.segment_to_json(p_seg public.schedule_segments)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  ev public.events;
  people jsonb;
  flags jsonb;
begin
  select * into ev from public.events where id = p_seg.event_id;
  flags := public.segment_flags(p_seg, ev);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'name', pr.display_name, 'former', m.removed_at is not null
  ) order by pr.display_name, m.id), '[]'::jsonb)
  into people
  from public.schedule_segment_people sp
  join public.memberships m on m.id = sp.membership_id
  join public.profiles pr on pr.user_id = m.user_id
  where sp.workspace_id = p_seg.workspace_id and sp.segment_id = p_seg.id;
  return jsonb_build_object(
    'id', p_seg.id, 'workspaceId', p_seg.workspace_id, 'eventId', p_seg.event_id,
    'title', p_seg.title, 'startsAt', p_seg.starts_at, 'endsAt', p_seg.ends_at,
    'people', people,
    'instructions', p_seg.instructions, 'removedAt', p_seg.removed_at,
    'version', p_seg.version,
    'overlaps', coalesce((flags ->> 'overlaps')::boolean, false),
    'outOfRange', coalesce((flags ->> 'outOfRange')::boolean, false)
  );
end;
$$;

drop function public.save_segment(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, boolean, integer, text);

create function public.save_segment_people(
  p_workspace_id uuid, p_event_id uuid, p_segment_id uuid, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_person_ids uuid[],
  p_instructions text, p_ack_warnings boolean, p_expected_version integer,
  p_request_key text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ev public.events;
  existing jsonb;
  saved public.schedule_segments;
  flags jsonb;
  person_id uuid;
  person_ids uuid[];
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  ev := public.require_event_writable(p_workspace_id, p_event_id);
  if p_segment_id is null then
    existing := public.peek_request('save_segment_people', p_request_key);
    if existing is not null then return existing; end if;
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    perform public.raise_app_error('VALIDATION', 'Enter an activity up to 120 characters.');
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    perform public.raise_app_error('VALIDATION', 'End must be after start.');
  end if;
  if char_length(coalesce(p_instructions, '')) > 4000 then
    perform public.raise_app_error('VALIDATION', 'Notes must be 4,000 characters or fewer.');
  end if;
  if array_position(p_person_ids, null) is not null then
    perform public.raise_app_error('VALIDATION', 'Choose valid people.');
  end if;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into person_ids
  from (select distinct unnest(coalesce(p_person_ids, '{}'::uuid[])) as id) selected;
  foreach person_id in array person_ids loop
    -- A removed teammate may be retained on an existing item, but never added.
    if p_segment_id is null or not exists (
      select 1 from public.schedule_segment_people
      where workspace_id = p_workspace_id and segment_id = p_segment_id and membership_id = person_id
    ) then
      perform public.assert_active_lead(p_workspace_id, person_id);
    end if;
  end loop;

  if p_segment_id is null then
    insert into public.schedule_segments (workspace_id, event_id, title, starts_at, ends_at, instructions)
    values (p_workspace_id, p_event_id, trim(p_title), p_starts_at, p_ends_at, coalesce(p_instructions, ''))
    returning * into saved;
  else
    update public.schedule_segments
    set title = trim(p_title), starts_at = p_starts_at, ends_at = p_ends_at,
        instructions = coalesce(p_instructions, ''), version = version + 1
    where id = p_segment_id and workspace_id = p_workspace_id and event_id = p_event_id
      and version = p_expected_version and removed_at is null
    returning * into saved;
    if saved.id is null then
      perform public.raise_app_error('CONFLICT', 'This schedule item changed. Reload the latest version.');
    end if;
  end if;
  delete from public.schedule_segment_people
  where workspace_id = p_workspace_id and segment_id = saved.id and membership_id <> all(person_ids);
  insert into public.schedule_segment_people (workspace_id, segment_id, membership_id)
  select p_workspace_id, saved.id, unnest(person_ids)
  on conflict do nothing;

  flags := public.segment_flags(saved, ev);
  if coalesce(p_ack_warnings, false) is not true
     and ((flags ->> 'overlaps')::boolean or (flags ->> 'outOfRange')::boolean) then
    perform public.raise_app_error('VALIDATION', 'This item overlaps another item or falls outside the event time.', jsonb_build_object('warnings', flags));
  end if;
  if p_segment_id is null then
    return public.remember_request('save_segment_people', p_request_key, public.segment_to_json(saved));
  end if;
  return public.segment_to_json(saved);
end;
$$;

-- A duplicated plan has no assigned people, just as it had no owner before.
create or replace function public.duplicate_event(
  p_workspace_id uuid, p_source_event_id uuid, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_timezone text, p_request_key text
)
returns jsonb
language plpgsql security definer set search_path = ''
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
  for seg in select * from public.schedule_segments
    where event_id = source.id and removed_at is null order by starts_at, ends_at, created_at, id
  loop
    insert into public.schedule_segments (workspace_id, event_id, title, starts_at, ends_at, instructions)
    values (p_workspace_id, created.id, seg.title, seg.starts_at + delta, seg.ends_at + delta, seg.instructions);
  end loop;
  return public.remember_request('duplicate_event', p_request_key, public.event_to_json(created));
end;
$$;

alter table public.schedule_segments drop column owner_membership_id;
revoke all on function public.save_segment_people(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid[], text, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.save_segment_people(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid[], text, boolean, integer, text) to authenticated;
