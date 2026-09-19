-- A paste is a single transaction and a single idempotent command. Any bad
-- row or unacknowledged warning rolls back every inserted item and request key.
create function public.paste_schedule(
  p_workspace_id uuid, p_event_id uuid, p_rows jsonb,
  p_ack_warnings boolean, p_request_key text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  existing jsonb;
  row_data jsonb;
  position bigint;
  person_ids uuid[];
  saved jsonb;
  results jsonb := '[]'::jsonb;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_event_writable(p_workspace_id, p_event_id);
  existing := public.peek_request('paste_schedule', p_request_key);
  if existing is not null then return existing; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    perform public.raise_app_error('VALIDATION', 'Paste between 1 and 200 schedule rows.');
  end if;
  for row_data, position in select value, ordinality from jsonb_array_elements(p_rows) with ordinality loop
    if jsonb_typeof(row_data->'personIds') is distinct from 'array' then
      perform public.raise_app_error('VALIDATION', 'Choose valid people for every row.');
    end if;
    select coalesce(array_agg(value::uuid), '{}'::uuid[]) into person_ids
    from jsonb_array_elements_text(row_data->'personIds');
    saved := public.save_segment_people(
      p_workspace_id, p_event_id, null, row_data->>'title',
      (row_data->>'startsAt')::timestamptz, (row_data->>'endsAt')::timestamptz,
      person_ids, row_data->>'instructions', p_ack_warnings, 1,
      md5(p_request_key || ':' || position::text)
    );
    results := results || jsonb_build_array(saved);
  end loop;
  return public.remember_request('paste_schedule', p_request_key, results);
end;
$$;

revoke all on function public.paste_schedule(uuid, uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.paste_schedule(uuid, uuid, jsonb, boolean, text) to authenticated;
