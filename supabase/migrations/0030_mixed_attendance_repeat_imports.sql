-- Mixed attendance, PR 5: repeat imports show proposals, never silent changes.
--
-- Importing a file again (the same export, or a later one) must not count anyone
-- twice or quietly rewrite what an earlier import recorded:
-- - Attendance stays one per person per event. A repeat attended row is
--   already_recorded; committing it adds this file as another active source, so a
--   later revert of either import keeps the person while the other stays active.
-- - The stored name is never replaced on import. A different name in the file is
--   returned as a proposed change.
-- - A no-show for someone an earlier import recorded as attended does not remove
--   that attendance. It is returned as a proposed change; reverting the earlier
--   import is how to remove it.
-- Each staged row now reports storedName, recordedAttended (active attendance at
-- this event), and changes: [{"field", "from", "to"}]. Nothing new is stored.

create or replace function public.staged_preview_rows_json(p_preview_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select p.workspace_id, p.event_id from public.import_previews p where p.id = p_preview_id
  ), active as materialized (
    select ids.attendee_id
    from target t
    cross join lateral public.active_event_attendee_ids(t.workspace_id, t.event_id) ids
  ), staged as (
    select r.*,
      a.id as attendee_id,
      a.display_name as stored_name,
      coalesce(a.id in (select attendee_id from active), false) as recorded_here
    from public.import_preview_rows r
    left join public.attendees a
      on a.workspace_id = r.workspace_id and a.email_normalized = r.email_normalized
    where r.preview_id = p_preview_id
  ), proposed as (
    select s.*,
      case when s.attendee_id is not null and s.outcome in ('new', 'already_recorded')
          and s.display_name is not null and s.display_name is distinct from s.stored_name
        then jsonb_build_object('field', 'name', 'from', coalesce(s.stored_name, ''), 'to', s.display_name)
      end as name_change,
      case when s.outcome = 'not_counted' and s.attendance_status = 'no_show' and s.recorded_here
        then jsonb_build_object('field', 'attendance', 'from', 'attended', 'to', 'no_show')
      end as attendance_change
    from staged s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'rowNumber', p.source_row_number,
    'name', coalesce(case when p.attendee_id is not null and p.outcome in ('new', 'already_recorded')
      then p.stored_name end, p.display_name, ''),
    'email', coalesce(p.email_normalized, ''),
    'outcome', p.outcome,
    'group', public.preview_group(p.outcome),
    'rsvp', p.rsvp_status,
    'attendance', p.attendance_status,
    'rsvpSource', p.rsvp_source,
    'attendanceSource', p.attendance_source,
    'timestamp', p.timestamp_source,
    'phone', p.phone_source,
    'affiliation', p.affiliation_source,
    'storedName', p.stored_name,
    'recordedAttended', p.recorded_here,
    'changes', to_jsonb(array_remove(array[p.name_change, p.attendance_change], null)),
    'reason', case p.outcome
      when 'invalid' then 'This email is not valid. Fix it in the file to count this row.'
      when 'unresolved' then 'No email. This row is not matched to anyone by name or phone.'
      when 'duplicate' then 'This email already appears earlier in the file.'
      when 'new' then case when p.name_change is not null
        then 'New attendance for this event. The stored name will be kept.'
        else 'New attendance for this event.' end
      when 'not_counted' then case
        when p.recorded_here and p.attendance_status = 'no_show'
          then 'Marked as a no-show, but an earlier import recorded this person as attended. That record is kept.'
        when p.recorded_here
          then 'Attendance is unknown in this file. An earlier import already records this person as attended.'
        when p.attendance_status = 'no_show' then 'Marked as a no-show.'
        when p.rsvp_status = 'yes' then 'RSVP yes, but attendance is unknown.'
        when p.rsvp_status = 'no' then 'RSVP no. Attendance is unknown.'
        else 'Attendance is unknown.' end
      else case when p.name_change is not null
        then 'Already recorded. The stored name will be kept.'
        else 'Already recorded at this event.' end
      end
  ) order by p.position), '[]'::jsonb)
  from proposed p;
$$;

revoke all on function public.staged_preview_rows_json(uuid) from public, anon, authenticated;
