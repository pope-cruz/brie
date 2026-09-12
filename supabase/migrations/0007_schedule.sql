create table public.schedule_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  event_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  owner_membership_id uuid,
  instructions text not null default '' check (char_length(instructions) <= 4000),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (workspace_id, id),
  check (ends_at > starts_at),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id),
  foreign key (workspace_id, owner_membership_id) references public.memberships (workspace_id, id)
);

create index schedule_event_idx on public.schedule_segments (workspace_id, event_id, starts_at, id);
create trigger schedule_touch before update on public.schedule_segments
  for each row execute procedure public.touch_updated_at();

create or replace function public.segment_flags(p_seg public.schedule_segments, p_event public.events)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'overlaps', exists (
      select 1 from public.schedule_segments o
      where o.event_id = p_seg.event_id
        and o.id <> p_seg.id
        and o.removed_at is null
        and o.starts_at < p_seg.ends_at
        and o.ends_at > p_seg.starts_at
    ),
    'outOfRange', p_seg.starts_at < p_event.starts_at or p_seg.ends_at > p_event.ends_at
  );
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
  ev := public.require_event_writable(p_workspace_id, p_event_id);
  if p_segment_id is null then
    existing := public.peek_request('save_segment', p_request_key);
    if existing is not null then
      return existing;
    end if;
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 1 or char_length(trim(p_title)) > 120 then
    perform public.raise_app_error('VALIDATION', 'Enter a segment title up to 120 characters.', jsonb_build_object('title', 'Enter a title up to 120 characters.'));
  end if;
  if p_ends_at <= p_starts_at then
    perform public.raise_app_error('VALIDATION', 'End must be after start.', jsonb_build_object('endsAt', 'End must be after start.'));
  end if;
  if char_length(coalesce(p_instructions, '')) > 4000 then
    perform public.raise_app_error('VALIDATION', 'Instructions must be 4,000 characters or fewer.');
  end if;
  perform public.assert_active_lead(p_workspace_id, p_owner_membership_id);

  if p_segment_id is null then
    insert into public.schedule_segments (
      workspace_id, event_id, title, starts_at, ends_at, owner_membership_id, instructions
    ) values (
      p_workspace_id, p_event_id, trim(p_title), p_starts_at, p_ends_at, p_owner_membership_id, coalesce(p_instructions, '')
    ) returning * into saved;
  else
    update public.schedule_segments
    set title = trim(p_title),
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        owner_membership_id = p_owner_membership_id,
        instructions = coalesce(p_instructions, ''),
        version = version + 1
    where id = p_segment_id
      and workspace_id = p_workspace_id
      and version = p_expected_version
      and removed_at is null
    returning * into saved;
    if saved.id is null then
      perform public.raise_app_error('CONFLICT', 'This segment changed. Reload the latest version.');
    end if;
  end if;

  flags := public.segment_flags(saved, ev);
  if coalesce(p_ack_warnings, false) is not true
     and ((flags ->> 'overlaps')::boolean or (flags ->> 'outOfRange')::boolean) then
    perform public.raise_app_error(
      'VALIDATION',
      'This segment overlaps another segment or falls outside the event time. Confirm to save it anyway.',
      jsonb_build_object('warnings', flags)
    );
  end if;

  if p_segment_id is null then
    return public.remember_request('save_segment', p_request_key, public.segment_to_json(saved));
  end if;
  return public.segment_to_json(saved);
end;
$$;

create or replace function public.remove_segment(p_workspace_id uuid, p_segment_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.schedule_segments;
  saved public.schedule_segments;
begin
  select * into current from public.schedule_segments where id = p_segment_id and workspace_id = p_workspace_id;
  if current.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  perform public.require_event_writable(p_workspace_id, current.event_id);
  update public.schedule_segments
  set removed_at = now(), version = version + 1
  where id = p_segment_id and version = p_expected_version and removed_at is null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This segment changed. Reload the latest version.');
  end if;
  return public.segment_to_json(saved);
end;
$$;

create or replace function public.restore_segment(p_workspace_id uuid, p_segment_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.schedule_segments;
  saved public.schedule_segments;
begin
  select * into current from public.schedule_segments where id = p_segment_id and workspace_id = p_workspace_id;
  if current.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  perform public.require_event_writable(p_workspace_id, current.event_id);
  update public.schedule_segments
  set removed_at = null, version = version + 1
  where id = p_segment_id and version = p_expected_version and removed_at is not null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This segment changed. Reload the latest version.');
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
    select jsonb_agg(public.segment_to_json(s) order by s.starts_at, s.id)
    from public.schedule_segments s
    where s.workspace_id = p_workspace_id
      and s.event_id = p_event_id
      and (coalesce(p_include_removed, false) or s.removed_at is null)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_overview_segments(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  select * into ev from public.events where id = p_event_id and workspace_id = p_workspace_id;
  return coalesce((
    select jsonb_agg(public.segment_to_json(s) order by s.starts_at, s.id)
    from (
      select *
      from public.schedule_segments
      where event_id = p_event_id
        and workspace_id = p_workspace_id
        and removed_at is null
        and (
          (now() between ev.starts_at and ev.ends_at and ends_at >= now())
          or now() < ev.starts_at
          or now() > ev.ends_at
        )
      order by
        case when now() between ev.starts_at and ev.ends_at then
          case when starts_at >= now() then starts_at else ends_at end
        else starts_at end,
        id
      limit 5
    ) s
  ), '[]'::jsonb);
end;
$$;

alter table public.schedule_segments enable row level security;
revoke all on table public.schedule_segments from public, anon, authenticated;
revoke all on function public.save_segment(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, boolean, integer, text) from public, anon;
revoke all on function public.remove_segment(uuid, uuid, integer) from public, anon;
revoke all on function public.restore_segment(uuid, uuid, integer) from public, anon;
revoke all on function public.list_segments(uuid, uuid, boolean) from public, anon;
revoke all on function public.list_overview_segments(uuid, uuid) from public, anon;
grant execute on function public.save_segment(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, boolean, integer, text) to authenticated;
grant execute on function public.remove_segment(uuid, uuid, integer) to authenticated;
grant execute on function public.restore_segment(uuid, uuid, integer) to authenticated;
grant execute on function public.list_segments(uuid, uuid, boolean) to authenticated;
grant execute on function public.list_overview_segments(uuid, uuid) to authenticated;
