-- A stable, versioned read contract for planning assistants and other
-- readers outside the app. It carries plans, not people: no attendee names or
-- emails, no member names or emails, only whether a to-do is assigned and how
-- many people a schedule item has. Members get confirmed attendance totals,
-- as in the app; first-time and repeat counts need an owner or organizer.
--
-- Each contract has an internal builder that takes the reader's role
-- explicitly, and a signed-in wrapper that derives the role from the session.
-- Assistant access (a later migration) calls the same builders after resolving
-- its own credential, so both paths return identical documents.

create function public.event_plan_json(
  p_workspace_id uuid, p_event_id uuid, p_role public.member_role
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  ev public.events;
  venue public.venues;
  booking public.event_bookings;
  booking_json jsonb;
  start_day date;
  confirmed integer;
  groups jsonb;
begin
  select * into ev from public.events where workspace_id = p_workspace_id and id = p_event_id;
  if ev.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  start_day := (ev.starts_at at time zone ev.timezone)::date;
  select * into venue from public.venues where workspace_id = p_workspace_id and id = ev.venue_id;
  select * into booking from public.event_bookings
  where workspace_id = p_workspace_id and event_id = ev.id and removed_at is null;
  if booking.id is not null then
    booking_json := public.booking_to_json(booking);
  end if;
  confirmed := public.event_attendance_count(p_workspace_id, ev.id);
  if p_role in ('owner', 'organizer') then
    select jsonb_build_object(
      'firstTime', count(*) filter (where g.first_event_id = ev.id),
      'repeat', count(*) filter (where g.first_event_id <> ev.id)
    ) into groups
    from public.attendance_group_people(p_workspace_id) g
    where exists (
      select 1 from public.attendance_contributions c
      join public.attendance_batches b on b.id = c.batch_id
      where c.workspace_id = p_workspace_id and c.event_id = ev.id
        and c.attendee_id = g.attendee_id and b.reverted_at is null
    );
  end if;

  return jsonb_build_object(
    'contract', 'brie.event-plan/1',
    'event', jsonb_build_object(
      'id', ev.id, 'title', ev.title, 'description', ev.description,
      'location', ev.location, 'status', ev.status,
      'startsAt', ev.starts_at, 'endsAt', ev.ends_at, 'timezone', ev.timezone,
      'localDate', start_day, 'archived', ev.archived_at is not null,
      'teamBriefing', ev.team_briefing
    ),
    'venue', case when venue.id is null then null else jsonb_build_object(
      'id', venue.id, 'name', venue.name, 'venueType', venue.venue_type,
      'capacity', venue.capacity, 'address', venue.address,
      'leadTimeDays', venue.lead_time_days, 'costNotes', venue.cost_notes,
      'accessibility', venue.accessibility, 'equipment', venue.equipment,
      'restrictions', venue.restrictions, 'notes', venue.notes,
      'archived', venue.removed_at is not null
    ) end,
    'booking', case when booking_json is null then null else jsonb_build_object(
      'venueName', booking_json->'venueName',
      'currentStatus', booking_json->'currentStatus',
      'currentStepTitle', booking_json->'currentStepTitle',
      'nextDeadline', booking_json->'nextDeadline',
      'steps', coalesce((
        select jsonb_agg(jsonb_build_object(
          'title', s->'title', 'status', s->'status', 'deadline', s->'deadline'
        ) order by (s->>'position')::int)
        from jsonb_array_elements(booking_json->'steps') s
      ), '[]'::jsonb)
    ) end,
    'todos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', t.title, 'notes', t.notes, 'status', t.status,
        'dueDate', t.due_date,
        'dueDaysBeforeEvent', case when t.due_date is null then null else start_day - t.due_date end,
        'assigned', t.assignee_membership_id is not null
      ) order by t.due_date nulls last, t.created_at, t.id)
      from public.tasks t
      where t.workspace_id = p_workspace_id and t.event_id = ev.id and t.removed_at is null
    ), '[]'::jsonb),
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', s.title, 'startsAt', s.starts_at, 'endsAt', s.ends_at,
        'minutesFromStart', floor(extract(epoch from s.starts_at - ev.starts_at) / 60)::int,
        'durationMinutes', floor(extract(epoch from s.ends_at - s.starts_at) / 60)::int,
        'instructions', s.instructions,
        'peopleCount', (select count(*) from public.schedule_segment_people p where p.segment_id = s.id)
      ) order by s.starts_at, s.ends_at, s.id)
      from public.schedule_segments s
      where s.workspace_id = p_workspace_id and s.event_id = ev.id and s.removed_at is null
    ), '[]'::jsonb),
    'attendance', jsonb_build_object(
      'confirmed', confirmed,
      'firstTime', groups->'firstTime',
      'repeat', groups->'repeat'
    )
  );
end;
$$;
revoke all on function public.event_plan_json(uuid, uuid, public.member_role) from public, anon, authenticated;

create function public.get_event_plan(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare membership public.memberships;
begin
  membership := public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  return public.event_plan_json(p_workspace_id, p_event_id, membership.role);
end;
$$;
revoke all on function public.get_event_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_event_plan(uuid, uuid) to authenticated;

-- Past, upcoming, or all events whose title, description, or location
-- contains every word of the query, newest first. Archived and canceled
-- events are included and labeled: they are part of the history.
create function public.event_search_json(
  p_workspace_id uuid, p_query text, p_when text, p_venue_id uuid, p_limit integer
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  words text[];
  row_limit integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  if coalesce(p_when, 'past') not in ('past', 'upcoming', 'any')
    or char_length(coalesce(p_query, '')) > 200
  then
    perform public.raise_app_error('VALIDATION', 'Check the search and try again.');
  end if;
  select coalesce(array_agg(w), '{}') into words
  from regexp_split_to_table(lower(trim(coalesce(p_query, ''))), '\s+') w where w <> '';

  return jsonb_build_object(
    'contract', 'brie.event-search/1',
    'query', coalesce(p_query, ''),
    'when', coalesce(p_when, 'past'),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'title', e.title, 'status', e.status,
        'startsAt', e.starts_at, 'endsAt', e.ends_at, 'timezone', e.timezone,
        'localDate', (e.starts_at at time zone e.timezone)::date,
        'archived', e.archived_at is not null, 'location', e.location,
        'venue', case when v.id is null then null else jsonb_build_object('id', v.id, 'name', v.name) end,
        'descriptionExcerpt', left(e.description, 280),
        'confirmedAttendance', public.event_attendance_count(p_workspace_id, e.id),
        'todoCount', (select count(*) from public.tasks t where t.event_id = e.id and t.removed_at is null),
        'scheduleCount', (select count(*) from public.schedule_segments s where s.event_id = e.id and s.removed_at is null)
      ) order by e.starts_at desc, e.id)
      from (
        select e.* from public.events e
        where e.workspace_id = p_workspace_id
          and (p_venue_id is null or e.venue_id = p_venue_id)
          and case coalesce(p_when, 'past')
            when 'past' then e.ends_at < now()
            when 'upcoming' then e.ends_at >= now()
            else true end
          and not exists (
            select 1 from unnest(words) w
            where position(w in lower(e.title || ' ' || e.description || ' ' || e.location)) = 0
          )
        order by e.starts_at desc, e.id
        limit row_limit
      ) e
      left join public.venues v on v.workspace_id = p_workspace_id and v.id = e.venue_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.event_search_json(uuid, text, text, uuid, integer) from public, anon, authenticated;

create function public.search_events(
  p_workspace_id uuid, p_query text, p_when text, p_venue_id uuid, p_limit integer
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  return public.event_search_json(p_workspace_id, p_query, p_when, p_venue_id, p_limit);
end;
$$;
revoke all on function public.search_events(uuid, text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.search_events(uuid, text, text, uuid, integer) to authenticated;
