create type public.event_status as enum ('draft', 'planned', 'completed', 'canceled');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  location text not null default '' check (char_length(location) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  lead_membership_id uuid,
  status public.event_status not null default 'draft',
  archived_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (workspace_id, id),
  check (ends_at > starts_at),
  foreign key (workspace_id, lead_membership_id) references public.memberships (workspace_id, id)
);

create index events_list_idx
  on public.events (workspace_id, archived_at, starts_at, id);

create trigger events_touch before update on public.events
  for each row execute procedure public.touch_updated_at();

create or replace function public.validate_event_inputs(
  p_title text,
  p_description text,
  p_location text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_status public.event_status
)
returns void
language plpgsql
stable
as $$
begin
  if char_length(trim(coalesce(p_title, ''))) < 1 or char_length(trim(p_title)) > 120 then
    perform public.raise_app_error('VALIDATION', 'Enter a title up to 120 characters.', jsonb_build_object('title', 'Enter a title up to 120 characters.'));
  end if;
  if char_length(coalesce(p_description, '')) > 2000 then
    perform public.raise_app_error('VALIDATION', 'Description must be 2,000 characters or fewer.', jsonb_build_object('description', 'Use 2,000 characters or fewer.'));
  end if;
  if char_length(coalesce(p_location, '')) > 200 then
    perform public.raise_app_error('VALIDATION', 'Location must be 200 characters or fewer.', jsonb_build_object('location', 'Use 200 characters or fewer.'));
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    perform public.raise_app_error('VALIDATION', 'End must be after start.', jsonb_build_object('endsAt', 'End must be after start.'));
  end if;
  if not public.is_valid_timezone(p_timezone) then
    perform public.raise_app_error('VALIDATION', 'Choose a valid time zone.', jsonb_build_object('timezone', 'Choose a valid time zone.'));
  end if;
  if p_status = 'planned' and (p_starts_at is null or p_ends_at is null) then
    perform public.raise_app_error('VALIDATION', 'Planned events need a start and end.');
  end if;
end;
$$;

create or replace function public.assert_active_lead(p_workspace_id uuid, p_lead_membership_id uuid)
returns void
language plpgsql
stable
as $$
begin
  if p_lead_membership_id is null then
    return;
  end if;
  if not exists (
    select 1 from public.memberships
    where id = p_lead_membership_id
      and workspace_id = p_workspace_id
      and removed_at is null
  ) then
    perform public.raise_app_error('VALIDATION', 'Choose an active teammate as lead.');
  end if;
end;
$$;

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
begin
  if p_event.lead_membership_id is not null then
    select pr.display_name, m.removed_at is not null
    into lead_name, lead_removed
    from public.memberships m
    join public.profiles pr on pr.user_id = m.user_id
    where m.id = p_event.lead_membership_id;
  end if;
  return jsonb_build_object(
    'id', p_event.id,
    'workspaceId', p_event.workspace_id,
    'title', p_event.title,
    'description', p_event.description,
    'location', p_event.location,
    'startsAt', p_event.starts_at,
    'endsAt', p_event.ends_at,
    'timezone', p_event.timezone,
    'leadMembershipId', p_event.lead_membership_id,
    'leadName', lead_name,
    'leadFormer', coalesce(lead_removed, false),
    'status', p_event.status,
    'archivedAt', p_event.archived_at,
    'version', p_event.version,
    'createdBy', p_event.created_by,
    'taskDone', 0,
    'taskTotal', 0,
    'attendanceCount', null
  );
end;
$$;

create or replace function public.create_event(
  p_workspace_id uuid,
  p_title text,
  p_description text,
  p_location text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_lead_membership_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  existing jsonb;
  created public.events;
  result jsonb;
begin
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  existing := public.peek_request('create_event', p_request_key);
  if existing is not null then
    return existing;
  end if;
  perform public.validate_event_inputs(p_title, p_description, p_location, p_starts_at, p_ends_at, p_timezone, 'draft');
  perform public.assert_active_lead(p_workspace_id, p_lead_membership_id);

  insert into public.events (
    workspace_id, title, description, location, starts_at, ends_at, timezone, lead_membership_id, created_by
  ) values (
    p_workspace_id,
    trim(p_title),
    coalesce(p_description, ''),
    coalesce(p_location, ''),
    p_starts_at,
    p_ends_at,
    p_timezone,
    p_lead_membership_id,
    actor.user_id
  ) returning * into created;

  result := public.event_to_json(created);
  return public.remember_request('create_event', p_request_key, result);
end;
$$;

create or replace function public.get_event(p_workspace_id uuid, p_event_id uuid)
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
  if ev.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  return public.event_to_json(ev);
end;
$$;

create or replace function public.list_events(
  p_workspace_id uuid,
  p_filter text,
  p_query text,
  p_page integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page integer;
  q text;
  total integer;
  rows jsonb;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  page := greatest(coalesce(p_page, 1), 1);
  q := lower(trim(coalesce(p_query, '')));

  with filtered as (
    select e.*
    from public.events e
    where e.workspace_id = p_workspace_id
      and (
        (p_filter = 'archived' and e.archived_at is not null)
        or (p_filter is distinct from 'archived' and e.archived_at is null)
      )
      and (
        p_filter is null or p_filter in ('all', 'archived')
        or (p_filter = 'upcoming' and e.status in ('draft', 'planned') and e.ends_at >= now())
        or (p_filter = 'past' and (e.ends_at < now() or e.status in ('completed', 'canceled')))
      )
      and (
        q = ''
        or lower(e.title) like q || '%'
        or lower(e.location) like q || '%'
      )
  )
  select count(*) into total from filtered;

  select coalesce(jsonb_agg(public.event_to_json(f) order by
    case when p_filter = 'upcoming' then extract(epoch from f.starts_at) end asc,
    case when p_filter is distinct from 'upcoming' then extract(epoch from f.starts_at) end desc,
    f.id
  ), '[]'::jsonb)
  into rows
  from (
    select *
    from public.events e
    where e.workspace_id = p_workspace_id
      and (
        (p_filter = 'archived' and e.archived_at is not null)
        or (p_filter is distinct from 'archived' and e.archived_at is null)
      )
      and (
        p_filter is null or p_filter in ('all', 'archived')
        or (p_filter = 'upcoming' and e.status in ('draft', 'planned') and e.ends_at >= now())
        or (p_filter = 'past' and (e.ends_at < now() or e.status in ('completed', 'canceled')))
      )
      and (
        q = ''
        or lower(e.title) like q || '%'
        or lower(e.location) like q || '%'
      )
    order by
      case when p_filter = 'upcoming' then e.starts_at end asc nulls last,
      case when p_filter is distinct from 'upcoming' then e.starts_at end desc nulls last,
      e.id
    offset (page - 1) * 50
    limit 50
  ) f;

  return jsonb_build_object('rows', rows, 'total', total, 'page', page);
end;
$$;

alter table public.events enable row level security;
revoke all on table public.events from public, anon, authenticated;
revoke all on function public.create_event(uuid, text, text, text, timestamptz, timestamptz, text, uuid, text) from public, anon;
revoke all on function public.get_event(uuid, uuid) from public, anon;
revoke all on function public.list_events(uuid, text, text, integer) from public, anon;
grant execute on function public.create_event(uuid, text, text, text, timestamptz, timestamptz, text, uuid, text) to authenticated;
grant execute on function public.get_event(uuid, uuid) to authenticated;
grant execute on function public.list_events(uuid, text, text, integer) to authenticated;
