create table public.attendees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  email_normalized text not null,
  display_name text check (display_name is null or char_length(display_name) <= 200),
  created_at timestamptz not null default now(),
  unique (workspace_id, email_normalized),
  unique (workspace_id, id)
);

create table public.event_attendance_revisions (
  workspace_id uuid not null,
  event_id uuid not null,
  version integer not null default 1,
  primary key (workspace_id, event_id),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id)
);

create table public.import_previews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_id uuid not null,
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  attendance_version integer not null,
  parser_version text not null,
  mapping jsonb not null default '{}'::jsonb,
  file_label text not null check (char_length(file_label) between 1 and 120),
  file_hash text not null,
  accepted_rows jsonb not null,
  outcome_counts jsonb not null,
  row_outcomes jsonb not null,
  skip_invalid_ack boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id)
);

create table public.attendance_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_id uuid not null,
  created_by uuid not null references auth.users (id),
  committed_at timestamptz not null default now(),
  file_label text not null,
  file_hash text not null,
  parser_version text not null,
  outcome_counts jsonb not null,
  idempotency_key text not null,
  preview_id uuid not null unique,
  reverted_at timestamptz,
  reverted_by uuid references auth.users (id),
  version integer not null default 1,
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id)
);

create table public.attendance_contributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_id uuid not null,
  batch_id uuid not null,
  attendee_id uuid not null,
  source_row_number integer not null,
  unique (batch_id, attendee_id),
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id),
  foreign key (workspace_id, batch_id) references public.attendance_batches (workspace_id, id),
  foreign key (workspace_id, attendee_id) references public.attendees (workspace_id, id)
);

create index attendees_lookup_idx on public.attendees (workspace_id, email_normalized);
create index attendees_name_prefix_idx on public.attendees (workspace_id, lower(coalesce(display_name, '')));
create index batches_event_idx on public.attendance_batches (workspace_id, event_id, committed_at desc, id);
create index contributions_active_idx on public.attendance_contributions (workspace_id, event_id, attendee_id, batch_id);
create index previews_expiry_idx on public.import_previews (expires_at);

create or replace function public.require_attendance_event(p_workspace_id uuid, p_event_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into ev from public.events where id = p_event_id and workspace_id = p_workspace_id;
  if ev.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  if ev.archived_at is not null then
    perform public.raise_app_error('FORBIDDEN', 'Restore this event before changing attendance.');
  end if;
  if ev.status = 'canceled' then
    perform public.raise_app_error('FORBIDDEN', 'Move this event out of Canceled before importing attendance.');
  end if;
  return ev;
end;
$$;

create or replace function public.is_plausible_email(p_email text)
returns boolean
language sql
immutable
as $$
  select p_email ~* '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    and char_length(p_email) between 3 and 254;
$$;

create or replace function public.active_event_attendee_ids(p_workspace_id uuid, p_event_id uuid)
returns table (attendee_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct c.attendee_id
  from public.attendance_contributions c
  join public.attendance_batches b on b.id = c.batch_id
  where c.workspace_id = p_workspace_id
    and c.event_id = p_event_id
    and b.reverted_at is null;
$$;

create or replace function public.prepare_attendance_import(
  p_workspace_id uuid,
  p_event_id uuid,
  p_file_label text,
  p_file_hash text,
  p_parser_version text,
  p_mapping jsonb,
  p_rows jsonb,
  p_blank_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  revision integer;
  row_item jsonb;
  row_number integer;
  raw_email text;
  raw_name text;
  email_norm text;
  name_norm text;
  seen jsonb := '{}'::jsonb;
  outcomes jsonb := '[]'::jsonb;
  accepted jsonb := '[]'::jsonb;
  n_new integer := 0;
  n_existing integer := 0;
  n_dup integer := 0;
  n_invalid integer := 0;
  existing_id uuid;
  existing_name text;
  existing_receipt uuid;
  preview public.import_previews;
  label text;
begin
  actor := public.active_membership(p_workspace_id);
  perform public.require_attendance_event(p_workspace_id, p_event_id);
  label := left(trim(coalesce(p_file_label, 'attendance.csv')), 120);
  if label = '' then label := 'attendance.csv'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    perform public.raise_app_error('VALIDATION', 'No attendance rows were sent.');
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    perform public.raise_app_error('LIMIT_EXCEEDED', 'This file has more than 5,000 data rows.');
  end if;
  if jsonb_array_length(p_rows) = 0 then
    perform public.raise_app_error('VALIDATION', 'This file has no attendance rows. Choose another file.');
  end if;

  insert into public.event_attendance_revisions (workspace_id, event_id, version)
  values (p_workspace_id, p_event_id, 1)
  on conflict (workspace_id, event_id) do nothing;
  select version into revision
  from public.event_attendance_revisions
  where workspace_id = p_workspace_id and event_id = p_event_id;

  for row_item in select value from jsonb_array_elements(p_rows)
  loop
    row_number := coalesce((row_item ->> 'rowNumber')::integer, 0);
    raw_email := coalesce(row_item ->> 'email', '');
    raw_name := coalesce(row_item ->> 'name', '');
    email_norm := public.normalize_email(raw_email);
    name_norm := left(trim(raw_name), 200);

    if not public.is_plausible_email(email_norm) then
      n_invalid := n_invalid + 1;
      outcomes := outcomes || jsonb_build_array(jsonb_build_object(
        'rowNumber', row_number, 'name', name_norm, 'email', email_norm,
        'outcome', 'invalid', 'reason', 'This email is not valid.'
      ));
      continue;
    end if;

    if seen ? email_norm then
      n_dup := n_dup + 1;
      outcomes := outcomes || jsonb_build_array(jsonb_build_object(
        'rowNumber', row_number, 'name', name_norm, 'email', email_norm,
        'outcome', 'duplicate', 'reason', 'This email already appears earlier in the file.'
      ));
      continue;
    end if;
    seen := seen || jsonb_build_object(email_norm, true);

    select a.id, a.display_name into existing_id, existing_name
    from public.attendees a
    where a.workspace_id = p_workspace_id and a.email_normalized = email_norm;

    if existing_id is not null and exists (
      select 1 from public.active_event_attendee_ids(p_workspace_id, p_event_id) x
      where x.attendee_id = existing_id
    ) then
      n_existing := n_existing + 1;
      outcomes := outcomes || jsonb_build_array(jsonb_build_object(
        'rowNumber', row_number,
        'name', coalesce(existing_name, name_norm),
        'email', email_norm,
        'outcome', 'already_recorded',
        'reason', case
          when existing_name is not null and name_norm <> '' and existing_name <> name_norm
            then 'Already recorded. The stored name will be kept.'
          else 'Already recorded at this event.'
        end
      ));
    else
      n_new := n_new + 1;
      outcomes := outcomes || jsonb_build_array(jsonb_build_object(
        'rowNumber', row_number, 'name', name_norm, 'email', email_norm,
        'outcome', 'new', 'reason', 'New attendance for this event.'
      ));
    end if;

    accepted := accepted || jsonb_build_array(jsonb_build_object(
      'rowNumber', row_number,
      'email', email_norm,
      'name', name_norm
    ));
  end loop;

  select b.id into existing_receipt
  from public.attendance_batches b
  where b.workspace_id = p_workspace_id
    and b.event_id = p_event_id
    and b.file_hash = p_file_hash
    and b.reverted_at is null
  order by b.committed_at desc
  limit 1;

  insert into public.import_previews (
    workspace_id, event_id, created_by, expires_at, attendance_version, parser_version,
    mapping, file_label, file_hash, accepted_rows, outcome_counts, row_outcomes
  ) values (
    p_workspace_id, p_event_id, actor.user_id, now() + interval '24 hours', revision,
    coalesce(p_parser_version, 'brie-csv-1'),
    coalesce(p_mapping, '{}'::jsonb),
    label,
    coalesce(p_file_hash, ''),
    accepted,
    jsonb_build_object(
      'newAttendance', n_new,
      'alreadyRecorded', n_existing,
      'duplicates', n_dup,
      'invalid', n_invalid,
      'blank', coalesce(p_blank_count, 0),
      'accepted', n_new + n_existing
    ),
    outcomes
  ) returning * into preview;

  return jsonb_build_object(
    'id', preview.id,
    'eventId', p_event_id,
    'expiresAt', preview.expires_at,
    'attendanceVersion', revision,
    'fileLabel', preview.file_label,
    'fileHash', preview.file_hash,
    'existingReceiptId', existing_receipt,
    'counts', preview.outcome_counts,
    'rows', preview.row_outcomes
  );
end;
$$;

create or replace function public.get_import_preview(p_preview_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preview public.import_previews;
begin
  select * into preview from public.import_previews where id = p_preview_id;
  if preview.id is null or preview.expires_at < now() then
    perform public.raise_app_error('PREVIEW_EXPIRED', 'This preview expired. Start the import again.');
  end if;
  perform public.require_roles(preview.workspace_id, array['owner', 'organizer']::public.member_role[]);
  if preview.created_by is distinct from auth.uid() then
    perform public.raise_app_error('FORBIDDEN', 'You don’t have permission to do that.');
  end if;
  return jsonb_build_object(
    'id', preview.id,
    'eventId', preview.event_id,
    'expiresAt', preview.expires_at,
    'attendanceVersion', preview.attendance_version,
    'fileLabel', preview.file_label,
    'fileHash', preview.file_hash,
    'existingReceiptId', null,
    'counts', preview.outcome_counts,
    'rows', preview.row_outcomes
  );
end;
$$;

alter table public.attendees enable row level security;
alter table public.import_previews enable row level security;
alter table public.attendance_batches enable row level security;
alter table public.attendance_contributions enable row level security;
alter table public.event_attendance_revisions enable row level security;
revoke all on table public.attendees from public, anon, authenticated;
revoke all on table public.import_previews from public, anon, authenticated;
revoke all on table public.attendance_batches from public, anon, authenticated;
revoke all on table public.attendance_contributions from public, anon, authenticated;
revoke all on table public.event_attendance_revisions from public, anon, authenticated;
revoke all on function public.prepare_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, integer) from public, anon;
revoke all on function public.get_import_preview(uuid) from public, anon;
grant execute on function public.prepare_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, integer) to authenticated;
grant execute on function public.get_import_preview(uuid) to authenticated;
