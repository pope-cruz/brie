alter table public.venues add column booking_steps jsonb not null default '[]'::jsonb;

create function public.venue_booking_steps_json(p_venue public.venues)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when jsonb_array_length(p_venue.booking_steps) > 0 then p_venue.booking_steps
    when p_venue.venue_type = 'nyu_room' then
      '[{"title":"Room request","offsetDays":0},{"title":"Approval","offsetDays":7},{"title":"Confirmed","offsetDays":14}]'::jsonb
    else '[{"title":"Inquiry","offsetDays":0},{"title":"Quote","offsetDays":7},{"title":"Hold","offsetDays":14},{"title":"Confirmed","offsetDays":21}]'::jsonb
  end;
$$;
revoke all on function public.venue_booking_steps_json(public.venues) from public, anon, authenticated;

create function public.get_venue_booking_steps(p_workspace_id uuid, p_venue_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare venue public.venues;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  select * into venue from public.venues where workspace_id = p_workspace_id and id = p_venue_id;
  if venue.id is null then perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.'); end if;
  return jsonb_build_object('steps', public.venue_booking_steps_json(venue),
    'customized', jsonb_array_length(venue.booking_steps) > 0, 'version', venue.version);
end;
$$;
revoke all on function public.get_venue_booking_steps(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_venue_booking_steps(uuid, uuid) to authenticated;

create or replace function public.set_venue_booking_steps(
  p_workspace_id uuid, p_venue_id uuid, p_steps jsonb, p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
  previous_offset integer := -1;
  offset_days integer;
  saved public.venues;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 10 then
    perform public.raise_app_error('VALIDATION', 'Use up to 10 booking steps.');
  end if;
  for item in select value from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(item) <> 'object'
      or char_length(trim(coalesce(item->>'title', ''))) not between 1 and 80
      or coalesce(item->>'offsetDays', '') !~ '^[0-9]{1,3}$'
      or exists (select 1 from jsonb_object_keys(item) as key(name)
        where name <> all(array['title', 'offsetDays']))
    then perform public.raise_app_error('VALIDATION', 'Each step needs a title and offset in days.'); end if;
    offset_days := (item->>'offsetDays')::integer;
    if offset_days > 730 or offset_days < previous_offset then
      perform public.raise_app_error('VALIDATION', 'Step offsets must increase and be at most 730 days.');
    end if;
    previous_offset := offset_days;
  end loop;
  update public.venues set booking_steps = p_steps, version = version + 1
  where id = p_venue_id and workspace_id = p_workspace_id
    and removed_at is null and version = p_expected_version
  returning * into saved;
  if saved.id is null then perform public.raise_app_error('CONFLICT', 'This venue changed. Reload the latest version.'); end if;
  perform public.write_audit(p_workspace_id, 'set_venue_booking_steps', 'venue', saved.id,
    jsonb_build_object('stepCount', jsonb_array_length(p_steps)));
  return jsonb_build_object('steps', public.venue_booking_steps_json(saved),
    'customized', jsonb_array_length(saved.booking_steps) > 0, 'version', saved.version);
end;
$$;
revoke all on function public.set_venue_booking_steps(uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.set_venue_booking_steps(uuid, uuid, jsonb, integer) to authenticated;

create table public.event_bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_id uuid not null,
  venue_id uuid not null,
  lead_time_days integer not null check (lead_time_days between 0 and 730),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  version integer not null default 1,
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id),
  foreign key (workspace_id, venue_id) references public.venues (workspace_id, id)
);
create unique index event_bookings_active_event_idx on public.event_bookings (workspace_id, event_id) where removed_at is null;
create trigger event_bookings_touch before update on public.event_bookings
  for each row execute procedure public.touch_updated_at();
alter table public.event_bookings enable row level security;
revoke all on table public.event_bookings from public, anon, authenticated;

create table public.event_booking_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  booking_id uuid not null,
  position integer not null,
  title text not null check (char_length(title) between 1 and 80),
  offset_days integer not null check (offset_days between 0 and 730),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'blocked', 'complete')),
  status_at timestamptz not null default now(),
  status_by uuid references auth.users (id),
  version integer not null default 1,
  unique (booking_id, position),
  unique (workspace_id, id),
  foreign key (workspace_id, booking_id) references public.event_bookings (workspace_id, id)
);
create index event_booking_steps_order_idx on public.event_booking_steps (booking_id, position);
alter table public.event_booking_steps enable row level security;
revoke all on table public.event_booking_steps from public, anon, authenticated;

create or replace function public.booking_to_json(p_booking public.event_bookings)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  ev public.events;
  venue public.venues;
  current_step public.event_booking_steps;
  steps jsonb;
  start_day date;
begin
  select * into ev from public.events where id = p_booking.event_id;
  select * into venue from public.venues where id = p_booking.venue_id;
  start_day := (ev.starts_at at time zone ev.timezone)::date;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'title', s.title, 'position', s.position,
    'offsetDays', s.offset_days, 'status', s.status,
    'statusAt', s.status_at, 'version', s.version,
    'deadline', start_day - greatest(p_booking.lead_time_days - s.offset_days, 0)
  ) order by s.position), '[]'::jsonb) into steps
  from public.event_booking_steps s where s.booking_id = p_booking.id;
  select * into current_step from public.event_booking_steps
  where booking_id = p_booking.id and status <> 'complete'
  order by position limit 1;
  return jsonb_build_object(
    'id', p_booking.id, 'eventId', p_booking.event_id, 'venueId', p_booking.venue_id,
    'venueName', venue.name, 'venueMismatch', ev.venue_id is distinct from p_booking.venue_id,
    'leadTimeDays', p_booking.lead_time_days,
    'removedAt', p_booking.removed_at, 'version', p_booking.version,
    'steps', steps,
    'currentStatus', case when current_step.id is null then 'Complete'
      when current_step.status = 'not_started' then 'Not started'
      when current_step.status = 'in_progress' then 'In progress'
      else 'Blocked' end,
    'currentStepTitle', current_step.title,
    'nextDeadline', case when current_step.id is null then null
      else start_day - greatest(p_booking.lead_time_days - current_step.offset_days, 0) end
  );
end;
$$;
revoke all on function public.booking_to_json(public.event_bookings) from public, anon, authenticated;

create function public.get_event_booking(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare booking public.event_bookings;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  if not exists (select 1 from public.events where workspace_id = p_workspace_id and id = p_event_id) then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  select * into booking from public.event_bookings
  where workspace_id = p_workspace_id and event_id = p_event_id and removed_at is null;
  if booking.id is null then return null; end if;
  return public.booking_to_json(booking);
end;
$$;
revoke all on function public.get_event_booking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_event_booking(uuid, uuid) to authenticated;

create function public.list_archived_event_bookings(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  if not exists (select 1 from public.events where workspace_id = p_workspace_id and id = p_event_id) then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  return coalesce((select jsonb_agg(public.booking_to_json(b) order by b.removed_at desc)
    from public.event_bookings b where b.workspace_id = p_workspace_id
      and b.event_id = p_event_id and b.removed_at is not null), '[]'::jsonb);
end;
$$;
revoke all on function public.list_archived_event_bookings(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_archived_event_bookings(uuid, uuid) to authenticated;

create or replace function public.start_event_booking(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ev public.events;
  venue public.venues;
  booking public.event_bookings;
  step jsonb;
  step_position integer := 0;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  ev := public.require_event_writable(p_workspace_id, p_event_id);
  if ev.venue_id is null then perform public.raise_app_error('VALIDATION', 'Link a venue before tracking its booking.'); end if;
  select * into venue from public.venues where workspace_id = p_workspace_id and id = ev.venue_id and removed_at is null;
  if venue.id is null then perform public.raise_app_error('VALIDATION', 'Restore the venue before tracking its booking.'); end if;
  select * into booking from public.event_bookings
  where workspace_id = p_workspace_id and event_id = p_event_id and removed_at is null;
  if booking.id is not null then
    if booking.venue_id <> venue.id then
      perform public.raise_app_error('CONFLICT', 'Archive the previous booking before starting a new one.');
    end if;
    return public.booking_to_json(booking);
  end if;
  insert into public.event_bookings (workspace_id, event_id, venue_id, lead_time_days, created_by)
  values (p_workspace_id, p_event_id, venue.id, venue.lead_time_days, auth.uid()) returning * into booking;
  for step in select value from jsonb_array_elements(public.venue_booking_steps_json(venue)) loop
    step_position := step_position + 1;
    insert into public.event_booking_steps (workspace_id, booking_id, position, title, offset_days, status_by)
    values (p_workspace_id, booking.id, step_position, step->>'title', (step->>'offsetDays')::integer, auth.uid());
  end loop;
  perform public.write_audit(p_workspace_id, 'start_event_booking', 'event_booking', booking.id,
    jsonb_build_object('venueId', venue.id));
  return public.booking_to_json(booking);
end;
$$;
revoke all on function public.start_event_booking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_event_booking(uuid, uuid) to authenticated;

create function public.set_booking_step_status(
  p_workspace_id uuid, p_step_id uuid, p_status text, p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  step public.event_booking_steps;
  booking public.event_bookings;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into step from public.event_booking_steps where workspace_id = p_workspace_id and id = p_step_id;
  if step.id is null then perform public.raise_app_error('UNAVAILABLE', 'This booking step isn’t available.'); end if;
  select * into booking from public.event_bookings where id = step.booking_id and workspace_id = p_workspace_id;
  perform public.require_event_writable(p_workspace_id, booking.event_id);
  if booking.removed_at is not null then perform public.raise_app_error('FORBIDDEN', 'Restore this booking before editing it.'); end if;
  if p_status is null or p_status not in ('not_started', 'in_progress', 'blocked', 'complete') then
    perform public.raise_app_error('VALIDATION', 'Choose a booking status.');
  end if;
  update public.event_booking_steps set status = p_status, status_at = now(),
    status_by = auth.uid(), version = version + 1
  where id = p_step_id and workspace_id = p_workspace_id and version = p_expected_version
  returning * into step;
  if step.id is null then perform public.raise_app_error('CONFLICT', 'This booking step changed. Reload it.'); end if;
  update public.event_bookings set version = version + 1 where id = booking.id returning * into booking;
  perform public.write_audit(p_workspace_id, 'set_booking_step_status', 'event_booking', booking.id,
    jsonb_build_object('stepId', p_step_id, 'status', p_status));
  return public.booking_to_json(booking);
end;
$$;
revoke all on function public.set_booking_step_status(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.set_booking_step_status(uuid, uuid, text, integer) to authenticated;

create function public.archive_event_booking(p_workspace_id uuid, p_booking_id uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare booking public.event_bookings;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into booking from public.event_bookings where id = p_booking_id and workspace_id = p_workspace_id;
  if booking.id is null then perform public.raise_app_error('UNAVAILABLE', 'This booking isn’t available.'); end if;
  perform public.require_event_writable(p_workspace_id, booking.event_id);
  update public.event_bookings set removed_at = now(), version = version + 1
  where id = p_booking_id and workspace_id = p_workspace_id
    and version = p_expected_version and removed_at is null
  returning * into booking;
  if booking.id is null then perform public.raise_app_error('CONFLICT', 'This booking changed. Reload it.'); end if;
  perform public.write_audit(p_workspace_id, 'archive_event_booking', 'event_booking', booking.id, '{}'::jsonb);
  return public.booking_to_json(booking);
end;
$$;
revoke all on function public.archive_event_booking(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.archive_event_booking(uuid, uuid, integer) to authenticated;

create or replace function public.restore_event_booking(p_workspace_id uuid, p_booking_id uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare booking public.event_bookings; ev public.events;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into booking from public.event_bookings where id = p_booking_id and workspace_id = p_workspace_id;
  if booking.id is null then perform public.raise_app_error('UNAVAILABLE', 'This booking isn’t available.'); end if;
  ev := public.require_event_writable(p_workspace_id, booking.event_id);
  if ev.venue_id is distinct from booking.venue_id
    or not exists (select 1 from public.venues v where v.id = booking.venue_id and v.removed_at is null)
    or exists (select 1 from public.event_bookings b where b.workspace_id = p_workspace_id
      and b.event_id = booking.event_id and b.removed_at is null)
  then perform public.raise_app_error('CONFLICT', 'This booking cannot be restored for the current venue.'); end if;
  update public.event_bookings set removed_at = null, version = version + 1
  where id = p_booking_id and workspace_id = p_workspace_id
    and version = p_expected_version and removed_at is not null
  returning * into booking;
  if booking.id is null then perform public.raise_app_error('CONFLICT', 'This booking changed. Reload it.'); end if;
  perform public.write_audit(p_workspace_id, 'restore_event_booking', 'event_booking', booking.id, '{}'::jsonb);
  return public.booking_to_json(booking);
end;
$$;
revoke all on function public.restore_event_booking(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.restore_event_booking(uuid, uuid, integer) to authenticated;
