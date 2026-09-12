create or replace function public.list_event_people(
  p_workspace_id uuid,
  p_event_id uuid,
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
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  page := greatest(coalesce(p_page, 1), 1);
  q := lower(trim(coalesce(p_query, '')));

  with people as (
    select a.id, a.display_name, a.email_normalized,
      max(b.committed_at) as recorded_in
    from public.attendees a
    join public.attendance_contributions c on c.attendee_id = a.id
    join public.attendance_batches b on b.id = c.batch_id
    where a.workspace_id = p_workspace_id
      and c.event_id = p_event_id
      and b.reverted_at is null
      and (
        q = ''
        or lower(coalesce(a.display_name, '')) like q || '%'
        or a.email_normalized like q || '%'
      )
    group by a.id, a.display_name, a.email_normalized
  )
  select count(*) into total from people;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.display_name,
    'email', p.email_normalized,
    'eventsAttended', 1,
    'lastAttended', p.recorded_in,
    'lastEventId', p_event_id,
    'lastEventTitle', null,
    'lastEventStatus', null,
    'recordedIn', p.recorded_in
  ) order by lower(coalesce(p.display_name, p.email_normalized)), p.id), '[]'::jsonb)
  into rows
  from (
    select *
    from (
      select a.id, a.display_name, a.email_normalized, max(b.committed_at) as recorded_in
      from public.attendees a
      join public.attendance_contributions c on c.attendee_id = a.id
      join public.attendance_batches b on b.id = c.batch_id
      where a.workspace_id = p_workspace_id
        and c.event_id = p_event_id
        and b.reverted_at is null
        and (
          q = ''
          or lower(coalesce(a.display_name, '')) like q || '%'
          or a.email_normalized like q || '%'
        )
      group by a.id, a.display_name, a.email_normalized
    ) x
    order by lower(coalesce(x.display_name, x.email_normalized)), x.id
    offset (page - 1) * 50
    limit 50
  ) p;

  return jsonb_build_object('rows', rows, 'total', total, 'page', page);
end;
$$;

create or replace function public.list_event_imports(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  return coalesce((
    select jsonb_agg(public.receipt_to_json(b) order by b.committed_at desc)
    from public.attendance_batches b
    where b.workspace_id = p_workspace_id and b.event_id = p_event_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_import_receipt(p_workspace_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  batch public.attendance_batches;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into batch from public.attendance_batches where id = p_batch_id and workspace_id = p_workspace_id;
  if batch.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  return public.receipt_to_json(batch);
end;
$$;

create or replace function public.list_attendance_history(
  p_workspace_id uuid,
  p_query text,
  p_from date,
  p_to date,
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
  people_count integer;
  event_count integer;
  rows jsonb;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  page := greatest(coalesce(p_page, 1), 1);
  q := lower(trim(coalesce(p_query, '')));

  with attended as (
    select a.id, a.display_name, a.email_normalized, e.id as event_id, e.title, e.status, e.starts_at, e.timezone
    from public.attendees a
    join public.attendance_contributions c on c.attendee_id = a.id
    join public.attendance_batches b on b.id = c.batch_id
    join public.events e on e.id = c.event_id
    where a.workspace_id = p_workspace_id
      and b.reverted_at is null
      and (p_from is null or (e.starts_at at time zone e.timezone)::date >= p_from)
      and (p_to is null or (e.starts_at at time zone e.timezone)::date <= p_to)
      and (
        q = ''
        or lower(coalesce(a.display_name, '')) like q || '%'
        or a.email_normalized like q || '%'
      )
  ),
  people as (
    select id, display_name, email_normalized,
      count(distinct event_id)::integer as events_attended
    from attended
    group by id, display_name, email_normalized
  ),
  paged as (
    select pe.id, pe.display_name, pe.email_normalized, pe.events_attended,
      (array_agg(atd.title order by atd.starts_at desc, atd.event_id))[1] as last_title,
      (array_agg(atd.event_id order by atd.starts_at desc, atd.event_id))[1] as last_event_id,
      (array_agg(atd.status order by atd.starts_at desc, atd.event_id))[1] as last_status,
      max(atd.starts_at) as last_start
    from people pe
    join attended atd on atd.id = pe.id
    group by pe.id, pe.display_name, pe.email_normalized, pe.events_attended
    order by max(atd.starts_at) desc, pe.id
    offset (page - 1) * 50
    limit 50
  )
  select
    (select count(*) from people),
    (select count(distinct event_id) from attended),
    (select count(*) from people),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.display_name,
        'email', p.email_normalized,
        'eventsAttended', p.events_attended,
        'lastAttended', p.last_start,
        'lastEventId', p.last_event_id,
        'lastEventTitle', p.last_title,
        'lastEventStatus', p.last_status,
        'recordedIn', p.last_start
      ) order by p.last_start desc, p.id)
      from paged p
    ), '[]'::jsonb)
  into people_count, event_count, total, rows;

  return jsonb_build_object(
    'rows', rows,
    'total', total,
    'page', page,
    'peopleCount', people_count,
    'eventCount', event_count
  );
end;
$$;

create or replace function public.get_attendee_detail(p_workspace_id uuid, p_attendee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  person public.attendees;
  events jsonb;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into person from public.attendees where id = p_attendee_id and workspace_id = p_workspace_id;
  if person.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', e.id,
    'title', e.title,
    'startsAt', e.starts_at,
    'timezone', e.timezone,
    'status', e.status,
    'archivedAt', e.archived_at,
    'batches', batches
  ) order by e.starts_at desc, e.id), '[]'::jsonb)
  into events
  from public.events e
  join lateral (
    select jsonb_agg(jsonb_build_object('id', b.id, 'fileLabel', b.file_label, 'committedAt', b.committed_at) order by b.committed_at desc) as batches
    from public.attendance_contributions c
    join public.attendance_batches b on b.id = c.batch_id
    where c.event_id = e.id
      and c.attendee_id = person.id
      and b.reverted_at is null
  ) src on src.batches is not null
  where e.workspace_id = p_workspace_id;

  if events = '[]'::jsonb then
    return jsonb_build_object(
      'id', person.id,
      'name', person.display_name,
      'email', person.email_normalized,
      'eventsAttended', 0,
      'firstAttended', null,
      'lastAttended', null,
      'events', events
    );
  end if;

  return jsonb_build_object(
    'id', person.id,
    'name', person.display_name,
    'email', person.email_normalized,
    'eventsAttended', jsonb_array_length(events),
    'firstAttended', (select min(e.starts_at) from public.events e where e.id in (
      select (item ->> 'eventId')::uuid from jsonb_array_elements(events) item
    )),
    'lastAttended', (select max(e.starts_at) from public.events e where e.id in (
      select (item ->> 'eventId')::uuid from jsonb_array_elements(events) item
    )),
    'events', events
  );
end;
$$;

revoke all on function public.list_event_people(uuid, uuid, text, integer) from public, anon;
revoke all on function public.list_event_imports(uuid, uuid) from public, anon;
revoke all on function public.get_import_receipt(uuid, uuid) from public, anon;
revoke all on function public.list_attendance_history(uuid, text, date, date, integer) from public, anon;
revoke all on function public.get_attendee_detail(uuid, uuid) from public, anon;
grant execute on function public.list_event_people(uuid, uuid, text, integer) to authenticated;
grant execute on function public.list_event_imports(uuid, uuid) to authenticated;
grant execute on function public.get_import_receipt(uuid, uuid) to authenticated;
grant execute on function public.list_attendance_history(uuid, text, date, date, integer) to authenticated;
grant execute on function public.get_attendee_detail(uuid, uuid) to authenticated;
