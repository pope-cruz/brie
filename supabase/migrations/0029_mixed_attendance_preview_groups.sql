-- Mixed attendance, PR 4: preview groups.
--
-- Each staged row is placed in one review group:
--   will-count    new or already recorded, and attendance is attended
--   wont-count    RSVP-only, no-show, or unknown attendance
--   needs-review  no email (unresolved) or an invalid email; skipped unless fixed
--   duplicate     a later row for an email already in the file
-- Only will-count rows become contributions (see commit_attendance_import, 0027).
-- Legacy previews from prepare_attendance_import keep their stored row outcomes;
-- the client groups those by outcome.

create or replace function public.preview_group(p_outcome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_outcome
    when 'new' then 'will-count'
    when 'already_recorded' then 'will-count'
    when 'not_counted' then 'wont-count'
    when 'duplicate' then 'duplicate'
    else 'needs-review'
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
    'group', public.preview_group(r.outcome),
    'rsvp', r.rsvp_status,
    'attendance', r.attendance_status,
    'rsvpSource', r.rsvp_source,
    'attendanceSource', r.attendance_source,
    'timestamp', r.timestamp_source,
    'phone', r.phone_source,
    'affiliation', r.affiliation_source,
    'reason', case r.outcome
      when 'invalid' then 'This email is not valid. Fix it in the file to count this row.'
      when 'unresolved' then 'No email. This row is not matched to anyone by name or phone.'
      when 'duplicate' then 'This email already appears earlier in the file.'
      when 'new' then 'New attendance for this event.'
      when 'not_counted' then case
        when r.attendance_status = 'no_show' then 'Marked as a no-show.'
        when r.rsvp_status = 'yes' then 'RSVP yes, but attendance is unknown.'
        when r.rsvp_status = 'no' then 'RSVP no. Attendance is unknown.'
        else 'Attendance is unknown.' end
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

revoke all on function public.preview_group(text) from public, anon, authenticated;
revoke all on function public.staged_preview_rows_json(uuid) from public, anon, authenticated;
