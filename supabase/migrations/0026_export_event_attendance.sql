-- Export one row per distinct attendee with every active source contribution.
-- Keep this separate from paginated screen reads so an export is complete.
create or replace function public.export_event_attendance(
  p_workspace_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  if not exists (
    select 1 from public.events e
    where e.id = p_event_id and e.workspace_id = p_workspace_id
  ) then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', person.display_name,
      'email', person.email_normalized,
      'sources', person.sources
    ) order by lower(coalesce(person.display_name, person.email_normalized)), person.id)
    from (
      select a.id, a.display_name, a.email_normalized,
        jsonb_agg(jsonb_build_object(
          'fileLabel', b.file_label,
          'rowNumber', c.source_row_number,
          'recordedAt', b.committed_at
        ) order by b.committed_at, b.id, c.source_row_number) as sources
      from public.attendees a
      join public.attendance_contributions c
        on c.attendee_id = a.id and c.workspace_id = p_workspace_id and c.event_id = p_event_id
      join public.attendance_batches b
        on b.id = c.batch_id and b.workspace_id = p_workspace_id and b.event_id = p_event_id
      where a.workspace_id = p_workspace_id and b.reverted_at is null
      group by a.id, a.display_name, a.email_normalized
    ) person
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.export_event_attendance(uuid, uuid) from public, anon, authenticated;
grant execute on function public.export_event_attendance(uuid, uuid) to authenticated;
