create table public.attendance_export_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  created_by uuid not null references auth.users (id),
  fields text[] not null,
  filters jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour'
);
create index attendance_export_sessions_expiry_idx on public.attendance_export_sessions (expires_at);
alter table public.attendance_export_sessions enable row level security;
revoke all on table public.attendance_export_sessions from public, anon, authenticated;

create or replace function public.begin_workspace_attendance_export(
  p_workspace_id uuid, p_fields text[], p_filters jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  selected text[] := coalesce(p_fields, '{}'::text[]);
  filters jsonb := coalesce(p_filters, '{}'::jsonb);
  saved public.attendance_export_sessions;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  if cardinality(selected) < 1 or cardinality(selected) > 7
    or cardinality(selected) <> (select count(distinct field) from unnest(selected) field)
    or exists (select 1 from unnest(selected) field where field is null or field <> all(array[
      'name', 'email', 'eventsAttended', 'firstAttended', 'lastAttended', 'eventTitles', 'sources'
    ]))
    or jsonb_typeof(filters) <> 'object'
    or exists (select 1 from jsonb_object_keys(filters) as key(name) where name <> all(array[
      'attendedEventId', 'anyEventIds', 'firstEventId', 'minEvents', 'notSeenSince', 'from', 'to'
    ]))
    or (filters ? 'anyEventIds' and (jsonb_typeof(filters->'anyEventIds') <> 'array'
      or jsonb_array_length(filters->'anyEventIds') > 100))
    or (filters ? 'minEvents' and (filters->>'minEvents')::integer < 1)
  then
    perform public.raise_app_error('VALIDATION', 'Choose export fields and attendance filters.');
  end if;

  insert into public.attendance_export_sessions (workspace_id, created_by, fields, filters)
  values (p_workspace_id, auth.uid(), selected, filters) returning * into saved;
  perform public.write_audit(p_workspace_id, 'export_workspace_attendance', 'attendance_export',
    saved.id, jsonb_build_object('fields', selected, 'filters', filters));
  return jsonb_build_object('id', saved.id);
end;
$$;
revoke all on function public.begin_workspace_attendance_export(uuid, text[], jsonb) from public, anon, authenticated;
grant execute on function public.begin_workspace_attendance_export(uuid, text[], jsonb) to authenticated;

create or replace function public.export_workspace_attendance(
  p_workspace_id uuid, p_export_id uuid, p_after_attendee_id uuid, p_limit integer
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  session public.attendance_export_sessions;
  result jsonb;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into session from public.attendance_export_sessions
  where id = p_export_id and workspace_id = p_workspace_id
    and created_by = auth.uid() and expires_at > now();
  if session.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This export isn’t available. Start another export.');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    perform public.raise_app_error('VALIDATION', 'Export up to 1,000 people per page.');
  end if;

  with people as (
    select a.id, a.display_name, a.email_normalized, g.events_attended,
      g.first_event_id, g.first_at, g.last_event_id, g.last_at
    from public.attendance_group_people(p_workspace_id) g
    join public.attendees a on a.id = g.attendee_id and a.workspace_id = p_workspace_id
    join public.events last_event on last_event.id = g.last_event_id
    where (p_after_attendee_id is null or a.id > p_after_attendee_id)
      and (not (session.filters ? 'firstEventId') or g.first_event_id = (session.filters->>'firstEventId')::uuid)
      and (not (session.filters ? 'minEvents') or g.events_attended >= (session.filters->>'minEvents')::integer)
      and (not (session.filters ? 'notSeenSince') or
        (g.last_at at time zone last_event.timezone)::date < (session.filters->>'notSeenSince')::date)
      and (not (session.filters ? 'attendedEventId') or exists (
        select 1 from public.attendance_contributions c
        join public.attendance_batches b on b.id = c.batch_id
        where c.workspace_id = p_workspace_id and c.attendee_id = a.id
          and c.event_id = (session.filters->>'attendedEventId')::uuid and b.reverted_at is null
      ))
      and (not (session.filters ? 'anyEventIds') or exists (
        select 1 from public.attendance_contributions c
        join public.attendance_batches b on b.id = c.batch_id
        where c.workspace_id = p_workspace_id and c.attendee_id = a.id
          and c.event_id in (select value::uuid from jsonb_array_elements_text(session.filters->'anyEventIds'))
          and b.reverted_at is null
      ))
      and (not (session.filters ? 'from') or exists (
        select 1 from public.attendance_contributions c
        join public.attendance_batches b on b.id = c.batch_id
        join public.events dated on dated.id = c.event_id
        where c.workspace_id = p_workspace_id and c.attendee_id = a.id and b.reverted_at is null
          and (dated.starts_at at time zone dated.timezone)::date >= (session.filters->>'from')::date
          and (not (session.filters ? 'to') or (dated.starts_at at time zone dated.timezone)::date <= (session.filters->>'to')::date)
      ))
      and ((session.filters ? 'from') or not (session.filters ? 'to') or exists (
        select 1 from public.attendance_contributions c
        join public.attendance_batches b on b.id = c.batch_id
        join public.events dated on dated.id = c.event_id
        where c.workspace_id = p_workspace_id and c.attendee_id = a.id and b.reverted_at is null
          and (dated.starts_at at time zone dated.timezone)::date <= (session.filters->>'to')::date
      ))
    order by a.id limit p_limit
  ), shaped as (
    select p.id,
      (case when 'name' = any(session.fields) then jsonb_build_object('name', p.display_name) else '{}'::jsonb end)
      || (case when 'email' = any(session.fields) then jsonb_build_object('email', p.email_normalized) else '{}'::jsonb end)
      || (case when 'eventsAttended' = any(session.fields) then jsonb_build_object('eventsAttended', p.events_attended) else '{}'::jsonb end)
      || (case when 'firstAttended' = any(session.fields) then jsonb_build_object('firstAttended',
        (p.first_at at time zone first_event.timezone)::date) else '{}'::jsonb end)
      || (case when 'lastAttended' = any(session.fields) then jsonb_build_object('lastAttended',
        (p.last_at at time zone last_event.timezone)::date) else '{}'::jsonb end)
      || (case when 'eventTitles' = any(session.fields) then jsonb_build_object('eventTitles', titles.items) else '{}'::jsonb end)
      || (case when 'sources' = any(session.fields) then jsonb_build_object('sources', sources.items) else '{}'::jsonb end) as item
    from people p
    join public.events first_event on first_event.id = p.first_event_id
    join public.events last_event on last_event.id = p.last_event_id
    left join lateral (
      select coalesce(jsonb_agg(e.title order by e.starts_at, e.id), '[]'::jsonb) as items
      from public.events e
      where e.workspace_id = p_workspace_id and exists (
        select 1 from public.attendance_contributions c
        join public.attendance_batches b on b.id = c.batch_id
        where c.workspace_id = p_workspace_id and c.attendee_id = p.id
          and c.event_id = e.id and b.reverted_at is null
      )
    ) titles on true
    left join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('fileLabel', b.file_label,
        'rowNumber', c.source_row_number) order by e.starts_at, e.id, b.committed_at, b.id), '[]'::jsonb) as items
      from public.attendance_contributions c
      join public.attendance_batches b on b.id = c.batch_id
      join public.events e on e.id = c.event_id
      where c.workspace_id = p_workspace_id and c.attendee_id = p.id and b.reverted_at is null
    ) sources on true
  )
  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(s.item order by s.id), '[]'::jsonb),
    'nextAfter', (select id from shaped order by id desc limit 1),
    'count', count(*)
  ) into result from shaped s;
  return result;
end;
$$;
revoke all on function public.export_workspace_attendance(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.export_workspace_attendance(uuid, uuid, uuid, integer) to authenticated;
