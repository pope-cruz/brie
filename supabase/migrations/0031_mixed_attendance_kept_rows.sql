-- Mixed attendance, PR 6: keep the original rows of an import, on request.
--
-- Retention and erasure decisions made here:
-- - Opt-in per import. The organizer ticks "Keep the original rows" on the mapping
--   step; only then does the browser send every column of every row and the
--   original headers. Without it nothing beyond the mapped columns is sent, as
--   before. Only mixed imports (an attendance column was chosen) can keep rows.
-- - Kept rows belong to the committed import: every row of the file, including
--   rows that did not count and rows without an email, with its row number.
-- - Only owners and organizers of the workspace can download them (as CSV, from
--   the import receipt) or delete them. There is no direct table access.
-- - They are deleted automatically 180 days after the import
--   (import_source_retention), when the import is reverted, or when an owner or
--   organizer deletes them. Deleting them never changes attendance or the receipt.
-- - Expired rows are hidden from reads immediately. The operator's daily job runs
--   purge_expired_import_sources() alongside purge_expired_previews().
-- - Erasure for one person: the operator runs erase_import_source_rows(workspace,
--   email), which removes that person's kept rows in the workspace. Rows without an
--   email can only be removed with their whole import's kept rows.

create or replace function public.import_source_retention()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '180 days';
$$;

alter table public.import_previews add column source_headers jsonb;
alter table public.import_preview_rows add column raw_values jsonb
  check (raw_values is null or (jsonb_typeof(raw_values) = 'array' and jsonb_array_length(raw_values) <= 200));

create table public.import_sources (
  batch_id uuid primary key,
  workspace_id uuid not null,
  event_id uuid not null,
  headers jsonb not null check (jsonb_typeof(headers) = 'array' and jsonb_array_length(headers) between 1 and 200),
  row_count integer not null check (row_count between 0 and 5000),
  delete_after timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, batch_id) references public.attendance_batches (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id)
);

create table public.import_source_rows (
  batch_id uuid not null references public.import_sources (batch_id) on delete cascade,
  workspace_id uuid not null,
  position integer not null,
  source_row_number integer not null,
  email_normalized text,
  raw_values jsonb not null check (jsonb_typeof(raw_values) = 'array' and jsonb_array_length(raw_values) <= 200),
  primary key (batch_id, position)
);

create index import_sources_delete_after_idx on public.import_sources (delete_after);
create index import_source_rows_email_idx on public.import_source_rows (workspace_id, email_normalized);

alter table public.import_sources enable row level security;
alter table public.import_source_rows enable row level security;
revoke all on table public.import_sources from public, anon, authenticated;
revoke all on table public.import_source_rows from public, anon, authenticated;

-- Unchanged from 0028 except that, with mapping.keepSource, each row's "values"
-- (every original cell) and mapping.headers are validated and staged. The headers
-- are stored on the preview, not in its mapping.
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
  source_headers jsonb;
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
  -- Original rows are kept only when the organizer asks (mapping.keepSource) and
  -- sends the original headers; otherwise any sent values are ignored.
  if coalesce(p_mapping ->> 'keepSource', 'false') = 'true' then
    source_headers := p_mapping -> 'headers';
    if jsonb_typeof(source_headers) is distinct from 'array'
       or jsonb_array_length(source_headers) not between 1 and 200
       or exists (select 1 from jsonb_array_elements(source_headers) h
         where jsonb_typeof(h) <> 'string' or char_length(h #>> '{}') > 200)
       or exists (select 1 from jsonb_array_elements(p_rows) item
         where jsonb_typeof(item -> 'values') is distinct from 'array'
           or jsonb_array_length(item -> 'values') > 200
           or exists (select 1 from jsonb_array_elements(item -> 'values') v
             where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 2000)) then
      perform public.raise_app_error('VALIDATION', 'The original rows can’t be kept for this file.');
    end if;
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
    mapping, status_map, source_headers, file_label, file_hash, accepted_rows, outcome_counts, row_outcomes
  ) values (
    p_workspace_id, p_event_id, actor.user_id, now() + interval '24 hours', revision,
    coalesce(p_parser_version, 'brie-csv-1'),
    coalesce(p_mapping, '{}'::jsonb) - 'headers',
    status_map,
    source_headers,
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
      nullif(left(trim(coalesce(item ->> 'attendance', '')), 200), '') as attendance_source,
      nullif(left(trim(coalesce(item ->> 'timestamp', '')), 200), '') as timestamp_source,
      nullif(left(trim(coalesce(item ->> 'phone', '')), 200), '') as phone_source,
      nullif(left(trim(coalesce(item ->> 'affiliation', '')), 200), '') as affiliation_source,
      case when source_headers is not null then item -> 'values' end as raw_values
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
    display_name, rsvp_status, attendance_status, rsvp_source, attendance_source,
    timestamp_source, phone_source, affiliation_source, raw_values, outcome
  )
  select preview.id, p_workspace_id, p_event_id, r.ord, r.source_row,
    nullif(left(r.email, 320), ''),
    nullif(r.name, ''),
    r.rsvp, r.attendance, r.rsvp_source, r.attendance_source,
    r.timestamp_source, r.phone_source, r.affiliation_source, r.raw_values,
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
    'keepSource', preview.source_headers is not null,
    'counts', preview.outcome_counts,
    'rows', public.staged_preview_rows_json(preview.id)
  );
end;
$$;

-- Unchanged from 0027 except that kept rows are copied to import_sources before the
-- staged rows are deleted (the preview's copy of the headers is cleared too), and
-- the audit entry records whether rows were kept.
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
      source_headers = null,
      skip_invalid_ack = true
  where id = preview.id;
  if preview.source_headers is not null then
    insert into public.import_sources (batch_id, workspace_id, event_id, headers, row_count, delete_after)
    values (
      batch.id, preview.workspace_id, preview.event_id, preview.source_headers,
      (select count(*) from public.import_preview_rows where preview_id = preview.id),
      now() + public.import_source_retention()
    );
    insert into public.import_source_rows (
      batch_id, workspace_id, position, source_row_number, email_normalized, raw_values
    )
    select batch.id, r.workspace_id, r.position, r.source_row_number, r.email_normalized, r.raw_values
    from public.import_preview_rows r
    where r.preview_id = preview.id and r.raw_values is not null;
  end if;
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
      'unresolved', (preview.outcome_counts ->> 'unresolved')::integer,
      'sourceKept', preview.source_headers is not null
    ) end
  );

  return public.receipt_to_json(batch);
end;
$$;

-- Unchanged from 0010 except that reverting deletes the import's kept rows.
create or replace function public.revert_attendance_import(
  p_workspace_id uuid,
  p_batch_id uuid,
  p_expected_batch_version integer,
  p_expected_attendance_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.attendance_batches;
  ev public.events;
  current_version integer;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into batch from public.attendance_batches where id = p_batch_id and workspace_id = p_workspace_id for update;
  if batch.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  select * into ev from public.events where id = batch.event_id;
  if ev.archived_at is not null then
    perform public.raise_app_error('FORBIDDEN', 'Restore this event before changing attendance.');
  end if;
  if batch.reverted_at is not null then
    return public.receipt_to_json(batch);
  end if;
  select version into current_version
  from public.event_attendance_revisions
  where workspace_id = p_workspace_id and event_id = batch.event_id
  for update;
  if current_version is distinct from p_expected_attendance_version
     or batch.version is distinct from p_expected_batch_version then
    perform public.raise_app_error('CONFLICT', 'Attendance changed. Review the impact again.');
  end if;

  update public.attendance_batches
  set reverted_at = now(), reverted_by = auth.uid(), version = version + 1
  where id = batch.id
  returning * into batch;
  delete from public.import_sources where batch_id = batch.id;

  update public.event_attendance_revisions
  set version = version + 1
  where workspace_id = p_workspace_id and event_id = batch.event_id;

  perform public.write_audit(
    p_workspace_id,
    'revert_attendance_import',
    'attendance_batch',
    batch.id,
    '{}'::jsonb
  );
  return public.receipt_to_json(batch);
end;
$$;

-- Unchanged from 0027 except for sourceRowCount and sourceDeleteAfter (null when no
-- rows are kept or they expired).
create or replace function public.receipt_to_json(p_batch public.attendance_batches)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_name text;
  source public.import_sources;
begin
  select pr.display_name into actor_name
  from public.profiles pr
  where pr.user_id = p_batch.created_by;
  select * into source from public.import_sources s
  where s.batch_id = p_batch.id and s.delete_after > now();
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
    'revertedAt', p_batch.reverted_at,
    'sourceRowCount', source.row_count,
    'sourceDeleteAfter', source.delete_after
  );
end;
$$;

create or replace function public.get_import_source(p_workspace_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source public.import_sources;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into source from public.import_sources
  where batch_id = p_batch_id and workspace_id = p_workspace_id and delete_after > now();
  if source.batch_id is null then
    perform public.raise_app_error('UNAVAILABLE', 'The original rows for this import aren’t kept.');
  end if;
  return jsonb_build_object(
    'headers', source.headers,
    'deleteAfter', source.delete_after,
    'rows', coalesce((
      select jsonb_agg(r.raw_values order by r.position)
      from public.import_source_rows r
      where r.batch_id = source.batch_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.delete_import_source(p_workspace_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.attendance_batches;
  removed integer;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into batch from public.attendance_batches where id = p_batch_id and workspace_id = p_workspace_id;
  if batch.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  delete from public.import_sources where batch_id = batch.id;
  get diagnostics removed = row_count;
  if removed > 0 then
    perform public.write_audit(p_workspace_id, 'delete_import_source', 'attendance_batch', batch.id, '{}'::jsonb);
  end if;
  return public.receipt_to_json(batch);
end;
$$;

-- Operator maintenance, alongside purge_expired_previews(). Not callable from the app.
create or replace function public.purge_expired_import_sources()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.import_sources where delete_after <= now();
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- Operator erasure of one person's kept rows in one workspace. Not callable from
-- the app. Returns the number of rows removed.
create or replace function public.erase_import_source_rows(p_workspace_id uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.import_source_rows
  where workspace_id = p_workspace_id
    and email_normalized = public.normalize_email(p_email);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.import_source_retention() from public, anon, authenticated;
revoke all on function public.receipt_to_json(public.attendance_batches) from public, anon, authenticated;
revoke all on function public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.commit_attendance_import(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.revert_attendance_import(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.get_import_source(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_import_source(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_import_sources() from public, anon, authenticated;
revoke all on function public.erase_import_source_rows(uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer) to authenticated;
grant execute on function public.commit_attendance_import(uuid, boolean, text) to authenticated;
grant execute on function public.revert_attendance_import(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.get_import_source(uuid, uuid) to authenticated;
grant execute on function public.delete_import_source(uuid, uuid) to authenticated;
