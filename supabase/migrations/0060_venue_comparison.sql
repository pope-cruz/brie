-- Venue comparison: past use of each venue and, for one event, the request-by
-- date and other events already linked to the venue at an overlapping time.
create function public.compare_venues(
  p_workspace_id uuid, p_include_archived boolean, p_event_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  ev public.events;
  start_day date;
  today date;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  if p_event_id is not null then
    select * into ev from public.events where id = p_event_id and workspace_id = p_workspace_id;
    if ev.id is null then
      perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
    end if;
    start_day := (ev.starts_at at time zone ev.timezone)::date;
    today := (now() at time zone ev.timezone)::date;
  end if;
  return coalesce((
    select jsonb_agg(public.venue_to_json(v) || jsonb_build_object(
      'usage', (
        select jsonb_build_object(
          'pastEventCount', count(*),
          'lastUsedOn', max((e.starts_at at time zone e.timezone)::date),
          'largestAttendance', max(public.event_attendance_count(p_workspace_id, e.id))
        )
        from public.events e
        where e.workspace_id = p_workspace_id and e.venue_id = v.id
          and e.ends_at < now() and e.status <> 'canceled'
      ),
      'fit', case when ev.id is null then null else jsonb_build_object(
        'requestBy', start_day - v.lead_time_days,
        'requestByPassed', start_day - v.lead_time_days < today,
        'linkedToEvent', ev.venue_id is not distinct from v.id,
        'conflicts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', o.id, 'title', o.title, 'startsAt', o.starts_at,
            'endsAt', o.ends_at, 'timezone', o.timezone
          ) order by o.starts_at, o.id)
          from public.events o
          where o.workspace_id = p_workspace_id and o.venue_id = v.id
            and o.id <> ev.id and o.archived_at is null and o.status <> 'canceled'
            and tstzrange(o.starts_at, o.ends_at) && tstzrange(ev.starts_at, ev.ends_at)
        ), '[]'::jsonb)
      ) end
    ) order by lower(v.name), v.id)
    from public.venues v
    where v.workspace_id = p_workspace_id
      and (coalesce(p_include_archived, false) or v.removed_at is null)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.compare_venues(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.compare_venues(uuid, boolean, uuid) to authenticated;
