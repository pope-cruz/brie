create table public.venues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  name text not null check (char_length(name) between 1 and 120),
  venue_type text not null default 'outside' check (venue_type in ('nyu_room', 'outside')),
  capacity integer check (capacity is null or capacity >= 0),
  address text not null default '' check (char_length(address) <= 300),
  cost_notes text not null default '' check (char_length(cost_notes) <= 2000),
  accessibility text not null default '' check (char_length(accessibility) <= 2000),
  equipment text not null default '' check (char_length(equipment) <= 2000),
  booking_contact text not null default '' check (char_length(booking_contact) <= 300),
  booking_link text not null default '' check (char_length(booking_link) <= 500),
  lead_time_days integer not null default 0 check (lead_time_days between 0 and 730),
  restrictions text not null default '' check (char_length(restrictions) <= 2000),
  notes text not null default '' check (char_length(notes) <= 4000),
  removed_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (workspace_id, id)
);
create index venues_workspace_idx on public.venues (workspace_id, removed_at, lower(name), id);
create trigger venues_touch before update on public.venues
  for each row execute procedure public.touch_updated_at();
alter table public.venues enable row level security;
revoke all on table public.venues from public, anon, authenticated;

alter table public.events add column venue_id uuid;
alter table public.events add constraint events_workspace_venue_fk
  foreign key (workspace_id, venue_id) references public.venues (workspace_id, id);
create index events_venue_idx on public.events (workspace_id, venue_id, starts_at desc);

create function public.venue_to_json(p_venue public.venues)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_venue.id, 'workspaceId', p_venue.workspace_id,
    'name', p_venue.name, 'venueType', p_venue.venue_type,
    'capacity', p_venue.capacity, 'address', p_venue.address,
    'costNotes', p_venue.cost_notes, 'accessibility', p_venue.accessibility,
    'equipment', p_venue.equipment, 'bookingContact', p_venue.booking_contact,
    'bookingLink', p_venue.booking_link, 'leadTimeDays', p_venue.lead_time_days,
    'restrictions', p_venue.restrictions, 'notes', p_venue.notes,
    'removedAt', p_venue.removed_at, 'version', p_venue.version
  );
$$;
revoke all on function public.venue_to_json(public.venues) from public, anon, authenticated;

create function public.list_venues(p_workspace_id uuid, p_include_archived boolean)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  return coalesce((
    select jsonb_agg(public.venue_to_json(v) order by lower(v.name), v.id)
    from public.venues v
    where v.workspace_id = p_workspace_id
      and (coalesce(p_include_archived, false) or v.removed_at is null)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_venues(uuid, boolean) from public, anon, authenticated;
grant execute on function public.list_venues(uuid, boolean) to authenticated;

create function public.get_venue(p_workspace_id uuid, p_venue_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare venue public.venues;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  select * into venue from public.venues where workspace_id = p_workspace_id and id = p_venue_id;
  if venue.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  return public.venue_to_json(venue) || jsonb_build_object('pastEvents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'startsAt', e.starts_at,
      'timezone', e.timezone, 'location', e.location
    ) order by e.starts_at desc, e.id)
    from public.events e
    where e.workspace_id = p_workspace_id and e.venue_id = p_venue_id
      and e.ends_at < now() and e.status <> 'canceled'
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_venue(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_venue(uuid, uuid) to authenticated;

create function public.save_venue(
  p_workspace_id uuid, p_venue_id uuid, p_name text, p_venue_type text,
  p_capacity integer, p_address text, p_cost_notes text, p_accessibility text,
  p_equipment text, p_booking_contact text, p_booking_link text,
  p_lead_time_days integer, p_restrictions text, p_notes text,
  p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare saved public.venues;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 120
    or p_venue_type is null or p_venue_type not in ('nyu_room', 'outside')
    or (p_capacity is not null and p_capacity < 0)
    or char_length(coalesce(p_address, '')) > 300
    or char_length(coalesce(p_cost_notes, '')) > 2000
    or char_length(coalesce(p_accessibility, '')) > 2000
    or char_length(coalesce(p_equipment, '')) > 2000
    or char_length(coalesce(p_booking_contact, '')) > 300
    or char_length(coalesce(p_booking_link, '')) > 500
    or (coalesce(p_booking_link, '') <> '' and p_booking_link !~* '^https?://[^[:space:]]+$')
    or p_lead_time_days is null or p_lead_time_days not between 0 and 730
    or char_length(coalesce(p_restrictions, '')) > 2000
    or char_length(coalesce(p_notes, '')) > 4000
  then
    perform public.raise_app_error('VALIDATION', 'Check the venue details and try again.');
  end if;
  if p_venue_id is null then
    insert into public.venues (workspace_id, name, venue_type, capacity, address,
      cost_notes, accessibility, equipment, booking_contact, booking_link,
      lead_time_days, restrictions, notes, created_by)
    values (p_workspace_id, trim(p_name), p_venue_type, p_capacity, coalesce(p_address, ''),
      coalesce(p_cost_notes, ''), coalesce(p_accessibility, ''), coalesce(p_equipment, ''),
      coalesce(p_booking_contact, ''), coalesce(p_booking_link, ''),
      p_lead_time_days, coalesce(p_restrictions, ''), coalesce(p_notes, ''), auth.uid())
    returning * into saved;
    perform public.write_audit(p_workspace_id, 'create_venue', 'venue', saved.id, '{}'::jsonb);
  else
    update public.venues set name = trim(p_name), venue_type = p_venue_type,
      capacity = p_capacity, address = coalesce(p_address, ''),
      cost_notes = coalesce(p_cost_notes, ''), accessibility = coalesce(p_accessibility, ''),
      equipment = coalesce(p_equipment, ''), booking_contact = coalesce(p_booking_contact, ''),
      booking_link = coalesce(p_booking_link, ''), lead_time_days = p_lead_time_days,
      restrictions = coalesce(p_restrictions, ''), notes = coalesce(p_notes, ''),
      version = version + 1
    where id = p_venue_id and workspace_id = p_workspace_id
      and removed_at is null and version = p_expected_version
    returning * into saved;
    if saved.id is null then
      perform public.raise_app_error('CONFLICT', 'This venue changed. Reload the latest version.');
    end if;
    perform public.write_audit(p_workspace_id, 'update_venue', 'venue', saved.id, '{}'::jsonb);
  end if;
  return public.venue_to_json(saved);
end;
$$;
revoke all on function public.save_venue(uuid, uuid, text, text, integer, text, text, text, text, text, text, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.save_venue(uuid, uuid, text, text, integer, text, text, text, text, text, text, integer, text, text, integer) to authenticated;

create function public.archive_venue(p_workspace_id uuid, p_venue_id uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare saved public.venues;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  update public.venues set removed_at = now(), version = version + 1
  where id = p_venue_id and workspace_id = p_workspace_id
    and version = p_expected_version and removed_at is null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This venue changed. Reload the latest version.');
  end if;
  perform public.write_audit(p_workspace_id, 'archive_venue', 'venue', saved.id, '{}'::jsonb);
  return public.venue_to_json(saved);
end;
$$;
revoke all on function public.archive_venue(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.archive_venue(uuid, uuid, integer) to authenticated;

create function public.restore_venue(p_workspace_id uuid, p_venue_id uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare saved public.venues;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  update public.venues set removed_at = null, version = version + 1
  where id = p_venue_id and workspace_id = p_workspace_id
    and version = p_expected_version and removed_at is not null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This venue changed. Reload the latest version.');
  end if;
  perform public.write_audit(p_workspace_id, 'restore_venue', 'venue', saved.id, '{}'::jsonb);
  return public.venue_to_json(saved);
end;
$$;
revoke all on function public.restore_venue(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.restore_venue(uuid, uuid, integer) to authenticated;

create function public.get_event_venue(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare ev public.events;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  select * into ev from public.events where id = p_event_id and workspace_id = p_workspace_id;
  if ev.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  return jsonb_build_object('venueId', ev.venue_id, 'venueName',
    (select v.name from public.venues v where v.id = ev.venue_id), 'version', ev.version);
end;
$$;
revoke all on function public.get_event_venue(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_event_venue(uuid, uuid) to authenticated;

create function public.set_event_venue(
  p_workspace_id uuid, p_event_id uuid, p_venue_id uuid, p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare saved public.events;
begin
  perform public.require_event_writable(p_workspace_id, p_event_id);
  if p_venue_id is not null and not exists (
    select 1 from public.venues where workspace_id = p_workspace_id
      and id = p_venue_id and removed_at is null
  ) then
    perform public.raise_app_error('VALIDATION', 'Choose an active venue in this workspace.');
  end if;
  update public.events set venue_id = p_venue_id, version = version + 1
  where id = p_event_id and workspace_id = p_workspace_id
    and version = p_expected_version and archived_at is null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This event changed. Reload the latest version.');
  end if;
  perform public.write_audit(p_workspace_id, 'set_event_venue', 'event', p_event_id,
    jsonb_build_object('venueId', p_venue_id));
  return jsonb_build_object('venueId', saved.venue_id, 'version', saved.version);
end;
$$;
revoke all on function public.set_event_venue(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.set_event_venue(uuid, uuid, uuid, integer) to authenticated;
