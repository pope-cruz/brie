-- Mixed attendance, PR 3: optional context columns.
--
-- The import screen can now map RSVP, check-in/attendance, timestamp, phone, and
-- affiliation columns. Timestamp, phone, and affiliation are context for review
-- only: they never set attendance and are never used to match a person. Like the
-- other staged detail they live on import_preview_rows, which is deleted on commit
-- and with its preview on expiry. Keeping any of them after commit is PR 6's
-- retention decision.

alter table public.import_preview_rows
  add column timestamp_source text check (timestamp_source is null or char_length(timestamp_source) <= 200),
  add column phone_source text check (phone_source is null or char_length(phone_source) <= 200),
  add column affiliation_source text check (affiliation_source is null or char_length(affiliation_source) <= 200);

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
    'rsvpSource', r.rsvp_source,
    'attendanceSource', r.attendance_source,
    'timestamp', r.timestamp_source,
    'phone', r.phone_source,
    'affiliation', r.affiliation_source,
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

-- Unchanged from 0027 except that rows may carry "timestamp", "phone", and
-- "affiliation" source cells, which are staged as-is (trimmed, at most 200
-- characters) and play no part in outcomes.
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
      nullif(left(trim(coalesce(item ->> 'attendance', '')), 200), '') as attendance_source,
      nullif(left(trim(coalesce(item ->> 'timestamp', '')), 200), '') as timestamp_source,
      nullif(left(trim(coalesce(item ->> 'phone', '')), 200), '') as phone_source,
      nullif(left(trim(coalesce(item ->> 'affiliation', '')), 200), '') as affiliation_source
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
    timestamp_source, phone_source, affiliation_source, outcome
  )
  select preview.id, p_workspace_id, p_event_id, r.ord, r.source_row,
    nullif(left(r.email, 320), ''),
    nullif(r.name, ''),
    r.rsvp, r.attendance, r.rsvp_source, r.attendance_source,
    r.timestamp_source, r.phone_source, r.affiliation_source,
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

revoke all on function public.staged_preview_rows_json(uuid) from public, anon, authenticated;
revoke all on function public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.prepare_mixed_attendance_import(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, integer) to authenticated;
