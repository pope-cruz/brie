-- Mixed attendance, PRs 3-6 on top of 0027.
--
-- PR 3: optional timestamp, phone and affiliation columns are staged for review
--   only (they are never identity or attendance). An attendance rule can say
--   "every row attended" for a plain attendee list; the organizer must choose it.
-- PR 4: preview rows carry their review group (will-count, wont-count,
--   needs-review, duplicate).
-- PR 5: a repeat import proposes additions and changes and never overwrites a
--   stored name or attendance. A row already recorded from the same file (same
--   hash, active batch) adds no second contribution.
-- PR 6: the original headers and rows can be kept with a committed batch.
--   Retention decision:
--   * Only when the organizer chooses to keep them at import (the client sends
--     p_source_headers); nothing is kept otherwise.
--   * Bounded: at most 200 columns, 200 characters per header, 2,000 per cell.
--   * Kept for 90 days after commit, then unreadable and deleted by
--     purge_expired_import_sources() and opportunistically by later commits.
--   * Erased at once when the organizer deletes them or reverts the batch.
--   * Owner/organizer only, through permission-checked RPCs; no direct access.
--   Counts, history and export still come only from attendance_contributions.

alter table public.import_previews
  add column source_headers jsonb check (source_headers is null or jsonb_typeof(source_headers) = 'array');

alter table public.import_preview_rows
  add column source_timestamp text check (source_timestamp is null or char_length(source_timestamp) <= 200),
  add column phone text check (phone is null or char_length(phone) <= 200),
  add column affiliation text check (affiliation is null or char_length(affiliation) <= 200),
  add column already_active boolean not null default false,
  add column adds_contribution boolean not null default false,
  add column source_values jsonb check (source_values is null or jsonb_typeof(source_values) = 'array'),
  add constraint import_preview_rows_contribution_attended check (
    not adds_contribution or (attendance_status = 'attended' and outcome in ('new', 'already_recorded'))
  );

create table public.attendance_import_sources (
  batch_id uuid primary key,
  workspace_id uuid not null,
  event_id uuid not null,
  headers jsonb not null check (jsonb_typeof(headers) = 'array'),
  row_count integer not null,
  retained_until timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, batch_id) references public.attendance_batches (workspace_id, id) on delete cascade,
  foreign key (workspace_id, event_id) references public.events (workspace_id, id)
);

create table public.attendance_import_source_rows (
  batch_id uuid not null references public.attendance_import_sources (batch_id) on delete cascade,
  position integer not null,
  source_row_number integer not null,
  email_normalized text,
  source_values jsonb not null check (jsonb_typeof(source_values) = 'array'),
  primary key (batch_id, position)
);

create index attendance_import_sources_expiry_idx on public.attendance_import_sources (retained_until);

alter table public.attendance_import_sources enable row level security;
alter table public.attendance_import_source_rows enable row level security;
revoke all on table public.attendance_import_sources from public, anon, authenticated;
revoke all on table public.attendance_import_source_rows from public, anon, authenticated;

-- Adds {"everyRow": "<status>"}: every row gets that status whatever the cell.
-- It cannot be combined with per-value rules.
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
  every_row text;
begin
  if p_rule is null or jsonb_typeof(p_rule) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_rule) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_rule) k where k not in ('values', 'otherNonBlank', 'everyRow'))
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

  if p_rule ? 'everyRow' and jsonb_typeof(p_rule -> 'everyRow') <> 'null' then
    every_row := case when jsonb_typeof(p_rule -> 'everyRow') = 'string' then p_rule ->> 'everyRow' end;
    if every_row is null or not (every_row = any (p_allowed)) or normalized <> '{}'::jsonb or other is not null then
      perform public.raise_app_error('VALIDATION', 'This status mapping isn’t valid.');
    end if;
  end if;

  return jsonb_build_object('values', normalized, 'otherNonBlank', other, 'everyRow', every_row);
end;
$$;

create or replace function public.apply_status_rule(p_value text, p_rule jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rule is null then 'unknown'
    when p_rule ->> 'everyRow' is not null then p_rule ->> 'everyRow'
    when trim(coalesce(p_value, '')) = '' then 'unknown'
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
    'name', coalesce(case when r.already_active then a.display_name end, r.display_name, ''),
    'email', coalesce(r.email_normalized, ''),
    'outcome', r.outcome,
    'group', case
      when r.outcome in ('new', 'already_recorded') then 'will-count'
      when r.outcome = 'not_counted' then 'wont-count'
      when r.outcome = 'duplicate' then 'duplicate'
      else 'needs-review' end,
    'rsvp', r.rsvp_status,
    'attendance', r.attendance_status,
    'rsvpSource', r.rsvp_source,
    'attendanceSource', r.attendance_source,
    'timestamp', r.source_timestamp,
    'phone', r.phone,
    'affiliation', r.affiliation,
    'addsContribution', r.adds_contribution,
    'reason', case r.outcome
      when 'invalid' then 'This email is not valid.'
      when 'unresolved' then 'No email. This row is not matched to anyone by name or phone.'
      when 'duplicate' then 'This email already appears earlier in the file.'
      when 'new' then 'New attendance for this event.'
      when 'not_counted' then case
        when r.already_active and r.attendance_status = 'no_show'
          then 'Already recorded as attended. This file says no-show; the recorded attendance is kept.'
        when r.already_active then 'Already recorded as attended. This row does not change that.'
        when r.attendance_status = 'no_show' then 'Marked as a no-show. Not counted as attended.'
        else 'Attendance is unknown. Not counted as attended.' end
      else case
        when not r.adds_contribution then 'Already recorded from this file.'
        when a.display_name is not null and coalesce(r.display_name, '') <> '' and a.display_name <> r.display_name
          then 'Already recorded. The stored name will be kept.'
        else 'Already recorded at this event.' end
      end
  ) order by r.position), '[]'::jsonb)
  from public.import_preview_rows r
  left join public.attendees a
    on r.already_active and a.workspace_id = r.workspace_id and a.email_normalized = r.email_normalized
  where r.preview_id = p_preview_id;
$$;

-- Proposed additions and changes against what is already recorded at the event.
-- Nothing here is applied: stored names and recorded attendance are kept.
create or replace function public.staged_preview_proposals(p_preview_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'additions', coalesce((
      select jsonb_agg(r.email_normalized order by r.position)
      from public.import_preview_rows r
      where r.preview_id = p_preview_id and r.outcome = 'new'
    ), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(change.item order by change.position, change.field)
      from (
        select r.position, 'name' as field, jsonb_build_object(
          'email', r.email_normalized, 'field', 'name', 'from', a.display_name, 'to', r.display_name
        ) as item
        from public.import_preview_rows r
        join public.attendees a on a.workspace_id = r.workspace_id and a.email_normalized = r.email_normalized
        where r.preview_id = p_preview_id and r.already_active
          and r.outcome in ('already_recorded', 'not_counted')
          and coalesce(r.display_name, '') <> ''
          and a.display_name is distinct from r.display_name
        union all
        select r.position, 'attendance', jsonb_build_object(
          'email', r.email_normalized, 'field', 'attendance', 'from', 'attended', 'to', 'no_show'
        )
        from public.import_preview_rows r
        where r.preview_id = p_preview_id and r.already_active
          and r.outcome = 'not_counted' and r.attendance_status = 'no_show'
      ) change
    ), '[]'::jsonb)
  );
$$;

create or replace function public.mixed_preview_to_json(p_preview public.import_previews, p_existing_receipt uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_preview.id,
    'eventId', p_preview.event_id,
    'expiresAt', p_preview.expires_at,
    'attendanceVersion', p_preview.attendance_version,
    'fileLabel', p_preview.file_label,
    'fileHash', p_preview.file_hash,
    'existingReceiptId', p_existing_receipt,
    'statusMap', p_preview.status_map,
    'keepsSource', p_preview.source_headers is not null,
    'counts', p_preview.outcome_counts,
    'rows', public.staged_preview_rows_json(p_preview.id),
    'proposals', public.staged_preview_proposals(p_preview.id)
  );
$$;

drop function public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer);

-- Rows: [{"rowNumber", "email", "name", "rsvp", "attendance", "timestamp", "phone",
-- "affiliation", "values"}]. rsvp/attendance are raw source cells; values is the
-- whole source row, sent only when p_source_headers is sent (keep the original rows).
create or replace function public.prepare_mixed_attendance_import(
  p_workspace_id uuid,
  p_event_id uuid,
  p_file_label text,
  p_file_hash text,
  p_parser_version text,
  p_mapping jsonb,
  p_status_map jsonb,
  p_rows jsonb,
  p_blank_count integer,
  p_source_headers jsonb
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
  headers jsonb;
  keep boolean;
  hash text;
  n_new integer := 0;
  n_existing integer := 0;
  n_not_counted integer := 0;
  n_dup integer := 0;
  n_invalid integer := 0;
  n_unresolved integer := 0;
  n_adds integer := 0;
  existing_receipt uuid;
  preview public.import_previews;
  label text;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.active_membership(p_workspace_id);
  perform public.require_attendance_event(p_workspace_id, p_event_id);
  label := left(trim(coalesce(p_file_label, 'attendance.csv')), 120);
  if label = '' then label := 'attendance.csv'; end if;
  hash := coalesce(p_file_hash, '');
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

  keep := p_source_headers is not null and jsonb_typeof(p_source_headers) <> 'null';
  if keep then
    if jsonb_typeof(p_source_headers) <> 'array' or jsonb_array_length(p_source_headers) = 0
       or jsonb_array_length(p_source_headers) > 200 then
      perform public.raise_app_error('VALIDATION', 'The original column headers aren’t valid.');
    end if;
    select jsonb_agg(left(coalesce(h #>> '{}', ''), 200) order by i) into headers
    from jsonb_array_elements(p_source_headers) with ordinality as e(h, i);
  end if;

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
    coalesce(p_mapping, '{}'::jsonb),
    status_map,
    headers,
    label,
    hash,
    '[]'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb
  ) returning * into preview;

  -- The first row for an email is that person's row; later rows with the same
  -- email are duplicates. A person already recorded at this event from an active
  -- batch of this same file adds no second contribution.
  with normalized as materialized (
    select ord,
      coalesce((item ->> 'rowNumber')::integer, 0) as source_row,
      public.normalize_email(coalesce(item ->> 'email', '')) as email,
      left(trim(coalesce(item ->> 'name', '')), 200) as name,
      nullif(left(trim(coalesce(item ->> 'rsvp', '')), 200), '') as rsvp_source,
      nullif(left(trim(coalesce(item ->> 'attendance', '')), 200), '') as attendance_source,
      nullif(left(trim(coalesce(item ->> 'timestamp', '')), 200), '') as source_timestamp,
      nullif(left(trim(coalesce(item ->> 'phone', '')), 200), '') as phone,
      nullif(left(trim(coalesce(item ->> 'affiliation', '')), 200), '') as affiliation,
      case when keep then coalesce((
        select jsonb_agg(left(coalesce(v #>> '{}', ''), 2000) order by i)
        from jsonb_array_elements(case when jsonb_typeof(item -> 'values') = 'array' then item -> 'values' else '[]'::jsonb end)
          with ordinality as e(v, i)
        where i <= 200
      ), '[]'::jsonb) end as source_values
    from jsonb_array_elements(p_rows) with ordinality as r(item, ord)
  ), ranked as (
    select *,
      public.apply_status_rule(rsvp_source, rsvp_rule)::public.rsvp_status as rsvp,
      public.apply_status_rule(attendance_source, attendance_rule)::public.attendance_status as attendance,
      row_number() over (partition by email order by ord) as occurrence
    from normalized
  ), active as materialized (
    select attendee_id from public.active_event_attendee_ids(p_workspace_id, p_event_id)
  ), same_file as materialized (
    select distinct c.attendee_id
    from public.attendance_contributions c
    join public.attendance_batches b on b.id = c.batch_id
    where hash <> '' and c.workspace_id = p_workspace_id and c.event_id = p_event_id
      and b.reverted_at is null and b.file_hash = hash
  ), classified as (
    select r.*,
      active.attendee_id is not null as is_active,
      same_file.attendee_id is not null as from_same_file,
      case when r.email = '' then 'unresolved'
        when not public.is_plausible_email(r.email) then 'invalid'
        when r.occurrence > 1 then 'duplicate'
        when r.attendance <> 'attended' then 'not_counted'
        when active.attendee_id is not null then 'already_recorded'
        else 'new' end as outcome
    from ranked r
    left join public.attendees a on a.workspace_id = p_workspace_id and a.email_normalized = r.email
    left join active on active.attendee_id = a.id
    left join same_file on same_file.attendee_id = a.id
  )
  insert into public.import_preview_rows (
    preview_id, workspace_id, event_id, position, source_row_number, email_normalized,
    display_name, rsvp_status, attendance_status, rsvp_source, attendance_source,
    source_timestamp, phone, affiliation, already_active, adds_contribution, source_values, outcome
  )
  select preview.id, p_workspace_id, p_event_id, c.ord, c.source_row,
    nullif(left(c.email, 320), ''),
    nullif(c.name, ''),
    c.rsvp, c.attendance, c.rsvp_source, c.attendance_source,
    c.source_timestamp, c.phone, c.affiliation,
    c.is_active and c.outcome in ('already_recorded', 'not_counted'),
    c.outcome = 'new' or (c.outcome = 'already_recorded' and not c.from_same_file),
    c.source_values,
    c.outcome
  from classified c;

  select
    count(*) filter (where outcome = 'new'),
    count(*) filter (where outcome = 'already_recorded'),
    count(*) filter (where outcome = 'not_counted'),
    count(*) filter (where outcome = 'duplicate'),
    count(*) filter (where outcome = 'invalid'),
    count(*) filter (where outcome = 'unresolved'),
    count(*) filter (where adds_contribution)
  into n_new, n_existing, n_not_counted, n_dup, n_invalid, n_unresolved, n_adds
  from public.import_preview_rows
  where preview_id = preview.id;

  update public.import_previews
  set outcome_counts = jsonb_build_object(
    'newAttendance', n_new,
    'alreadyRecorded', n_existing,
    'duplicates', n_dup,
    'invalid', n_invalid,
    'blank', coalesce(p_blank_count, 0),
    'accepted', n_adds,
    'notCounted', n_not_counted,
    'unresolved', n_unresolved
  )
  where id = preview.id
  returning * into preview;

  select b.id into existing_receipt
  from public.attendance_batches b
  where b.workspace_id = p_workspace_id
    and b.event_id = p_event_id
    and b.file_hash = hash
    and b.reverted_at is null
  order by b.committed_at desc
  limit 1;

  return public.mixed_preview_to_json(preview, existing_receipt);
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
  if preview.status_map is not null then
    return public.mixed_preview_to_json(preview, null);
  end if;
  return jsonb_build_object(
    'id', preview.id,
    'eventId', preview.event_id,
    'expiresAt', preview.expires_at,
    'attendanceVersion', preview.attendance_version,
    'fileLabel', preview.file_label,
    'fileHash', preview.file_hash,
    'existingReceiptId', null,
    'statusMap', null,
    'counts', preview.outcome_counts,
    'rows', preview.row_outcomes
  );
end;
$$;

create or replace function public.receipt_to_json(p_batch public.attendance_batches)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_name text;
  source_until timestamptz;
begin
  select pr.display_name into actor_name
  from public.profiles pr
  where pr.user_id = p_batch.created_by;
  select s.retained_until into source_until
  from public.attendance_import_sources s
  where s.batch_id = p_batch.id and s.retained_until >= now();
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
    'notCounted', coalesce((p_batch.outcome_counts ->> 'notCounted')::integer, 0),
    'unresolved', coalesce((p_batch.outcome_counts ->> 'unresolved')::integer, 0),
    'sourceRetainedUntil', source_until,
    'status', case when p_batch.reverted_at is null then 'active' else 'reverted' end,
    'revertedAt', p_batch.reverted_at
  );
end;
$$;

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
    if preview.status_map is not null and coalesce((preview.outcome_counts ->> 'alreadyRecorded')::integer, 0) > 0 then
      perform public.raise_app_error('VALIDATION', 'Everyone marked attended is already recorded from this file. There is nothing new to record.');
    end if;
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
      and r.adds_contribution
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

  -- Keep the original rows only when the organizer chose to (PR 6 retention).
  delete from public.attendance_import_sources
  where workspace_id = preview.workspace_id and retained_until < now();
  if preview.status_map is not null and preview.source_headers is not null then
    insert into public.attendance_import_sources (
      batch_id, workspace_id, event_id, headers, row_count, retained_until
    )
    select batch.id, preview.workspace_id, preview.event_id, preview.source_headers, count(*),
      now() + interval '90 days'
    from public.import_preview_rows r
    where r.preview_id = preview.id;
    insert into public.attendance_import_source_rows (
      batch_id, position, source_row_number, email_normalized, source_values
    )
    select batch.id, r.position, r.source_row_number, r.email_normalized, coalesce(r.source_values, '[]'::jsonb)
    from public.import_preview_rows r
    where r.preview_id = preview.id;
  end if;

  update public.event_attendance_revisions
  set version = version + 1
  where workspace_id = preview.workspace_id and event_id = preview.event_id;

  update public.import_previews
  set accepted_rows = '[]'::jsonb,
      row_outcomes = '[]'::jsonb,
      source_headers = null,
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
      'unresolved', (preview.outcome_counts ->> 'unresolved')::integer,
      'keptSource', preview.source_headers is not null
    ) end
  );

  return public.receipt_to_json(batch);
end;
$$;

-- Replaces 0010's revert: reverting a batch also erases its kept original rows.
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

  delete from public.attendance_import_sources where batch_id = batch.id;

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

-- The kept original rows of one batch, for download as CSV.
create or replace function public.get_import_source(p_workspace_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source public.attendance_import_sources;
  label text;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select s.* into source
  from public.attendance_import_sources s
  where s.batch_id = p_batch_id and s.workspace_id = p_workspace_id and s.retained_until >= now();
  if source.batch_id is null then
    perform public.raise_app_error('UNAVAILABLE', 'The original rows for this import are no longer kept.');
  end if;
  select b.file_label into label from public.attendance_batches b where b.id = source.batch_id;
  return jsonb_build_object(
    'batchId', source.batch_id,
    'fileLabel', label,
    'headers', source.headers,
    'retainedUntil', source.retained_until,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('rowNumber', r.source_row_number, 'values', r.source_values)
        order by r.position)
      from public.attendance_import_source_rows r
      where r.batch_id = source.batch_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Deletes the kept original rows of one batch now. Attendance is unchanged.
create or replace function public.erase_import_source(p_workspace_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.attendance_batches;
  erased integer;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into batch from public.attendance_batches where id = p_batch_id and workspace_id = p_workspace_id;
  if batch.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  delete from public.attendance_import_sources where batch_id = batch.id;
  get diagnostics erased = row_count;
  if erased > 0 then
    perform public.write_audit(p_workspace_id, 'erase_import_source', 'attendance_batch', batch.id, '{}'::jsonb);
  end if;
  return public.receipt_to_json(batch);
end;
$$;

-- Operations helper (like purge_expired_previews): deletes original rows past retention.
create or replace function public.purge_expired_import_sources()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.attendance_import_sources where retained_until < now();
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.normalize_status_rule(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.apply_status_rule(text, jsonb) from public, anon, authenticated;
revoke all on function public.staged_preview_rows_json(uuid) from public, anon, authenticated;
revoke all on function public.staged_preview_proposals(uuid) from public, anon, authenticated;
revoke all on function public.mixed_preview_to_json(public.import_previews, uuid) from public, anon, authenticated;
revoke all on function public.receipt_to_json(public.attendance_batches) from public, anon, authenticated;
revoke all on function public.purge_expired_import_sources() from public, anon, authenticated;
revoke all on function public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function public.get_import_preview(uuid) from public, anon, authenticated;
revoke all on function public.commit_attendance_import(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.revert_attendance_import(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.get_import_source(uuid, uuid) from public, anon, authenticated;
revoke all on function public.erase_import_source(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer, jsonb) to authenticated;
grant execute on function public.get_import_preview(uuid) to authenticated;
grant execute on function public.commit_attendance_import(uuid, boolean, text) to authenticated;
grant execute on function public.revert_attendance_import(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.get_import_source(uuid, uuid) to authenticated;
grant execute on function public.erase_import_source(uuid, uuid) to authenticated;
