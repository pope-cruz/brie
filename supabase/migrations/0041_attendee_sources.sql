-- Retain every contributing source on the person page, including reverted
-- imports. Only events with an active source contribute to attendance totals.
create or replace function public.get_attendee_detail(p_workspace_id uuid, p_attendee_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  person public.attendees;
  events jsonb;
  active_count integer;
  first_at timestamptz;
  last_at timestamptz;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into person from public.attendees where id = p_attendee_id and workspace_id = p_workspace_id;
  if person.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;

  with sourced_events as (
    select e.id, e.title, e.starts_at, e.timezone, e.status, e.archived_at,
      bool_or(b.reverted_at is null) as active,
      jsonb_agg(jsonb_build_object(
        'id', b.id,
        'fileLabel', b.file_label,
        'rowNumber', c.source_row_number,
        'committedAt', b.committed_at,
        'importedBy', coalesce(pr.display_name, 'Unknown organizer'),
        'status', case when b.reverted_at is null then 'active' else 'reverted' end,
        'revertedAt', b.reverted_at
      ) order by b.committed_at desc, b.id) as batches
    from public.attendance_contributions c
    join public.attendance_batches b on b.id = c.batch_id
      and b.workspace_id = c.workspace_id and b.event_id = c.event_id
    join public.events e on e.id = c.event_id and e.workspace_id = c.workspace_id
    left join public.profiles pr on pr.user_id = b.created_by
    where c.workspace_id = p_workspace_id and c.attendee_id = p_attendee_id
    group by e.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'eventId', s.id, 'title', s.title, 'startsAt', s.starts_at,
      'timezone', s.timezone, 'status', s.status, 'archivedAt', s.archived_at,
      'active', s.active, 'batches', s.batches
    ) order by s.starts_at desc, s.id), '[]'::jsonb),
    count(*) filter (where s.active)::integer,
    min(s.starts_at) filter (where s.active),
    max(s.starts_at) filter (where s.active)
  into events, active_count, first_at, last_at
  from sourced_events s;

  return jsonb_build_object(
    'id', person.id, 'name', person.display_name, 'email', person.email_normalized,
    'eventsAttended', active_count, 'firstAttended', first_at,
    'lastAttended', last_at, 'events', events
  );
end;
$$;
revoke all on function public.get_attendee_detail(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_attendee_detail(uuid, uuid) to authenticated;
