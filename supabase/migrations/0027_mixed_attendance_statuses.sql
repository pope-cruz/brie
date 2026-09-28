-- Mixed attendance, PR 2: the database model only.
--
-- A mixed registration export (RSVP yes/no, checked in, no-show, blank) is staged
-- row by row with RSVP status and attendance status kept apart, so "registered"
-- never implies "attended". The organizer sends an explicit map from source values
-- to statuses; anything blank, unmapped, or unrecognized is unknown.
--
-- Counts and history still come only from attendance_contributions. A staged row
-- becomes a contribution only when its attendance status is attended, so old
-- imports, receipts, export and reversion keep their meaning. RSVP and non-attended
-- statuses are not written anywhere durable; staged rows are deleted on commit and
-- with their preview on expiry, like the existing preview row detail.
--
-- A row without an email is staged as unresolved. It never creates an attendee or
-- a contribution and is never matched to anyone by name or phone.
--
-- prepare_attendance_import (the current import screen) is unchanged: it still
-- treats every valid row as attended until the UI moves to the mixed RPC.

create type public.rsvp_status as enum ('yes', 'no', 'unknown');
create type public.attendance_status as enum ('attended', 'no_show', 'unknown');

-- Null for previews made by prepare_attendance_import.
alter table public.import_previews add column status_map jsonb;

create table public.import_preview_rows (
  preview_id uuid not null references public.import_previews (id) on delete cascade,
  workspace_id uuid not null,
  event_id uuid not null,
  position integer not null,
  source_row_number integer not null,
  -- Null only when the row has no email (unresolved).
  email_normalized text check (email_normalized is null or char_length(email_normalized) <= 320),
  display_name text check (display_name is null or char_length(display_name) <= 200),
  rsvp_status public.rsvp_status not null,
  attendance_status public.attendance_status not null,
  rsvp_source text check (rsvp_source is null or char_length(rsvp_source) <= 200),
  attendance_source text check (attendance_source is null or char_length(attendance_source) <= 200),
  outcome text not null check (outcome in (
    'new', 'already_recorded', 'not_counted', 'duplicate', 'invalid', 'unresolved'
  )),
  primary key (preview_id, position),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id),
  check ((outcome = 'unresolved') = (email_normalized is null)),
  -- Only confirmed attendance can become a contribution.
  check (outcome not in ('new', 'already_recorded') or attendance_status = 'attended')
);

alter table public.import_preview_rows enable row level security;
revoke all on table public.import_preview_rows from public, anon, authenticated;

-- Validates one column rule of the organizer's status map and returns it with
-- trimmed, lower-cased source keys. A null rule means the column is unmapped.
-- Shape: {"values": {"<source value>": "<status>"}, "otherNonBlank": "<status>"}
create or replace function public.normalize_status_rule(p_rule jsonb, p_allowed text[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  entry record;
  key_norm text;
  status_value text;
  normalized jsonb := '{}'::jsonb;
  other text;
begin
  if p_rule is null or jsonb_typeof(p_rule) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_rule) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_rule) k where k not in ('values', 'otherNonBlank'))
     or (p_rule ? 'values' and jsonb_typeof(p_rule -> 'values') <> 'object') then
    perform public.raise_app_error('VALIDATION', 'This status mapping isn’t valid.');
  end if;
  if (select count(*) from jsonb_object_keys(coalesce(p_rule -> 'values', '{}'::jsonb))) > 200 then
    perform public.raise_app_error('LIMIT_EXCEEDED', 'This status mapping has more than 200 source values.');
  end if;

  for entry in select key, value from jsonb_each(coalesce(p_rule -> 'values', '{}'::jsonb))
  loop
    key_norm := lower(trim(entry.key));
    status_value := case when jsonb_typeof(entry.value) = 'string' then entry.value #>> '{}' end;
    if key_norm = '' or char_length(key_norm) > 200 or status_value is null
       or not (status_value = any (p_allowed)) then
      perform public.raise_app_error('VALIDATION', 'This status mapping isn’t valid.');
    end if;
    if normalized ? key_norm and normalized ->> key_norm <> status_value then
      perform public.raise_app_error('VALIDATION', 'A source value is mapped to two different statuses.');
    end if;
    normalized := normalized || jsonb_build_object(key_norm, status_value);
  end loop;

  if p_rule ? 'otherNonBlank' and jsonb_typeof(p_rule -> 'otherNonBlank') <> 'null' then
    other := case when jsonb_typeof(p_rule -> 'otherNonBlank') = 'string' then p_rule ->> 'otherNonBlank' end;
    if other is null or not (other = any (p_allowed)) then
      perform public.raise_app_error('VALIDATION', 'This status mapping isn’t valid.');
    end if;
  end if;

  return jsonb_build_object('values', normalized, 'otherNonBlank', other);
end;
$$;

-- Applies one normalized rule to a source value. Blank is always unknown; so is a
-- value the organizer did not map, unless they chose a status for other non-blank values.
create or replace function public.apply_status_rule(p_value text, p_rule jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rule is null or trim(coalesce(p_value, '')) = '' then 'unknown'
    when (p_rule -> 'values') ? lower(trim(p_value)) then p_rule -> 'values' ->> lower(trim(p_value))
    else coalesce(p_rule ->> 'otherNonBlank', 'unknown')
  end;
$$;

create or replace function public.staged_preview_rows_json(p_preview_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rowNumber', r.source_row_number,
    'name', coalesce(case when r.outcome = 'already_recorded' then a.display_name end, r.display_name, ''),
    'email', coalesce(r.email_normalized, ''),
    'outcome', r.outcome,
    'rsvp', r.rsvp_status,
    'attendance', r.attendance_status,
    'reason', case r.outcome
      when 'invalid' then 'This email is not valid.'
      when 'unresolved' then 'No email. This row is not matched to anyone by name or phone.'
      when 'duplicate' then 'This email already appears earlier in the file.'
      when 'new' then 'New attendance for this event.'
      when 'not_counted' then case r.attendance_status
        when 'no_show' then 'Marked as a no-show. Not counted as attended.'
        else 'Attendance is unknown. Not counted as attended.' end
      else case when a.display_name is not null and coalesce(r.display_name, '') <> ''
          and a.display_name <> r.display_name
        then 'Already recorded. The stored name will be kept.'
        else 'Already recorded at this event.' end
      end
  ) order by r.position), '[]'::jsonb)
  from public.import_preview_rows r
  left join public.attendees a
    on r.outcome = 'already_recorded'
    and a.workspace_id = r.workspace_id and a.email_normalized = r.email_normalized
  where r.preview_id = p_preview_id;
$$;

-- Rows: [{"rowNumber", "email", "name", "rsvp", "attendance"}], where rsvp and
-- attendance are the raw source cells (omit a key when its column is unmapped).
-- Status map: {"rsvp": <rule>, "attendance": <rule>}; see normalize_status_rule.
create or replace function public.prepare_mixed_attendance_import(
  p_workspace_id uuid,
  p_event_id uuid,
  p_file_label text,
  p_file_hash text,
  p_parser_version text,
  p_mapping jsonb,
  p_status_map jsonb,
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
  rsvp_rule jsonb;
  attendance_rule jsonb;
  status_map jsonb;
  n_new integer := 0;
  n_existing integer := 0;
  n_not_counted integer := 0;
  n_dup integer := 0;
  n_invalid integer := 0;
  n_unresolved integer := 0;
  existing_receipt uuid;
  preview public.import_previews;
  label text;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
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
  if p_status_map is not null and jsonb_typeof(p_status_map) <> 'null' and (
    jsonb_typeof(p_status_map) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_status_map) k where k not in ('rsvp', 'attendance'))
  ) then
    perform public.raise_app_error('VALIDATION', 'This status mapping isn’t valid.');
  end if;
  rsvp_rule := public.normalize_status_rule(p_status_map -> 'rsvp', array['yes', 'no', 'unknown']);
  attendance_rule := public.normalize_status_rule(p_status_map -> 'attendance', array['attended', 'no_show', 'unknown']);
  status_map := jsonb_build_object('rsvp', rsvp_rule, 'attendance', attendance_rule);

  insert into public.event_attendance_revisions (workspace_id, event_id, version)
  values (p_workspace_id, p_event_id, 1)
  on conflict (workspace_id, event_id) do nothing;
  select version into revision
  from public.event_attendance_revisions
  where workspace_id = p_workspace_id and event_id = p_event_id;

  insert into public.import_previews (
    workspace_id, event_id, created_by, expires_at, attendance_version, parser_version,
    mapping, status_map, file_label, file_hash, accepted_rows, outcome_counts, row_outcomes
  ) values (
    p_workspace_id, p_event_id, actor.user_id, now() + interval '24 hours', revision,
    coalesce(p_parser_version, 'brie-csv-1'),
    coalesce(p_mapping, '{}'::jsonb),
    status_map,
    label,
    coalesce(p_file_hash, ''),
    '[]'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb
  ) returning * into preview;

  -- Same set-based shape as prepare_attendance_import (0016). The first row for an
  -- email is that person's row; later rows with the same email are duplicates.
  with normalized as materialized (
    select ord,
      coalesce((item ->> 'rowNumber')::integer, 0) as source_row,
      public.normalize_email(coalesce(item ->> 'email', '')) as email,
      left(trim(coalesce(item ->> 'name', '')), 200) as name,
      nullif(left(trim(coalesce(item ->> 'rsvp', '')), 200), '') as rsvp_source,
      nullif(left(trim(coalesce(item ->> 'attendance', '')), 200), '') as attendance_source
    from jsonb_array_elements(p_rows) with ordinality as r(item, ord)
  ), ranked as (
    select *,
      public.apply_status_rule(rsvp_source, rsvp_rule)::public.rsvp_status as rsvp,
      public.apply_status_rule(attendance_source, attendance_rule)::public.attendance_status as attendance,
      row_number() over (partition by email order by ord) as occurrence
    from normalized
  ), active as materialized (
    select attendee_id from public.active_event_attendee_ids(p_workspace_id, p_event_id)
  )
  insert into public.import_preview_rows (
    preview_id, workspace_id, event_id, position, source_row_number, email_normalized,
    display_name, rsvp_status, attendance_status, rsvp_source, attendance_source, outcome
  )
  select preview.id, p_workspace_id, p_event_id, r.ord, r.source_row,
    nullif(left(r.email, 320), ''),
    nullif(r.name, ''),
    r.rsvp, r.attendance, r.rsvp_source, r.attendance_source,
    case when r.email = '' then 'unresolved'
      when not public.is_plausible_email(r.email) then 'invalid'
      when r.occurrence > 1 then 'duplicate'
      when r.attendance <> 'attended' then 'not_counted'
      when active.attendee_id is not null then 'already_recorded'
      else 'new' end
  from ranked r
  left join public.attendees a on a.workspace_id = p_workspace_id and a.email_normalized = r.email
  left join active on active.attendee_id = a.id;

  select
    count(*) filter (where outcome = 'new'),
    count(*) filter (where outcome = 'already_recorded'),
    count(*) filter (where outcome = 'not_counted'),
    count(*) filter (where outcome = 'duplicate'),
    count(*) filter (where outcome = 'invalid'),
    count(*) filter (where outcome = 'unresolved')
  into n_new, n_existing, n_not_counted, n_dup, n_invalid, n_unresolved
  from public.import_preview_rows
  where preview_id = preview.id;

  update public.import_previews
  set outcome_counts = jsonb_build_object(
    'newAttendance', n_new,
    'alreadyRecorded', n_existing,
    'duplicates', n_dup,
    'invalid', n_invalid,
    'blank', coalesce(p_blank_count, 0),
    'accepted', n_new + n_existing,
    'notCounted', n_not_counted,
    'unresolved', n_unresolved
  )
  where id = preview.id
  returning * into preview;

  select b.id into existing_receipt
  from public.attendance_batches b
  where b.workspace_id = p_workspace_id
    and b.event_id = p_event_id
    and b.file_hash = p_file_hash
    and b.reverted_at is null
  order by b.committed_at desc
  limit 1;

  return jsonb_build_object(
    'id', preview.id,
    'eventId', p_event_id,
    'expiresAt', preview.expires_at,
    'attendanceVersion', revision,
    'fileLabel', preview.file_label,
    'fileHash', preview.file_hash,
    'existingReceiptId', existing_receipt,
    'statusMap', preview.status_map,
    'counts', preview.outcome_counts,
    'rows', public.staged_preview_rows_json(preview.id)
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
    'statusMap', preview.status_map,
    'counts', preview.outcome_counts,
    'rows', case when preview.status_map is null then preview.row_outcomes
      else public.staged_preview_rows_json(preview.id) end
  );
end;
$$;

-- Receipts count rows left out of a mixed import as skipped. Legacy batches have
-- no notCounted/unresolved counts, so their receipts are unchanged.
create or replace function public.receipt_to_json(p_batch public.attendance_batches)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_name text;
begin
  select pr.display_name into actor_name
  from public.profiles pr
  where pr.user_id = p_batch.created_by;
  return jsonb_build_object(
    'id', p_batch.id,
    'eventId', p_batch.event_id,
    'fileLabel', p_batch.file_label,
    'committedAt', p_batch.committed_at,
    'importedBy', actor_name,
    'added', coalesce((p_batch.outcome_counts ->> 'newAttendance')::integer, 0),
    'alreadyRecorded', coalesce((p_batch.outcome_counts ->> 'alreadyRecorded')::integer, 0),
    'skipped', coalesce((p_batch.outcome_counts ->> 'duplicates')::integer, 0)
      + coalesce((p_batch.outcome_counts ->> 'invalid')::integer, 0)
      + coalesce((p_batch.outcome_counts ->> 'notCounted')::integer, 0)
      + coalesce((p_batch.outcome_counts ->> 'unresolved')::integer, 0),
    'status', case when p_batch.reverted_at is null then 'active' else 'reverted' end,
    'revertedAt', p_batch.reverted_at
  );
end;
$$;

-- Replaces 0016's commit. Legacy previews still commit accepted_rows. Mixed
-- previews commit only staged rows whose attendance is attended; everything else
-- (RSVP, no-show, unknown, duplicates, unresolved) is left out of contributions.
create or replace function public.commit_attendance_import(
  p_preview_id uuid,
  p_skip_invalid_ack boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preview public.import_previews;
  ev public.events;
  actor public.memberships;
  current_version integer;
  existing public.attendance_batches;
  batch public.attendance_batches;
  accepted_item record;
  attendee_id uuid;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    perform public.raise_app_error('VALIDATION', 'A request key is required.');
  end if;

  select * into preview from public.import_previews where id = p_preview_id;
  if preview.id is null then
    select * into existing from public.attendance_batches where preview_id = p_preview_id;
    if existing.id is null then
      perform public.raise_app_error('PREVIEW_EXPIRED', 'This preview expired. Start the import again.');
    end if;
    -- Receipt recovery still requires current permission and the original creator.
    perform 1 from public.workspaces where id = existing.workspace_id for update;
    perform public.require_roles(existing.workspace_id, array['owner', 'organizer']::public.member_role[]);
    if existing.created_by is distinct from auth.uid() then
      perform public.raise_app_error('FORBIDDEN', 'You don’t have permission to do that.');
    end if;
    if exists (select 1 from public.attendance_batches b
      where b.workspace_id = existing.workspace_id and b.idempotency_key = p_idempotency_key
        and b.preview_id <> p_preview_id) then
      perform public.raise_app_error('VALIDATION', 'This request key was already used for a different import.');
    end if;
    return public.receipt_to_json(existing);
  end if;

  perform 1 from public.workspaces where id = preview.workspace_id for update;
  actor := public.require_roles(preview.workspace_id, array['owner', 'organizer']::public.member_role[]);
  if preview.created_by is distinct from auth.uid() then
    perform public.raise_app_error('FORBIDDEN', 'You don’t have permission to do that.');
  end if;

  select * into existing from public.attendance_batches
  where workspace_id = preview.workspace_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.preview_id = p_preview_id then
      return public.receipt_to_json(existing);
    end if;
    perform public.raise_app_error('VALIDATION', 'This request key was already used for a different import.');
  end if;
  select * into existing from public.attendance_batches where preview_id = p_preview_id;
  if existing.id is not null then
    return public.receipt_to_json(existing);
  end if;

  -- Only a new commit needs a live preview and writable event. A retry after an
  -- expired preview or archived event returns the already-committed receipt.
  select * into preview from public.import_previews where id = p_preview_id for update;
  if preview.id is null or preview.expires_at < clock_timestamp() then
    perform public.raise_app_error('PREVIEW_EXPIRED', 'This preview expired. Start the import again.');
  end if;
  ev := public.require_attendance_event(preview.workspace_id, preview.event_id);

  if coalesce((preview.outcome_counts ->> 'accepted')::integer, 0) <= 0 then
    if preview.status_map is not null then
      perform public.raise_app_error('VALIDATION', 'No rows are marked attended, so there is nothing to record.');
    end if;
    perform public.raise_app_error('VALIDATION', 'There are no valid unique rows to record.');
  end if;
  if coalesce((preview.outcome_counts ->> 'invalid')::integer, 0) > 0
     and coalesce(p_skip_invalid_ack, preview.skip_invalid_ack) is not true then
    perform public.raise_app_error('VALIDATION', 'Acknowledge skipped invalid rows before recording attendance.');
  end if;
  if coalesce((preview.outcome_counts ->> 'unresolved')::integer, 0) > 0
     and coalesce(p_skip_invalid_ack, preview.skip_invalid_ack) is not true then
    perform public.raise_app_error('VALIDATION', 'Acknowledge rows without an email before recording attendance.');
  end if;

  insert into public.event_attendance_revisions (workspace_id, event_id, version)
  values (preview.workspace_id, preview.event_id, 1)
  on conflict (workspace_id, event_id) do nothing;
  select version into current_version
  from public.event_attendance_revisions
  where workspace_id = preview.workspace_id and event_id = preview.event_id
  for update;
  if current_version is distinct from preview.attendance_version then
    perform public.raise_app_error('CONFLICT', 'Attendance changed since this preview. Review the file again.');
  end if;

  insert into public.attendance_batches (
    workspace_id, event_id, created_by, file_label, file_hash, parser_version,
    outcome_counts, idempotency_key, preview_id
  ) values (
    preview.workspace_id, preview.event_id, actor.user_id, preview.file_label, preview.file_hash,
    preview.parser_version, preview.outcome_counts, p_idempotency_key, preview.id
  ) returning * into batch;

  for accepted_item in
    select item ->> 'email' as email,
      nullif(trim(coalesce(item ->> 'name', '')), '') as name,
      coalesce((item ->> 'rowNumber')::integer, 0) as source_row,
      ord
    from jsonb_array_elements(preview.accepted_rows) with ordinality as a(item, ord)
    where preview.status_map is null
    union all
    select r.email_normalized, r.display_name, r.source_row_number, r.position
    from public.import_preview_rows r
    where preview.status_map is not null
      and r.preview_id = preview.id
      and r.outcome in ('new', 'already_recorded')
      and r.attendance_status = 'attended'
    order by 4
  loop
    insert into public.attendees (workspace_id, email_normalized, display_name)
    values (preview.workspace_id, accepted_item.email, accepted_item.name)
    on conflict (workspace_id, email_normalized) do update
      set display_name = public.attendees.display_name
    returning id into attendee_id;
    if attendee_id is null then
      select id into attendee_id
      from public.attendees
      where workspace_id = preview.workspace_id and email_normalized = accepted_item.email;
    end if;
    insert into public.attendance_contributions (
      workspace_id, event_id, batch_id, attendee_id, source_row_number
    ) values (
      preview.workspace_id, preview.event_id, batch.id, attendee_id, accepted_item.source_row
    );
  end loop;

  update public.event_attendance_revisions
  set version = version + 1
  where workspace_id = preview.workspace_id and event_id = preview.event_id;

  update public.import_previews
  set accepted_rows = '[]'::jsonb,
      row_outcomes = '[]'::jsonb,
      skip_invalid_ack = true
  where id = preview.id;
  delete from public.import_preview_rows where preview_id = preview.id;

  perform public.write_audit(
    preview.workspace_id,
    'commit_attendance_import',
    'attendance_batch',
    batch.id,
    jsonb_build_object(
      'added', (preview.outcome_counts ->> 'newAttendance')::integer,
      'alreadyRecorded', (preview.outcome_counts ->> 'alreadyRecorded')::integer
    ) || case when preview.status_map is null then '{}'::jsonb else jsonb_build_object(
      'notCounted', (preview.outcome_counts ->> 'notCounted')::integer,
      'unresolved', (preview.outcome_counts ->> 'unresolved')::integer
    ) end
  );

  return public.receipt_to_json(batch);
end;
$$;

-- Supabase grants execute on new public functions by default. Revoke first, then
-- grant only the RPCs (listed in supabase/tests/function_privileges.sql).
revoke all on function public.normalize_status_rule(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.apply_status_rule(text, jsonb) from public, anon, authenticated;
revoke all on function public.staged_preview_rows_json(uuid) from public, anon, authenticated;
revoke all on function public.receipt_to_json(public.attendance_batches) from public, anon, authenticated;
revoke all on function public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.get_import_preview(uuid) from public, anon, authenticated;
revoke all on function public.commit_attendance_import(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer) to authenticated;
grant execute on function public.get_import_preview(uuid) to authenticated;
grant execute on function public.commit_attendance_import(uuid, boolean, text) to authenticated;
