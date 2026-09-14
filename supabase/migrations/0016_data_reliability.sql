-- Serialize workspace mutations before authorization and version checks. Membership
-- removal/role transfer already take this lock. Using the same lock prevents stale
-- permissions, assignments, archive state and retry lookups from racing those writes.
-- Workspace-level serialization is intentional for the small-team MVP; measure at
-- the 5,000-row limit. Replacements keep the existing signatures and execute ACLs.


create or replace function public.create_event(
  p_workspace_id uuid,
  p_title text,
  p_description text,
  p_location text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_lead_membership_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  existing jsonb;
  created public.events;
  result jsonb;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  existing := public.peek_request('create_event', p_request_key);
  if existing is not null then
    return existing;
  end if;
  perform public.validate_event_inputs(p_title, p_description, p_location, p_starts_at, p_ends_at, p_timezone, 'draft');
  perform public.assert_active_lead(p_workspace_id, p_lead_membership_id);

  insert into public.events (
    workspace_id, title, description, location, starts_at, ends_at, timezone, lead_membership_id, created_by
  ) values (
    p_workspace_id,
    trim(p_title),
    coalesce(p_description, ''),
    coalesce(p_location, ''),
    p_starts_at,
    p_ends_at,
    p_timezone,
    p_lead_membership_id,
    actor.user_id
  ) returning * into created;

  result := public.event_to_json(created);
  return public.remember_request('create_event', p_request_key, result);
end;
$$;

create or replace function public.update_event(
  p_workspace_id uuid,
  p_event_id uuid,
  p_title text,
  p_description text,
  p_location text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_lead_membership_id uuid,
  p_status public.event_status,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.events;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_event_writable(p_workspace_id, p_event_id);
  perform public.validate_event_inputs(p_title, p_description, p_location, p_starts_at, p_ends_at, p_timezone, p_status);
  perform public.assert_active_lead(p_workspace_id, p_lead_membership_id);

  update public.events
  set
    title = trim(p_title),
    description = coalesce(p_description, ''),
    location = coalesce(p_location, ''),
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    timezone = p_timezone,
    lead_membership_id = p_lead_membership_id,
    status = p_status,
    version = version + 1
  where id = p_event_id
    and workspace_id = p_workspace_id
    and version = p_expected_version
    and archived_at is null
  returning * into updated;

  if updated.id is null then
    perform public.raise_app_error('CONFLICT', 'This event changed. Reload the latest version.');
  end if;
  return public.event_to_json(updated);
end;
$$;

create or replace function public.archive_event(
  p_workspace_id uuid,
  p_event_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.events;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  update public.events
  set archived_at = now(), version = version + 1
  where id = p_event_id
    and workspace_id = p_workspace_id
    and version = p_expected_version
    and archived_at is null
  returning * into updated;
  if updated.id is null then
    perform public.raise_app_error('CONFLICT', 'This event changed. Reload the latest version.');
  end if;
  perform public.write_audit(p_workspace_id, 'archive_event', 'event', p_event_id, '{}'::jsonb);
  return public.event_to_json(updated);
end;
$$;

create or replace function public.restore_event(
  p_workspace_id uuid,
  p_event_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.events;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  update public.events
  set archived_at = null, version = version + 1
  where id = p_event_id
    and workspace_id = p_workspace_id
    and version = p_expected_version
    and archived_at is not null
  returning * into updated;
  if updated.id is null then
    perform public.raise_app_error('CONFLICT', 'This event changed. Reload the latest version.');
  end if;
  perform public.write_audit(p_workspace_id, 'restore_event', 'event', p_event_id, '{}'::jsonb);
  return public.event_to_json(updated);
end;
$$;

create or replace function public.save_task(
  p_workspace_id uuid,
  p_event_id uuid,
  p_task_id uuid,
  p_title text,
  p_notes text,
  p_assignee_membership_id uuid,
  p_due_date date,
  p_status public.task_status,
  p_expected_version integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  ev public.events;
  existing jsonb;
  saved public.tasks;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  ev := public.require_event_writable(p_workspace_id, p_event_id);

  if p_task_id is null then
    existing := public.peek_request('save_task', p_request_key);
    if existing is not null then
      return existing;
    end if;
  end if;

  if char_length(trim(coalesce(p_title, ''))) < 1 or char_length(trim(p_title)) > 200 then
    perform public.raise_app_error('VALIDATION', 'Enter a task title up to 200 characters.', jsonb_build_object('title', 'Enter a title up to 200 characters.'));
  end if;
  if char_length(coalesce(p_notes, '')) > 2000 then
    perform public.raise_app_error('VALIDATION', 'Notes must be 2,000 characters or fewer.', jsonb_build_object('notes', 'Use 2,000 characters or fewer.'));
  end if;
  perform public.assert_active_lead(p_workspace_id, p_assignee_membership_id);

  if p_task_id is null then
    insert into public.tasks (
      workspace_id, event_id, title, notes, assignee_membership_id, due_date, status, created_by
    ) values (
      p_workspace_id, p_event_id, trim(p_title), coalesce(p_notes, ''), p_assignee_membership_id, p_due_date, coalesce(p_status, 'todo'), actor.user_id
    ) returning * into saved;
    return public.remember_request('save_task', p_request_key, public.task_to_json(saved));
  end if;

  update public.tasks
  set
    title = trim(p_title),
    notes = coalesce(p_notes, ''),
    assignee_membership_id = p_assignee_membership_id,
    due_date = p_due_date,
    status = p_status,
    version = version + 1
  where id = p_task_id
    and workspace_id = p_workspace_id
    and event_id = p_event_id
    and version = p_expected_version
    and removed_at is null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This task changed. Reload the latest version.');
  end if;
  return public.task_to_json(saved);
end;
$$;

create or replace function public.set_task_status(
  p_workspace_id uuid,
  p_task_id uuid,
  p_status public.task_status,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  ev public.events;
  current public.tasks;
  saved public.tasks;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  select * into current from public.tasks where id = p_task_id and workspace_id = p_workspace_id;
  if current.id is null or current.removed_at is not null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  select * into ev from public.events where id = current.event_id;
  if ev.archived_at is not null then
    perform public.raise_app_error('FORBIDDEN', 'Restore this event before editing it.');
  end if;
  if actor.role = 'member' then
    if current.assignee_membership_id is distinct from actor.id then
      perform public.raise_app_error('FORBIDDEN', 'You can only update tasks assigned to you.');
    end if;
  end if;

  update public.tasks
  set status = p_status, version = version + 1
  where id = p_task_id
    and version = p_expected_version
    and removed_at is null
    and (
      actor.role <> 'member'
      or assignee_membership_id = actor.id
    )
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This task changed. Reload the latest version.');
  end if;
  return public.task_to_json(saved);
end;
$$;

create or replace function public.remove_task(
  p_workspace_id uuid,
  p_task_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.tasks;
  saved public.tasks;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  select * into current from public.tasks where id = p_task_id and workspace_id = p_workspace_id;
  if current.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  perform public.require_event_writable(p_workspace_id, current.event_id);
  update public.tasks
  set removed_at = now(), version = version + 1
  where id = p_task_id and version = p_expected_version and removed_at is null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This task changed. Reload the latest version.');
  end if;
  return public.task_to_json(saved);
end;
$$;

create or replace function public.restore_task(
  p_workspace_id uuid,
  p_task_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.tasks;
  saved public.tasks;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  select * into current from public.tasks where id = p_task_id and workspace_id = p_workspace_id;
  if current.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  perform public.require_event_writable(p_workspace_id, current.event_id);
  update public.tasks
  set removed_at = null, version = version + 1
  where id = p_task_id and version = p_expected_version and removed_at is not null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This task changed. Reload the latest version.');
  end if;
  return public.task_to_json(saved);
end;
$$;

create or replace function public.save_segment(
  p_workspace_id uuid,
  p_event_id uuid,
  p_segment_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_owner_membership_id uuid,
  p_instructions text,
  p_ack_warnings boolean,
  p_expected_version integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  existing jsonb;
  saved public.schedule_segments;
  flags jsonb;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  ev := public.require_event_writable(p_workspace_id, p_event_id);
  if p_segment_id is null then
    existing := public.peek_request('save_segment', p_request_key);
    if existing is not null then
      return existing;
    end if;
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 1 or char_length(trim(p_title)) > 120 then
    perform public.raise_app_error('VALIDATION', 'Enter a segment title up to 120 characters.', jsonb_build_object('title', 'Enter a title up to 120 characters.'));
  end if;
  if p_ends_at <= p_starts_at then
    perform public.raise_app_error('VALIDATION', 'End must be after start.', jsonb_build_object('endsAt', 'End must be after start.'));
  end if;
  if char_length(coalesce(p_instructions, '')) > 4000 then
    perform public.raise_app_error('VALIDATION', 'Instructions must be 4,000 characters or fewer.');
  end if;
  perform public.assert_active_lead(p_workspace_id, p_owner_membership_id);

  if p_segment_id is null then
    insert into public.schedule_segments (
      workspace_id, event_id, title, starts_at, ends_at, owner_membership_id, instructions
    ) values (
      p_workspace_id, p_event_id, trim(p_title), p_starts_at, p_ends_at, p_owner_membership_id, coalesce(p_instructions, '')
    ) returning * into saved;
  else
    update public.schedule_segments
    set title = trim(p_title),
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        owner_membership_id = p_owner_membership_id,
        instructions = coalesce(p_instructions, ''),
        version = version + 1
    where id = p_segment_id
      and workspace_id = p_workspace_id
      and version = p_expected_version
      and removed_at is null
    returning * into saved;
    if saved.id is null then
      perform public.raise_app_error('CONFLICT', 'This segment changed. Reload the latest version.');
    end if;
  end if;

  flags := public.segment_flags(saved, ev);
  if coalesce(p_ack_warnings, false) is not true
     and ((flags ->> 'overlaps')::boolean or (flags ->> 'outOfRange')::boolean) then
    perform public.raise_app_error(
      'VALIDATION',
      'This segment overlaps another segment or falls outside the event time. Confirm to save it anyway.',
      jsonb_build_object('warnings', flags)
    );
  end if;

  if p_segment_id is null then
    return public.remember_request('save_segment', p_request_key, public.segment_to_json(saved));
  end if;
  return public.segment_to_json(saved);
end;
$$;

create or replace function public.remove_segment(p_workspace_id uuid, p_segment_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.schedule_segments;
  saved public.schedule_segments;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  select * into current from public.schedule_segments where id = p_segment_id and workspace_id = p_workspace_id;
  if current.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  perform public.require_event_writable(p_workspace_id, current.event_id);
  update public.schedule_segments
  set removed_at = now(), version = version + 1
  where id = p_segment_id and version = p_expected_version and removed_at is null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This segment changed. Reload the latest version.');
  end if;
  return public.segment_to_json(saved);
end;
$$;

create or replace function public.restore_segment(p_workspace_id uuid, p_segment_id uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current public.schedule_segments;
  saved public.schedule_segments;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  select * into current from public.schedule_segments where id = p_segment_id and workspace_id = p_workspace_id;
  if current.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  perform public.require_event_writable(p_workspace_id, current.event_id);
  update public.schedule_segments
  set removed_at = null, version = version + 1
  where id = p_segment_id and version = p_expected_version and removed_at is not null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This segment changed. Reload the latest version.');
  end if;
  return public.segment_to_json(saved);
end;
$$;

create or replace function public.duplicate_event(
  p_workspace_id uuid,
  p_source_event_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  source public.events;
  existing jsonb;
  created public.events;
  delta interval;
  seg public.schedule_segments;
  new_end timestamptz;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  existing := public.peek_request('duplicate_event', p_request_key);
  if existing is not null then
    return existing;
  end if;

  select * into source
  from public.events
  where id = p_source_event_id and workspace_id = p_workspace_id;
  if source.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;

  perform public.validate_event_inputs(p_title, source.description, source.location, p_starts_at, p_ends_at, p_timezone, 'draft');
  delta := p_starts_at - source.starts_at;

  insert into public.events (
    workspace_id, title, description, location, starts_at, ends_at, timezone, lead_membership_id, status, created_by
  ) values (
    p_workspace_id, trim(p_title), source.description, source.location, p_starts_at, p_ends_at, p_timezone, null, 'draft', actor.user_id
  ) returning * into created;

  insert into public.tasks (
    workspace_id, event_id, title, notes, assignee_membership_id, due_date, status, created_by
  )
  select workspace_id, created.id, title, notes, null, null, 'todo', actor.user_id
  from public.tasks
  where event_id = source.id and removed_at is null;

  for seg in
    select * from public.schedule_segments
    where event_id = source.id and removed_at is null
  loop
    new_end := (seg.starts_at + delta) + (seg.ends_at - seg.starts_at);
    insert into public.schedule_segments (
      workspace_id, event_id, title, starts_at, ends_at, owner_membership_id, instructions
    ) values (
      p_workspace_id, created.id, seg.title, seg.starts_at + delta, new_end, null, seg.instructions
    );
  end loop;

  return public.remember_request('duplicate_event', p_request_key, public.event_to_json(created));
end;
$$;

create or replace function public.save_workspace(
  p_workspace_id uuid,
  p_name text,
  p_timezone text,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.workspaces;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_roles(p_workspace_id, array['owner']::public.member_role[]);
  if char_length(trim(coalesce(p_name, ''))) < 1 or char_length(trim(p_name)) > 80 then
    perform public.raise_app_error('VALIDATION', 'Enter a workspace name between 1 and 80 characters.', jsonb_build_object('name', 'Enter a name between 1 and 80 characters.'));
  end if;
  if not public.is_valid_timezone(p_timezone) then
    perform public.raise_app_error('VALIDATION', 'Choose a valid time zone.', jsonb_build_object('timezone', 'Choose a valid time zone.'));
  end if;
  update public.workspaces
  set name = trim(p_name), timezone = p_timezone, version = version + 1
  where id = p_workspace_id and version = p_expected_version
  returning * into updated;
  if updated.id is null then
    perform public.raise_app_error('CONFLICT', 'Workspace settings changed. Reload the latest version.');
  end if;
  return jsonb_build_object(
    'id', updated.id,
    'name', updated.name,
    'timezone', updated.timezone,
    'version', updated.version
  );
end;
$$;

create or replace function public.prepare_attendance_import(
  p_workspace_id uuid,
  p_event_id uuid,
  p_file_label text,
  p_file_hash text,
  p_parser_version text,
  p_mapping jsonb,
  p_rows jsonb,
  p_blank_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  revision integer;
  outcomes jsonb := '[]'::jsonb;
  accepted jsonb := '[]'::jsonb;
  n_new integer := 0;
  n_existing integer := 0;
  n_dup integer := 0;
  n_invalid integer := 0;
  existing_receipt uuid;
  preview public.import_previews;
  label text;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  actor := public.active_membership(p_workspace_id);
  perform public.require_attendance_event(p_workspace_id, p_event_id);
  label := left(trim(coalesce(p_file_label, 'attendance.csv')), 120);
  if label = '' then label := 'attendance.csv'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    perform public.raise_app_error('VALIDATION', 'No attendance rows were sent.');
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    perform public.raise_app_error('LIMIT_EXCEEDED', 'This file has more than 5,000 data rows.');
  end if;
  if jsonb_array_length(p_rows) = 0 then
    perform public.raise_app_error('VALIDATION', 'This file has no attendance rows. Choose another file.');
  end if;

  insert into public.event_attendance_revisions (workspace_id, event_id, version)
  values (p_workspace_id, p_event_id, 1)
  on conflict (workspace_id, event_id) do nothing;
  select version into revision
  from public.event_attendance_revisions
  where workspace_id = p_workspace_id and event_id = p_event_id;

  -- Normalize/rank once and aggregate once. Repeated JSON concatenation and a
  -- distinct-attendance query per row made a 5,000-row reimport exceed 25 seconds.
  with normalized as materialized (
    select ord,
      coalesce((item ->> 'rowNumber')::integer, 0) as source_row,
      public.normalize_email(coalesce(item ->> 'email', '')) as email,
      left(trim(coalesce(item ->> 'name', '')), 200) as name
    from jsonb_array_elements(p_rows) with ordinality as r(item, ord)
  ), ranked as (
    select *, row_number() over (partition by email order by ord) as occurrence
    from normalized
  ), active as materialized (
    select attendee_id from public.active_event_attendee_ids(p_workspace_id, p_event_id)
  ), classified as (
    select r.*, a.display_name as stored_name,
      case when not public.is_plausible_email(r.email) then 'invalid'
        when r.occurrence > 1 then 'duplicate'
        when active.attendee_id is not null then 'already_recorded'
        else 'new' end as outcome
    from ranked r
    left join public.attendees a on a.workspace_id = p_workspace_id and a.email_normalized = r.email
    left join active on active.attendee_id = a.id
  )
  select
    count(*) filter (where outcome = 'new'),
    count(*) filter (where outcome = 'already_recorded'),
    count(*) filter (where outcome = 'duplicate'),
    count(*) filter (where outcome = 'invalid'),
    coalesce(jsonb_agg(jsonb_build_object(
      'rowNumber', source_row, 'email', email, 'name', name
    ) order by ord) filter (where outcome in ('new', 'already_recorded')), '[]'::jsonb),
    jsonb_agg(jsonb_build_object(
      'rowNumber', source_row, 'email', email,
      'name', case when outcome = 'already_recorded' then coalesce(stored_name, name) else name end,
      'outcome', outcome,
      'reason', case outcome
        when 'invalid' then 'This email is not valid.'
        when 'duplicate' then 'This email already appears earlier in the file.'
        when 'new' then 'New attendance for this event.'
        else case when stored_name is not null and name <> '' and stored_name <> name
          then 'Already recorded. The stored name will be kept.'
          else 'Already recorded at this event.' end
        end
    ) order by ord)
  into n_new, n_existing, n_dup, n_invalid, accepted, outcomes
  from classified;

  select b.id into existing_receipt
  from public.attendance_batches b
  where b.workspace_id = p_workspace_id
    and b.event_id = p_event_id
    and b.file_hash = p_file_hash
    and b.reverted_at is null
  order by b.committed_at desc
  limit 1;

  insert into public.import_previews (
    workspace_id, event_id, created_by, expires_at, attendance_version, parser_version,
    mapping, file_label, file_hash, accepted_rows, outcome_counts, row_outcomes
  ) values (
    p_workspace_id, p_event_id, actor.user_id, now() + interval '24 hours', revision,
    coalesce(p_parser_version, 'brie-csv-1'),
    coalesce(p_mapping, '{}'::jsonb),
    label,
    coalesce(p_file_hash, ''),
    accepted,
    jsonb_build_object(
      'newAttendance', n_new,
      'alreadyRecorded', n_existing,
      'duplicates', n_dup,
      'invalid', n_invalid,
      'blank', coalesce(p_blank_count, 0),
      'accepted', n_new + n_existing
    ),
    outcomes
  ) returning * into preview;

  return jsonb_build_object(
    'id', preview.id,
    'eventId', p_event_id,
    'expiresAt', preview.expires_at,
    'attendanceVersion', revision,
    'fileLabel', preview.file_label,
    'fileHash', preview.file_hash,
    'existingReceiptId', existing_receipt,
    'counts', preview.outcome_counts,
    'rows', preview.row_outcomes
  );
end;
$$;

create or replace function public.commit_attendance_import(
  p_preview_id uuid,
  p_skip_invalid_ack boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preview public.import_previews;
  ev public.events;
  actor public.memberships;
  current_version integer;
  existing public.attendance_batches;
  batch public.attendance_batches;
  accepted_item jsonb;
  email_norm text;
  name_norm text;
  attendee_id uuid;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    perform public.raise_app_error('VALIDATION', 'A request key is required.');
  end if;

  select * into preview from public.import_previews where id = p_preview_id;
  if preview.id is null then
    select * into existing from public.attendance_batches where preview_id = p_preview_id;
    if existing.id is null then
      perform public.raise_app_error('PREVIEW_EXPIRED', 'This preview expired. Start the import again.');
    end if;
    -- Receipt recovery still requires current permission and the original creator.
    perform 1 from public.workspaces where id = existing.workspace_id for update;
    perform public.require_roles(existing.workspace_id, array['owner', 'organizer']::public.member_role[]);
    if existing.created_by is distinct from auth.uid() then
      perform public.raise_app_error('FORBIDDEN', 'You don’t have permission to do that.');
    end if;
    if exists (select 1 from public.attendance_batches b
      where b.workspace_id = existing.workspace_id and b.idempotency_key = p_idempotency_key
        and b.preview_id <> p_preview_id) then
      perform public.raise_app_error('VALIDATION', 'This request key was already used for a different import.');
    end if;
    return public.receipt_to_json(existing);
  end if;

  perform 1 from public.workspaces where id = preview.workspace_id for update;
  actor := public.require_roles(preview.workspace_id, array['owner', 'organizer']::public.member_role[]);
  if preview.created_by is distinct from auth.uid() then
    perform public.raise_app_error('FORBIDDEN', 'You don’t have permission to do that.');
  end if;

  select * into existing from public.attendance_batches
  where workspace_id = preview.workspace_id and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.preview_id = p_preview_id then
      return public.receipt_to_json(existing);
    end if;
    perform public.raise_app_error('VALIDATION', 'This request key was already used for a different import.');
  end if;
  select * into existing from public.attendance_batches where preview_id = p_preview_id;
  if existing.id is not null then
    return public.receipt_to_json(existing);
  end if;

  -- Only a new commit needs a live preview and writable event. A retry after an
  -- expired preview or archived event returns the already-committed receipt.
  select * into preview from public.import_previews where id = p_preview_id for update;
  if preview.id is null or preview.expires_at < clock_timestamp() then
    perform public.raise_app_error('PREVIEW_EXPIRED', 'This preview expired. Start the import again.');
  end if;
  ev := public.require_attendance_event(preview.workspace_id, preview.event_id);

  if coalesce((preview.outcome_counts ->> 'accepted')::integer, 0) <= 0 then
    perform public.raise_app_error('VALIDATION', 'There are no valid unique rows to record.');
  end if;
  if coalesce((preview.outcome_counts ->> 'invalid')::integer, 0) > 0
     and coalesce(p_skip_invalid_ack, preview.skip_invalid_ack) is not true then
    perform public.raise_app_error('VALIDATION', 'Acknowledge skipped invalid rows before recording attendance.');
  end if;

  insert into public.event_attendance_revisions (workspace_id, event_id, version)
  values (preview.workspace_id, preview.event_id, 1)
  on conflict (workspace_id, event_id) do nothing;
  select version into current_version
  from public.event_attendance_revisions
  where workspace_id = preview.workspace_id and event_id = preview.event_id
  for update;
  if current_version is distinct from preview.attendance_version then
    perform public.raise_app_error('CONFLICT', 'Attendance changed since this preview. Review the file again.');
  end if;

  insert into public.attendance_batches (
    workspace_id, event_id, created_by, file_label, file_hash, parser_version,
    outcome_counts, idempotency_key, preview_id
  ) values (
    preview.workspace_id, preview.event_id, actor.user_id, preview.file_label, preview.file_hash,
    preview.parser_version, preview.outcome_counts, p_idempotency_key, preview.id
  ) returning * into batch;

  for accepted_item in select value from jsonb_array_elements(preview.accepted_rows)
  loop
    email_norm := accepted_item ->> 'email';
    name_norm := nullif(trim(coalesce(accepted_item ->> 'name', '')), '');
    insert into public.attendees (workspace_id, email_normalized, display_name)
    values (preview.workspace_id, email_norm, name_norm)
    on conflict (workspace_id, email_normalized) do update
      set display_name = public.attendees.display_name
    returning id into attendee_id;
    if attendee_id is null then
      select id into attendee_id
      from public.attendees
      where workspace_id = preview.workspace_id and email_normalized = email_norm;
    end if;
    insert into public.attendance_contributions (
      workspace_id, event_id, batch_id, attendee_id, source_row_number
    ) values (
      preview.workspace_id, preview.event_id, batch.id, attendee_id,
      coalesce((accepted_item ->> 'rowNumber')::integer, 0)
    );
  end loop;

  update public.event_attendance_revisions
  set version = version + 1
  where workspace_id = preview.workspace_id and event_id = preview.event_id;

  update public.import_previews
  set accepted_rows = '[]'::jsonb,
      row_outcomes = '[]'::jsonb,
      skip_invalid_ack = true
  where id = preview.id;

  perform public.write_audit(
    preview.workspace_id,
    'commit_attendance_import',
    'attendance_batch',
    batch.id,
    jsonb_build_object(
      'added', (preview.outcome_counts ->> 'newAttendance')::integer,
      'alreadyRecorded', (preview.outcome_counts ->> 'alreadyRecorded')::integer
    )
  );

  return public.receipt_to_json(batch);
end;
$$;
