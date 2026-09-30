alter table public.event_bookings
  add column request_draft text not null default '' check (char_length(request_draft) <= 5000),
  add column draft_updated_at timestamptz;

create table public.booking_request_checks (
  workspace_id uuid not null,
  booking_id uuid not null,
  item_key text not null check (item_key in (
    'event_details', 'date_time', 'attendance', 'accessibility',
    'equipment', 'restrictions', 'submit_request'
  )),
  checked_at timestamptz,
  updated_by uuid references auth.users (id),
  version integer not null default 1,
  primary key (booking_id, item_key),
  foreign key (workspace_id, booking_id) references public.event_bookings (workspace_id, id)
);
alter table public.booking_request_checks enable row level security;
revoke all on table public.booking_request_checks from public, anon, authenticated;

create function public.get_booking_request_checks(p_workspace_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  if not exists (select 1 from public.event_bookings b where b.id = p_booking_id and b.workspace_id = p_workspace_id) then
    perform public.raise_app_error('UNAVAILABLE', 'This booking isn’t available.');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'itemKey', c.item_key, 'checkedAt', c.checked_at, 'version', c.version
  ) order by c.item_key) from public.booking_request_checks c
    where c.workspace_id = p_workspace_id and c.booking_id = p_booking_id), '[]'::jsonb);
end;
$$;
revoke all on function public.get_booking_request_checks(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_booking_request_checks(uuid, uuid) to authenticated;

create or replace function public.set_booking_request_check(
  p_workspace_id uuid, p_booking_id uuid, p_item_key text,
  p_checked boolean, p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare booking public.event_bookings; saved public.booking_request_checks;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into booking from public.event_bookings where workspace_id = p_workspace_id and id = p_booking_id;
  if booking.id is null then perform public.raise_app_error('UNAVAILABLE', 'This booking isn’t available.'); end if;
  perform public.require_event_writable(p_workspace_id, booking.event_id);
  if booking.removed_at is not null then perform public.raise_app_error('FORBIDDEN', 'Restore this booking before editing it.'); end if;
  if not exists (select 1 from public.venues v where v.id = booking.venue_id
    and v.workspace_id = p_workspace_id and v.venue_type = 'nyu_room') then
    perform public.raise_app_error('VALIDATION', 'This checklist is for NYU rooms.');
  end if;
  if p_item_key is null or p_item_key not in (
    'event_details', 'date_time', 'attendance', 'accessibility',
    'equipment', 'restrictions', 'submit_request'
  ) or p_checked is null then perform public.raise_app_error('VALIDATION', 'Choose a request checklist item.'); end if;
  if p_expected_version is null then
    insert into public.booking_request_checks (workspace_id, booking_id, item_key, checked_at, updated_by)
    values (p_workspace_id, p_booking_id, p_item_key,
      case when p_checked then now() else null end, auth.uid())
    on conflict (booking_id, item_key) do nothing returning * into saved;
  else
    update public.booking_request_checks set
      checked_at = case when p_checked then now() else null end,
      updated_by = auth.uid(), version = version + 1
    where workspace_id = p_workspace_id and booking_id = p_booking_id
      and item_key = p_item_key and version = p_expected_version
    returning * into saved;
  end if;
  if saved.item_key is null then perform public.raise_app_error('CONFLICT', 'This checklist changed. Reload it.'); end if;
  perform public.write_audit(p_workspace_id, 'set_booking_request_check', 'event_booking', booking.id,
    jsonb_build_object('itemKey', p_item_key, 'checked', p_checked));
  return jsonb_build_object('itemKey', saved.item_key, 'checkedAt', saved.checked_at, 'version', saved.version);
end;
$$;
revoke all on function public.set_booking_request_check(uuid, uuid, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.set_booking_request_check(uuid, uuid, text, boolean, integer) to authenticated;

create function public.get_booking_request_draft(p_workspace_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare booking public.event_bookings;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into booking from public.event_bookings where workspace_id = p_workspace_id and id = p_booking_id;
  if booking.id is null then perform public.raise_app_error('UNAVAILABLE', 'This booking isn’t available.'); end if;
  return jsonb_build_object('draft', booking.request_draft,
    'updatedAt', booking.draft_updated_at, 'version', booking.version);
end;
$$;
revoke all on function public.get_booking_request_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_booking_request_draft(uuid, uuid) to authenticated;

create or replace function public.save_booking_request_draft(
  p_workspace_id uuid, p_booking_id uuid, p_draft text, p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare booking public.event_bookings;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into booking from public.event_bookings where workspace_id = p_workspace_id and id = p_booking_id;
  if booking.id is null then perform public.raise_app_error('UNAVAILABLE', 'This booking isn’t available.'); end if;
  perform public.require_event_writable(p_workspace_id, booking.event_id);
  if not exists (select 1 from public.venues v where v.id = booking.venue_id
    and v.workspace_id = p_workspace_id and v.venue_type = 'outside') then
    perform public.raise_app_error('VALIDATION', 'Email drafts are for outside venues.');
  end if;
  if p_draft is null or char_length(p_draft) > 5000 then
    perform public.raise_app_error('VALIDATION', 'The request draft must be 5,000 characters or fewer.');
  end if;
  update public.event_bookings set request_draft = p_draft,
    draft_updated_at = now(), version = version + 1
  where id = p_booking_id and workspace_id = p_workspace_id
    and removed_at is null and version = p_expected_version
  returning * into booking;
  if booking.id is null then perform public.raise_app_error('CONFLICT', 'This booking changed. Reload it.'); end if;
  perform public.write_audit(p_workspace_id, 'save_booking_request_draft', 'event_booking', booking.id,
    jsonb_build_object('length', char_length(p_draft)));
  return jsonb_build_object('draft', booking.request_draft,
    'updatedAt', booking.draft_updated_at, 'version', booking.version);
end;
$$;
revoke all on function public.save_booking_request_draft(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.save_booking_request_draft(uuid, uuid, text, integer) to authenticated;

create table public.booking_log_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  booking_id uuid not null,
  entry_type text not null check (entry_type in ('reply', 'quote', 'hold', 'confirmation')),
  occurred_at timestamptz not null,
  notes text not null check (char_length(notes) between 1 and 4000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  version integer not null default 1,
  unique (workspace_id, id),
  foreign key (workspace_id, booking_id) references public.event_bookings (workspace_id, id)
);
create index booking_log_entries_booking_idx on public.booking_log_entries (workspace_id, booking_id, occurred_at desc, id);
create trigger booking_log_entries_touch before update on public.booking_log_entries
  for each row execute procedure public.touch_updated_at();
alter table public.booking_log_entries enable row level security;
revoke all on table public.booking_log_entries from public, anon, authenticated;

create function public.list_booking_log_entries(
  p_workspace_id uuid, p_booking_id uuid, p_include_archived boolean
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  if not exists (select 1 from public.event_bookings where workspace_id = p_workspace_id and id = p_booking_id) then
    perform public.raise_app_error('UNAVAILABLE', 'This booking isn’t available.');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', l.id, 'entryType', l.entry_type, 'occurredAt', l.occurred_at,
    'notes', l.notes, 'createdBy', coalesce(pr.display_name, 'Organizer'),
    'removedAt', l.removed_at, 'version', l.version
  ) order by l.occurred_at desc, l.id)
    from public.booking_log_entries l
    left join public.profiles pr on pr.user_id = l.created_by
    where l.workspace_id = p_workspace_id and l.booking_id = p_booking_id
      and (coalesce(p_include_archived, false) or l.removed_at is null)), '[]'::jsonb);
end;
$$;
revoke all on function public.list_booking_log_entries(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.list_booking_log_entries(uuid, uuid, boolean) to authenticated;

create function public.save_booking_log_entry(
  p_workspace_id uuid, p_booking_id uuid, p_entry_id uuid,
  p_entry_type text, p_occurred_at timestamptz, p_notes text,
  p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare booking public.event_bookings; saved public.booking_log_entries;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into booking from public.event_bookings where workspace_id = p_workspace_id and id = p_booking_id;
  if booking.id is null then perform public.raise_app_error('UNAVAILABLE', 'This booking isn’t available.'); end if;
  perform public.require_event_writable(p_workspace_id, booking.event_id);
  if booking.removed_at is not null then perform public.raise_app_error('FORBIDDEN', 'Restore this booking before editing it.'); end if;
  if p_entry_type is null or p_entry_type not in ('reply', 'quote', 'hold', 'confirmation')
    or p_occurred_at is null or char_length(trim(coalesce(p_notes, ''))) not between 1 and 4000
  then perform public.raise_app_error('VALIDATION', 'Enter a dated booking note.'); end if;
  if p_entry_id is null then
    insert into public.booking_log_entries (workspace_id, booking_id, entry_type, occurred_at, notes, created_by)
    values (p_workspace_id, p_booking_id, p_entry_type, p_occurred_at, trim(p_notes), auth.uid())
    returning * into saved;
    perform public.write_audit(p_workspace_id, 'create_booking_log_entry', 'booking_log_entry', saved.id,
      jsonb_build_object('type', p_entry_type));
  else
    update public.booking_log_entries set entry_type = p_entry_type,
      occurred_at = p_occurred_at, notes = trim(p_notes), version = version + 1
    where id = p_entry_id and workspace_id = p_workspace_id and booking_id = p_booking_id
      and removed_at is null and version = p_expected_version
    returning * into saved;
    if saved.id is null then perform public.raise_app_error('CONFLICT', 'This booking note changed. Reload it.'); end if;
    perform public.write_audit(p_workspace_id, 'update_booking_log_entry', 'booking_log_entry', saved.id,
      jsonb_build_object('type', p_entry_type));
  end if;
  return jsonb_build_object('id', saved.id, 'entryType', saved.entry_type,
    'occurredAt', saved.occurred_at, 'notes', saved.notes,
    'removedAt', saved.removed_at, 'version', saved.version);
end;
$$;
revoke all on function public.save_booking_log_entry(uuid, uuid, uuid, text, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.save_booking_log_entry(uuid, uuid, uuid, text, timestamptz, text, integer) to authenticated;

create or replace function public.archive_booking_log_entry(p_workspace_id uuid, p_entry_id uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare saved public.booking_log_entries; booking public.event_bookings;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into saved from public.booking_log_entries where id = p_entry_id and workspace_id = p_workspace_id;
  if saved.id is null then perform public.raise_app_error('UNAVAILABLE', 'This booking note isn’t available.'); end if;
  select * into booking from public.event_bookings where id = saved.booking_id;
  perform public.require_event_writable(p_workspace_id, booking.event_id);
  if booking.removed_at is not null then perform public.raise_app_error('FORBIDDEN', 'Restore this booking first.'); end if;
  update public.booking_log_entries set removed_at = now(), version = version + 1
  where id = p_entry_id and workspace_id = p_workspace_id
    and version = p_expected_version and removed_at is null returning * into saved;
  if saved.id is null then perform public.raise_app_error('CONFLICT', 'This booking note changed. Reload it.'); end if;
  perform public.write_audit(p_workspace_id, 'archive_booking_log_entry', 'booking_log_entry', saved.id, '{}'::jsonb);
  return jsonb_build_object('id', saved.id, 'removedAt', saved.removed_at, 'version', saved.version);
end;
$$;
revoke all on function public.archive_booking_log_entry(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.archive_booking_log_entry(uuid, uuid, integer) to authenticated;

create function public.restore_booking_log_entry(p_workspace_id uuid, p_entry_id uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare saved public.booking_log_entries; booking public.event_bookings;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into saved from public.booking_log_entries where id = p_entry_id and workspace_id = p_workspace_id;
  if saved.id is null then perform public.raise_app_error('UNAVAILABLE', 'This booking note isn’t available.'); end if;
  select * into booking from public.event_bookings where id = saved.booking_id;
  perform public.require_event_writable(p_workspace_id, booking.event_id);
  if booking.removed_at is not null then perform public.raise_app_error('FORBIDDEN', 'Restore this booking first.'); end if;
  update public.booking_log_entries set removed_at = null, version = version + 1
  where id = p_entry_id and workspace_id = p_workspace_id
    and version = p_expected_version and removed_at is not null returning * into saved;
  if saved.id is null then perform public.raise_app_error('CONFLICT', 'This booking note changed. Reload it.'); end if;
  perform public.write_audit(p_workspace_id, 'restore_booking_log_entry', 'booking_log_entry', saved.id, '{}'::jsonb);
  return jsonb_build_object('id', saved.id, 'removedAt', saved.removed_at, 'version', saved.version);
end;
$$;
revoke all on function public.restore_booking_log_entry(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.restore_booking_log_entry(uuid, uuid, integer) to authenticated;
