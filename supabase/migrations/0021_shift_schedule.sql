-- Both commands run in one transaction. The workspace lock taken by the
-- underlying save serializes them with every other plan write.
create function public.save_segment_and_shift(
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
      and id <> p_segment_id and removed_at is null and starts_at >= previous.ends_at;
  end if;
  select * into moved from public.schedule_segments where id = p_segment_id;
  return public.segment_to_json(moved);
end;
$$;

create function public.update_event_and_shift(
  p_workspace_id uuid, p_event_id uuid, p_title text, p_description text,
  p_location text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_timezone text, p_lead_membership_id uuid, p_status public.event_status,
  p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  previous public.events;
  result jsonb;
  delta interval;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  select * into previous from public.events where id = p_event_id and workspace_id = p_workspace_id;
  if previous.id is null then perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.'); end if;
  result := public.update_event(p_workspace_id, p_event_id, p_title, p_description,
    p_location, p_starts_at, p_ends_at, p_timezone, p_lead_membership_id,
    p_status, p_expected_version);
  delta := p_starts_at - previous.starts_at;
  if delta <> interval '0' then
    update public.schedule_segments
    set starts_at = starts_at + delta, ends_at = ends_at + delta, version = version + 1
    where workspace_id = p_workspace_id and event_id = p_event_id and removed_at is null;
  end if;
  return result;
end;
$$;

revoke all on function public.save_segment_and_shift(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid[], text, boolean, integer, text) from public, anon, authenticated;
revoke all on function public.update_event_and_shift(uuid, uuid, text, text, text, timestamptz, timestamptz, text, uuid, public.event_status, integer) from public, anon, authenticated;
grant execute on function public.save_segment_and_shift(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid[], text, boolean, integer, text) to authenticated;
grant execute on function public.update_event_and_shift(uuid, uuid, text, text, text, timestamptz, timestamptz, text, uuid, public.event_status, integer) to authenticated;
