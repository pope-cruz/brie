-- Only the caller's items and Everyone items from current, unclosed events.
create function public.list_home_schedule(p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor public.memberships;
begin
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  return coalesce((
    select jsonb_agg(public.segment_to_json(s) || jsonb_build_object(
      'eventTitle', e.title, 'eventStartsAt', e.starts_at,
      'eventEndsAt', e.ends_at, 'eventTimezone', e.timezone
    ) order by s.starts_at, s.ends_at, s.created_at, s.id)
    from public.schedule_segments s
    join public.events e on e.id = s.event_id and e.workspace_id = s.workspace_id
    where s.workspace_id = p_workspace_id and s.removed_at is null
      and e.archived_at is null and e.status in ('draft', 'planned')
      and e.ends_at >= now() and e.starts_at < now() + interval '7 days'
      and (not exists (
        select 1 from public.schedule_segment_people sp
        where sp.workspace_id = s.workspace_id and sp.segment_id = s.id
      ) or exists (
        select 1 from public.schedule_segment_people sp
        where sp.workspace_id = s.workspace_id and sp.segment_id = s.id
          and sp.membership_id = actor.id
      ))
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_home_schedule(uuid) from public, anon, authenticated;
grant execute on function public.list_home_schedule(uuid) to authenticated;
