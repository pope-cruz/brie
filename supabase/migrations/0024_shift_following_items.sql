-- "Later" means later in the schedule's displayed time order, including an
-- overlapping item that starts before the edited item ends.
create or replace function public.save_segment_and_shift(
  p_workspace_id uuid, p_event_id uuid, p_segment_id uuid, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_person_ids uuid[],
  p_instructions text, p_ack_warnings boolean, p_expected_version integer,
  p_request_key text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  previous public.schedule_segments;
  moved public.schedule_segments;
  delta interval;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if p_segment_id is null then
    perform public.raise_app_error('VALIDATION', 'Choose an existing item to shift.');
  end if;
  select * into previous from public.schedule_segments
  where id = p_segment_id and workspace_id = p_workspace_id and event_id = p_event_id and removed_at is null;
  if previous.id is null then perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.'); end if;
  perform public.save_segment_people(p_workspace_id, p_event_id, p_segment_id, p_title,
    p_starts_at, p_ends_at, p_person_ids, p_instructions, p_ack_warnings,
    p_expected_version, p_request_key);
  delta := p_ends_at - previous.ends_at;
  if delta <> interval '0' then
    update public.schedule_segments
    set starts_at = starts_at + delta, ends_at = ends_at + delta, version = version + 1
    where workspace_id = p_workspace_id and event_id = p_event_id
      and id <> p_segment_id and removed_at is null
      and (starts_at, ends_at, created_at, id) >
          (previous.starts_at, previous.ends_at, previous.created_at, previous.id);
  end if;
  select * into moved from public.schedule_segments where id = p_segment_id;
  return public.segment_to_json(moved);
end;
$$;
