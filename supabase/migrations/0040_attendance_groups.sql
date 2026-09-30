-- One row per confirmed attendee/event pair. The event date, not import date,
-- determines first attendance; overlapping active batches count once.
create or replace function public.attendance_group_people(p_workspace_id uuid)
returns table (
  attendee_id uuid,
  events_attended integer,
  first_event_id uuid,
  first_at timestamptz,
  last_event_id uuid,
  last_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  with pairs as (
    select distinct c.attendee_id, e.id as event_id, e.starts_at
    from public.attendance_contributions c
    join public.attendance_batches b on b.id = c.batch_id
      and b.workspace_id = c.workspace_id and b.event_id = c.event_id
    join public.events e on e.id = c.event_id and e.workspace_id = c.workspace_id
    where c.workspace_id = p_workspace_id and b.reverted_at is null
  )
  select p.attendee_id, count(*)::integer,
    (array_agg(p.event_id order by p.starts_at, p.event_id))[1],
    min(p.starts_at),
    (array_agg(p.event_id order by p.starts_at desc, p.event_id desc))[1],
    max(p.starts_at)
  from pairs p group by p.attendee_id;
$$;
revoke all on function public.attendance_group_people(uuid) from public, anon, authenticated;

create or replace function public.get_event_attendance_groups(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  if not exists (select 1 from public.events where workspace_id = p_workspace_id and id = p_event_id) then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  select jsonb_build_object(
    'firstTime', count(*) filter (where g.first_event_id = p_event_id),
    'repeat', count(*) filter (where g.first_event_id <> p_event_id)
  ) into result
  from public.attendance_group_people(p_workspace_id) g
  where exists (
    select 1 from public.attendance_contributions c
    join public.attendance_batches b on b.id = c.batch_id
    where c.workspace_id = p_workspace_id and c.event_id = p_event_id
      and c.attendee_id = g.attendee_id and b.reverted_at is null
  );
  return result;
end;
$$;
revoke all on function public.get_event_attendance_groups(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_event_attendance_groups(uuid, uuid) to authenticated;

create or replace function public.list_event_attendance_groups(p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'eventId', e.id, 'title', e.title, 'startsAt', e.starts_at,
      'firstTime', coalesce(x.first_time, 0), 'repeat', coalesce(x.repeat, 0)
    ) order by e.starts_at, e.id)
    from public.events e
    left join lateral (
      select count(*) filter (where g.first_event_id = e.id) as first_time,
        count(*) filter (where g.first_event_id <> e.id) as repeat
      from public.attendance_group_people(p_workspace_id) g
      where exists (
        select 1 from public.attendance_contributions c
        join public.attendance_batches b on b.id = c.batch_id
        where c.workspace_id = p_workspace_id and c.event_id = e.id
          and c.attendee_id = g.attendee_id and b.reverted_at is null
      )
    ) x on true
    where e.workspace_id = p_workspace_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_event_attendance_groups(uuid) from public, anon, authenticated;
grant execute on function public.list_event_attendance_groups(uuid) to authenticated;

-- Filters select people; displayed totals always describe their full confirmed
-- history, matching get_attendee_detail even with a date range selected.
create or replace function public.list_attendance_groups(
  p_workspace_id uuid, p_query text, p_filters jsonb, p_page integer
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  filters jsonb := coalesce(p_filters, '{}'::jsonb);
  page_number integer := greatest(coalesce(p_page, 1), 1);
  result jsonb;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  if jsonb_typeof(filters) <> 'object'
    or exists (select 1 from jsonb_object_keys(filters) as key(name) where name <> all(array[
      'attendedEventId', 'anyEventIds', 'firstEventId', 'minEvents', 'notSeenSince', 'from', 'to'
    ]))
    or (filters ? 'anyEventIds' and (jsonb_typeof(filters->'anyEventIds') <> 'array'
      or jsonb_array_length(filters->'anyEventIds') > 100))
    or (filters ? 'minEvents' and (filters->>'minEvents')::integer < 1)
  then
    perform public.raise_app_error('VALIDATION', 'Choose valid attendance filters.');
  end if;

  with people as (
    select a.id, a.display_name, a.email_normalized, g.events_attended,
      g.first_event_id, g.first_at, g.last_event_id, g.last_at,
      e.title as last_title, e.status as last_status
    from public.attendance_group_people(p_workspace_id) g
    join public.attendees a on a.id = g.attendee_id and a.workspace_id = p_workspace_id
    join public.events e on e.id = g.last_event_id
    where (
      trim(coalesce(p_query, '')) = ''
      or lower(coalesce(a.display_name, '')) like lower(trim(p_query)) || '%'
      or a.email_normalized like lower(trim(p_query)) || '%'
    )
    and (not (filters ? 'firstEventId') or g.first_event_id = (filters->>'firstEventId')::uuid)
    and (not (filters ? 'minEvents') or g.events_attended >= (filters->>'minEvents')::integer)
    and (not (filters ? 'notSeenSince') or (g.last_at at time zone e.timezone)::date < (filters->>'notSeenSince')::date)
    and (not (filters ? 'attendedEventId') or exists (
      select 1 from public.attendance_contributions c
      join public.attendance_batches b on b.id = c.batch_id
      where c.workspace_id = p_workspace_id and c.attendee_id = a.id
        and c.event_id = (filters->>'attendedEventId')::uuid and b.reverted_at is null
    ))
    and (not (filters ? 'anyEventIds') or exists (
      select 1 from public.attendance_contributions c
      join public.attendance_batches b on b.id = c.batch_id
      where c.workspace_id = p_workspace_id and c.attendee_id = a.id
        and c.event_id in (select value::uuid from jsonb_array_elements_text(filters->'anyEventIds'))
        and b.reverted_at is null
    ))
    and (not (filters ? 'from') or exists (
      select 1 from public.attendance_contributions c
      join public.attendance_batches b on b.id = c.batch_id
      join public.events dated on dated.id = c.event_id
      where c.workspace_id = p_workspace_id and c.attendee_id = a.id and b.reverted_at is null
        and (dated.starts_at at time zone dated.timezone)::date >= (filters->>'from')::date
        and (not (filters ? 'to') or (dated.starts_at at time zone dated.timezone)::date <= (filters->>'to')::date)
    ))
    and ((filters ? 'from') or not (filters ? 'to') or exists (
      select 1 from public.attendance_contributions c
      join public.attendance_batches b on b.id = c.batch_id
      join public.events dated on dated.id = c.event_id
      where c.workspace_id = p_workspace_id and c.attendee_id = a.id and b.reverted_at is null
        and (dated.starts_at at time zone dated.timezone)::date <= (filters->>'to')::date
    ))
  ), paged as (
    select * from people order by last_at desc, id offset (page_number - 1) * 50 limit 50
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.display_name, 'email', p.email_normalized,
      'eventsAttended', p.events_attended, 'firstAttended', p.first_at,
      'lastAttended', p.last_at, 'lastEventId', p.last_event_id,
      'lastEventTitle', p.last_title, 'lastEventStatus', p.last_status,
      'recordedIn', p.last_at
    ) order by p.last_at desc, p.id) from paged p), '[]'::jsonb),
    'total', (select count(*) from people), 'page', page_number,
    'peopleCount', (select count(*) from people),
    'eventCount', (select count(distinct c.event_id)
      from public.attendance_contributions c
      join public.attendance_batches b on b.id = c.batch_id
      where c.workspace_id = p_workspace_id and b.reverted_at is null
        and c.attendee_id in (select id from people))
  ) into result;
  return result;
end;
$$;
revoke all on function public.list_attendance_groups(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.list_attendance_groups(uuid, text, jsonb, integer) to authenticated;
