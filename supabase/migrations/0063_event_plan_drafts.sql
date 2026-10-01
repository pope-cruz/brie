-- Draft event plans proposed by assistants.
--
-- An assistant key with scope `read_draft` can propose a plan: event details,
-- to-dos (due dates relative to the event day), a run of show (minutes from
-- the start), a team briefing, and an optional venue. It must state at least
-- one assumption and may cite past events from the same workspace. A draft
-- never assigns people, contacts anyone, books a venue, or publishes
-- anything; nothing exists in the workspace until an owner or organizer
-- accepts it. Accepting creates a Draft-status event with its to-dos and
-- schedule in one transaction, idempotently, and audits it. Discarding keeps
-- the record. Members cannot see drafts.

create table public.event_plan_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  token_id uuid not null,
  proposed_by uuid not null references auth.users (id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'discarded')),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  location text not null default '' check (char_length(location) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  timezone text not null,
  venue_id uuid,
  expected_attendance integer check (expected_attendance between 0 and 100000),
  team_briefing text not null default '' check (char_length(team_briefing) <= 4000),
  todos jsonb not null default '[]'::jsonb,
  schedule jsonb not null default '[]'::jsonb,
  assumptions jsonb not null,
  cited_event_ids uuid[] not null default '{}',
  summary text not null default '' check (char_length(summary) <= 1000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  accepted_event_id uuid,
  version integer not null default 1,
  unique (workspace_id, id),
  foreign key (workspace_id, token_id) references public.assistant_tokens (workspace_id, id),
  foreign key (workspace_id, venue_id) references public.venues (workspace_id, id),
  foreign key (workspace_id, accepted_event_id) references public.events (workspace_id, id)
);
create index event_plan_drafts_workspace_idx on public.event_plan_drafts (workspace_id, status, created_at desc, id);
alter table public.event_plan_drafts enable row level security;
revoke all on table public.event_plan_drafts from public, anon, authenticated;

-- Validates an assistant's proposal and returns it normalized. Raises
-- VALIDATION with a message the assistant can act on.
create function public.normalize_plan_draft(p_workspace_id uuid, p_input jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  ws public.workspaces;
  tz text;
  starts timestamptz;
  ends timestamptz;
  item jsonb;
  todos jsonb := '[]'::jsonb;
  schedule jsonb := '[]'::jsonb;
  assumptions jsonb := '[]'::jsonb;
  cited uuid[] := '{}';
  cited_id uuid;
  venue uuid;
  expected integer;
  days integer;
  minutes integer;
  duration integer;
begin
  select * into ws from public.workspaces where id = p_workspace_id;
  if jsonb_typeof(p_input) <> 'object' then
    perform public.raise_app_error('VALIDATION', 'Send the draft as an object.');
  end if;
  tz := coalesce(nullif(p_input->>'timezone', ''), ws.timezone);
  starts := (p_input->>'startsAt')::timestamptz;
  ends := (p_input->>'endsAt')::timestamptz;
  if starts is null or ends is null then
    perform public.raise_app_error('VALIDATION', 'startsAt and endsAt are required ISO 8601 times with an offset, for example 2026-11-12T19:00:00-05:00.');
  end if;
  perform public.validate_event_inputs(p_input->>'title', p_input->>'description', p_input->>'location', starts, ends, tz, 'draft');

  if p_input ? 'venueId' and jsonb_typeof(p_input->'venueId') <> 'null' then
    venue := (p_input->>'venueId')::uuid;
    if not exists (select 1 from public.venues where workspace_id = p_workspace_id and id = venue and removed_at is null) then
      perform public.raise_app_error('VALIDATION', 'venueId must be an active venue in this workspace. Use list_venues.');
    end if;
  end if;
  if p_input ? 'expectedAttendance' and jsonb_typeof(p_input->'expectedAttendance') <> 'null' then
    expected := (p_input->>'expectedAttendance')::integer;
    if expected not between 0 and 100000 then
      perform public.raise_app_error('VALIDATION', 'expectedAttendance must be between 0 and 100,000.');
    end if;
  end if;
  if char_length(coalesce(p_input->>'teamBriefing', '')) > 4000 then
    perform public.raise_app_error('VALIDATION', 'teamBriefing must be 4,000 characters or fewer.');
  end if;
  if char_length(coalesce(p_input->>'summary', '')) > 1000 then
    perform public.raise_app_error('VALIDATION', 'summary must be 1,000 characters or fewer.');
  end if;

  if coalesce(jsonb_typeof(p_input->'todos'), 'array') <> 'array' or jsonb_array_length(coalesce(p_input->'todos', '[]')) > 60 then
    perform public.raise_app_error('VALIDATION', 'todos must be a list of at most 60 items.');
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_input->'todos', '[]')) loop
    if jsonb_typeof(item) <> 'object'
      or char_length(trim(coalesce(item->>'title', ''))) not between 1 and 200
      or char_length(coalesce(item->>'notes', '')) > 2000 then
      perform public.raise_app_error('VALIDATION', 'Each to-do needs a title up to 200 characters and notes up to 2,000.');
    end if;
    days := case when jsonb_typeof(item->'dueDaysBeforeEvent') in ('number', 'string') then (item->>'dueDaysBeforeEvent')::integer end;
    if days not between -60 and 365 then
      perform public.raise_app_error('VALIDATION', 'dueDaysBeforeEvent must be between -60 and 365.');
    end if;
    todos := todos || jsonb_build_array(jsonb_build_object(
      'title', trim(item->>'title'), 'notes', coalesce(item->>'notes', ''), 'dueDaysBeforeEvent', days));
  end loop;

  if coalesce(jsonb_typeof(p_input->'schedule'), 'array') <> 'array' or jsonb_array_length(coalesce(p_input->'schedule', '[]')) > 60 then
    perform public.raise_app_error('VALIDATION', 'schedule must be a list of at most 60 items.');
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_input->'schedule', '[]')) loop
    minutes := (item->>'minutesFromStart')::integer;
    duration := (item->>'durationMinutes')::integer;
    if jsonb_typeof(item) <> 'object'
      or char_length(trim(coalesce(item->>'title', ''))) not between 1 and 120
      or char_length(coalesce(item->>'instructions', '')) > 4000
      or minutes is null or minutes not between -1440 and 2880
      or duration is null or duration not between 1 and 1440 then
      perform public.raise_app_error('VALIDATION', 'Each schedule item needs a title up to 120 characters, minutesFromStart between -1440 and 2880, and durationMinutes between 1 and 1440.');
    end if;
    schedule := schedule || jsonb_build_array(jsonb_build_object(
      'title', trim(item->>'title'), 'minutesFromStart', minutes, 'durationMinutes', duration,
      'instructions', coalesce(item->>'instructions', '')));
  end loop;

  if coalesce(jsonb_typeof(p_input->'assumptions'), 'missing') <> 'array'
    or jsonb_array_length(p_input->'assumptions') not between 1 and 20 then
    perform public.raise_app_error('VALIDATION', 'List between 1 and 20 assumptions so the organizer can check them.');
  end if;
  for item in select value from jsonb_array_elements(p_input->'assumptions') loop
    if jsonb_typeof(item) <> 'string' or char_length(trim(item #>> '{}')) not between 1 and 300 then
      perform public.raise_app_error('VALIDATION', 'Each assumption must be text up to 300 characters.');
    end if;
    assumptions := assumptions || to_jsonb(trim(item #>> '{}'));
  end loop;

  if coalesce(jsonb_typeof(p_input->'citedEventIds'), 'array') <> 'array' or jsonb_array_length(coalesce(p_input->'citedEventIds', '[]')) > 10 then
    perform public.raise_app_error('VALIDATION', 'citedEventIds must be a list of at most 10 event IDs.');
  end if;
  for cited_id in select distinct (value #>> '{}')::uuid from jsonb_array_elements(coalesce(p_input->'citedEventIds', '[]')) loop
    if not exists (select 1 from public.events where workspace_id = p_workspace_id and id = cited_id) then
      perform public.raise_app_error('VALIDATION', 'Every cited event must be an event in this workspace. Use search_events.');
    end if;
    cited := cited || cited_id;
  end loop;

  return jsonb_build_object(
    'title', trim(p_input->>'title'), 'description', coalesce(p_input->>'description', ''),
    'location', coalesce(p_input->>'location', ''), 'startsAt', starts, 'endsAt', ends,
    'timezone', tz, 'venueId', venue, 'expectedAttendance', expected,
    'teamBriefing', coalesce(p_input->>'teamBriefing', ''), 'todos', todos, 'schedule', schedule,
    'assumptions', assumptions, 'citedEventIds', to_jsonb(cited), 'summary', coalesce(p_input->>'summary', '')
  );
end;
$$;
revoke all on function public.normalize_plan_draft(uuid, jsonb) from public, anon, authenticated;

create function public.plan_draft_to_json(p_draft public.event_plan_drafts)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_draft.id, 'status', p_draft.status, 'version', p_draft.version,
    'title', p_draft.title, 'description', p_draft.description, 'location', p_draft.location,
    'startsAt', p_draft.starts_at, 'endsAt', p_draft.ends_at, 'timezone', p_draft.timezone,
    'localDate', (p_draft.starts_at at time zone p_draft.timezone)::date,
    'venue', (select jsonb_build_object('id', v.id, 'name', v.name, 'capacity', v.capacity, 'archived', v.removed_at is not null)
      from public.venues v where v.id = p_draft.venue_id),
    'expectedAttendance', p_draft.expected_attendance,
    'teamBriefing', p_draft.team_briefing, 'todos', p_draft.todos, 'schedule', p_draft.schedule,
    'assumptions', p_draft.assumptions, 'summary', p_draft.summary,
    'citedEvents', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'startsAt', e.starts_at,
        'timezone', e.timezone, 'archived', e.archived_at is not null) order by e.starts_at desc)
      from public.events e where e.workspace_id = p_draft.workspace_id and e.id = any (p_draft.cited_event_ids)
    ), '[]'::jsonb),
    'keyLabel', (select t.label from public.assistant_tokens t where t.id = p_draft.token_id),
    'proposedByName', coalesce((select p.display_name from public.profiles p where p.user_id = p_draft.proposed_by), 'Former member'),
    'createdAt', p_draft.created_at, 'decidedAt', p_draft.decided_at,
    'decidedByName', (select p.display_name from public.profiles p where p.user_id = p_draft.decided_by),
    'acceptedEventId', p_draft.accepted_event_id
  );
$$;
revoke all on function public.plan_draft_to_json(public.event_plan_drafts) from public, anon, authenticated;

create function public.create_plan_draft(
  p_workspace_id uuid, p_token_id uuid, p_user_id uuid, p_input jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  draft jsonb;
  saved public.event_plan_drafts;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if (select count(*) from public.event_plan_drafts where workspace_id = p_workspace_id and status = 'pending') >= 20 then
    perform public.raise_app_error('VALIDATION', 'This workspace already has 20 drafts waiting for review. Ask an organizer to review them first.');
  end if;
  draft := public.normalize_plan_draft(p_workspace_id, p_input);
  insert into public.event_plan_drafts (workspace_id, token_id, proposed_by, title, description, location,
    starts_at, ends_at, timezone, venue_id, expected_attendance, team_briefing, todos, schedule,
    assumptions, cited_event_ids, summary)
  values (p_workspace_id, p_token_id, p_user_id, draft->>'title', draft->>'description', draft->>'location',
    (draft->>'startsAt')::timestamptz, (draft->>'endsAt')::timestamptz, draft->>'timezone',
    (draft->>'venueId')::uuid, (draft->>'expectedAttendance')::integer, draft->>'teamBriefing',
    draft->'todos', draft->'schedule', draft->'assumptions',
    array(select (value #>> '{}')::uuid from jsonb_array_elements(draft->'citedEventIds')), draft->>'summary')
  returning * into saved;
  return jsonb_build_object(
    'draftId', saved.id, 'status', saved.status,
    'reviewPath', format('/app/w/%s/drafts/%s', p_workspace_id, saved.id),
    'message', 'Draft saved. Nothing has changed in the workspace. An owner or organizer can review, adjust, and accept or discard it in Brie under Drafts.'
  );
end;
$$;
revoke all on function public.create_plan_draft(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The assistant dispatcher gains the draft tool; it now receives the key and
-- its creator so drafts record who proposed them.

drop function public.assistant_run_tool(uuid, public.member_role, text, text, jsonb);
create function public.assistant_run_tool(
  p_workspace_id uuid, p_token_id uuid, p_user_id uuid, p_role public.member_role,
  p_scope text, p_tool text, p_args jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare ws public.workspaces;
begin
  case p_tool
    when 'get_workspace' then
      select * into ws from public.workspaces where id = p_workspace_id;
      return jsonb_build_object('id', ws.id, 'name', ws.name, 'timezone', ws.timezone,
        'role', p_role, 'scope', p_scope, 'now', now());
    when 'list_events' then
      return public.event_search_json(p_workspace_id, '', coalesce(p_args->>'when', 'upcoming'),
        null, (p_args->>'limit')::integer);
    when 'search_events' then
      return public.event_search_json(p_workspace_id, p_args->>'query', coalesce(p_args->>'when', 'past'),
        (p_args->>'venueId')::uuid, (p_args->>'limit')::integer);
    when 'get_event_plan' then
      if p_args->>'eventId' is null then
        perform public.raise_app_error('VALIDATION', 'eventId is required.');
      end if;
      return public.event_plan_json(p_workspace_id, (p_args->>'eventId')::uuid, p_role);
    when 'list_venues' then
      return jsonb_build_object('venues', public.venue_comparison_json(p_workspace_id,
        coalesce((p_args->>'includeArchived')::boolean, false), null));
    when 'get_venue' then
      if p_args->>'venueId' is null then
        perform public.raise_app_error('VALIDATION', 'venueId is required.');
      end if;
      return public.venue_detail_json(p_workspace_id, (p_args->>'venueId')::uuid);
    when 'create_event_plan_draft' then
      if p_scope <> 'read_draft' then
        perform public.raise_app_error('FORBIDDEN', 'This key can only read. Ask an organizer for a key that can propose drafts.');
      end if;
      return public.create_plan_draft(p_workspace_id, p_token_id, p_user_id, p_args);
    else
      perform public.raise_app_error('VALIDATION', 'Unknown tool.');
  end case;
  return null;
end;
$$;
revoke all on function public.assistant_run_tool(uuid, uuid, uuid, public.member_role, text, text, jsonb) from public, anon, authenticated;

create or replace function public.assistant_log_arguments(p_args jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, case jsonb_typeof(value)
      when 'string' then to_jsonb(left(value #>> '{}', 120))
      when 'number' then value when 'boolean' then value
      else to_jsonb('…'::text) end), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_args) = 'object' then p_args else '{}'::jsonb end)
  where key in ('eventId', 'venueId', 'query', 'when', 'limit', 'includeArchived', 'title', 'startsAt');
$$;

create or replace function public.assistant_call(p_token text, p_tool text, p_args jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  resolved jsonb;
  result jsonb;
  outcome text := 'ok';
  error_code text;
  error_message text;
begin
  resolved := public.resolve_assistant_token(p_token);
  begin
    if char_length(coalesce(p_tool, '')) not between 1 and 64 then
      perform public.raise_app_error('VALIDATION', 'Unknown tool.');
    end if;
    result := public.assistant_run_tool((resolved->>'workspaceId')::uuid, (resolved->>'tokenId')::uuid,
      (resolved->>'userId')::uuid, (resolved->>'role')::public.member_role, resolved->>'scope',
      p_tool, coalesce(p_args, '{}'::jsonb));
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics error_code = message_text, error_message = pg_exception_detail;
      outcome := error_code;
    when data_exception then
      error_code := 'VALIDATION';
      error_message := 'Check the tool arguments (IDs, numbers, and ISO 8601 times) and try again.';
      outcome := error_code;
  end;
  insert into public.assistant_actions (workspace_id, token_id, tool, arguments, outcome)
  values ((resolved->>'workspaceId')::uuid, (resolved->>'tokenId')::uuid,
    left(coalesce(p_tool, ''), 64), public.assistant_log_arguments(p_args), outcome);
  if outcome = 'ok' then
    return jsonb_build_object('ok', true, 'result', result);
  end if;
  return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', error_code, 'message', error_message));
end;
$$;

-- ---------------------------------------------------------------------------
-- Review in the app (owners and organizers).

create function public.list_event_plan_drafts(p_workspace_id uuid, p_include_decided boolean)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  return coalesce((
    select jsonb_agg(public.plan_draft_to_json(d) order by (d.status = 'pending') desc, d.created_at desc, d.id)
    from (
      select * from public.event_plan_drafts
      where workspace_id = p_workspace_id and (coalesce(p_include_decided, false) or status = 'pending')
      order by (status = 'pending') desc, created_at desc, id
      limit 100
    ) d
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_event_plan_drafts(uuid, boolean) from public, anon, authenticated;
grant execute on function public.list_event_plan_drafts(uuid, boolean) to authenticated;

create function public.get_event_plan_draft(p_workspace_id uuid, p_draft_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare draft public.event_plan_drafts;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into draft from public.event_plan_drafts where workspace_id = p_workspace_id and id = p_draft_id;
  if draft.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  return public.plan_draft_to_json(draft);
end;
$$;
revoke all on function public.get_event_plan_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_event_plan_draft(uuid, uuid) to authenticated;

-- Accepts a pending draft as a new Draft-status event. `p_changes` may set
-- title, startsAt, endsAt, timezone, includeVenue (boolean), and the
-- zero-based todoIndexes / scheduleIndexes to keep; omitted keys keep the
-- proposal. Schedule items and due dates stay relative to the (possibly
-- changed) start. Nobody is assigned.
create function public.accept_event_plan_draft(
  p_workspace_id uuid, p_draft_id uuid, p_changes jsonb, p_expected_version integer, p_request_key text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor public.memberships;
  existing jsonb;
  draft public.event_plan_drafts;
  changes jsonb := coalesce(p_changes, '{}'::jsonb);
  title text;
  starts timestamptz;
  ends timestamptz;
  tz text;
  venue uuid;
  start_day date;
  created public.events;
  item jsonb;
  idx integer;
  todo_count integer := 0;
  segment_count integer := 0;
  result jsonb;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  existing := public.peek_request('accept_event_plan_draft', p_request_key);
  if existing is not null then
    return existing;
  end if;
  select * into draft from public.event_plan_drafts
  where workspace_id = p_workspace_id and id = p_draft_id for update;
  if draft.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  if draft.status <> 'pending' or draft.version <> p_expected_version then
    perform public.raise_app_error('CONFLICT', 'This draft was already reviewed or changed. Reload it.');
  end if;

  title := coalesce(changes->>'title', draft.title);
  starts := coalesce((changes->>'startsAt')::timestamptz, draft.starts_at);
  ends := coalesce((changes->>'endsAt')::timestamptz, draft.ends_at);
  tz := coalesce(changes->>'timezone', draft.timezone);
  perform public.validate_event_inputs(title, draft.description, draft.location, starts, ends, tz, 'draft');
  if coalesce((changes->>'includeVenue')::boolean, true) and draft.venue_id is not null
    and exists (select 1 from public.venues where workspace_id = p_workspace_id and id = draft.venue_id and removed_at is null) then
    venue := draft.venue_id;
  end if;

  insert into public.events (workspace_id, title, description, location, starts_at, ends_at, timezone,
    created_by, team_briefing, venue_id)
  values (p_workspace_id, trim(title), draft.description, draft.location, starts, ends, tz,
    actor.user_id, draft.team_briefing, venue)
  returning * into created;
  start_day := (created.starts_at at time zone created.timezone)::date;

  for item, idx in select value, ordinality - 1 from jsonb_array_elements(draft.todos) with ordinality loop
    if changes ? 'todoIndexes' and not (changes->'todoIndexes' @> to_jsonb(idx)) then continue; end if;
    insert into public.tasks (workspace_id, event_id, title, notes, due_date, status, created_by)
    values (p_workspace_id, created.id, item->>'title', item->>'notes',
      case when item->>'dueDaysBeforeEvent' is null then null else start_day - (item->>'dueDaysBeforeEvent')::integer end,
      'todo', actor.user_id);
    todo_count := todo_count + 1;
  end loop;

  for item, idx in select value, ordinality - 1 from jsonb_array_elements(draft.schedule) with ordinality loop
    if changes ? 'scheduleIndexes' and not (changes->'scheduleIndexes' @> to_jsonb(idx)) then continue; end if;
    insert into public.schedule_segments (workspace_id, event_id, title, starts_at, ends_at, instructions)
    values (p_workspace_id, created.id, item->>'title',
      created.starts_at + make_interval(mins => (item->>'minutesFromStart')::integer),
      created.starts_at + make_interval(mins => (item->>'minutesFromStart')::integer + (item->>'durationMinutes')::integer),
      item->>'instructions');
    segment_count := segment_count + 1;
  end loop;

  update public.event_plan_drafts
  set status = 'accepted', decided_at = now(), decided_by = actor.user_id,
    accepted_event_id = created.id, version = version + 1
  where id = draft.id;
  perform public.write_audit(p_workspace_id, 'accept_event_plan_draft', 'event', created.id,
    jsonb_build_object('draftId', draft.id, 'assistantKeyId', draft.token_id,
      'citedEventIds', to_jsonb(draft.cited_event_ids), 'todos', todo_count, 'scheduleItems', segment_count));

  result := jsonb_build_object('eventId', created.id, 'todos', todo_count, 'scheduleItems', segment_count);
  return public.remember_request('accept_event_plan_draft', p_request_key, result);
end;
$$;
revoke all on function public.accept_event_plan_draft(uuid, uuid, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.accept_event_plan_draft(uuid, uuid, jsonb, integer, text) to authenticated;

create function public.discard_event_plan_draft(p_workspace_id uuid, p_draft_id uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor public.memberships;
  saved public.event_plan_drafts;
begin
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  update public.event_plan_drafts
  set status = 'discarded', decided_at = now(), decided_by = actor.user_id, version = version + 1
  where workspace_id = p_workspace_id and id = p_draft_id and status = 'pending' and version = p_expected_version
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This draft was already reviewed or changed. Reload it.');
  end if;
  perform public.write_audit(p_workspace_id, 'discard_event_plan_draft', 'event_plan_draft', saved.id, '{}'::jsonb);
  return public.plan_draft_to_json(saved);
end;
$$;
revoke all on function public.discard_event_plan_draft(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.discard_event_plan_draft(uuid, uuid, integer) to authenticated;
