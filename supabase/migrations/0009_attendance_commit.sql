create or replace function public.receipt_to_json(p_batch public.attendance_batches)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_name text;
begin
  select pr.display_name into actor_name
  from public.profiles pr
  where pr.user_id = p_batch.created_by;
  return jsonb_build_object(
    'id', p_batch.id,
    'eventId', p_batch.event_id,
    'fileLabel', p_batch.file_label,
    'committedAt', p_batch.committed_at,
    'importedBy', actor_name,
    'added', coalesce((p_batch.outcome_counts ->> 'newAttendance')::integer, 0),
    'alreadyRecorded', coalesce((p_batch.outcome_counts ->> 'alreadyRecorded')::integer, 0),
    'skipped', coalesce((p_batch.outcome_counts ->> 'duplicates')::integer, 0)
      + coalesce((p_batch.outcome_counts ->> 'invalid')::integer, 0),
    'status', case when p_batch.reverted_at is null then 'active' else 'reverted' end,
    'revertedAt', p_batch.reverted_at
  );
end;
$$;

create or replace function public.event_attendance_count(p_workspace_id uuid, p_event_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.active_event_attendee_ids(p_workspace_id, p_event_id);
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
    if existing.id is not null then
      return public.receipt_to_json(existing);
    end if;
    perform public.raise_app_error('PREVIEW_EXPIRED', 'This preview expired. Start the import again.');
  end if;
  if preview.expires_at < now() then
    perform public.raise_app_error('PREVIEW_EXPIRED', 'This preview expired. Start the import again.');
  end if;

  perform 1 from public.workspaces where id = preview.workspace_id for update;
  actor := public.require_roles(preview.workspace_id, array['owner', 'organizer']::public.member_role[]);
  perform 1 from public.memberships where id = actor.id for update;
  ev := public.require_attendance_event(preview.workspace_id, preview.event_id);
  if preview.created_by is distinct from auth.uid() then
    perform public.raise_app_error('FORBIDDEN', 'You don’t have permission to do that.');
  end if;

  select * into existing
  from public.attendance_batches
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

create or replace function public.lookup_import_receipt(
  p_workspace_id uuid,
  p_event_id uuid,
  p_preview_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  batch public.attendance_batches;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into batch
  from public.attendance_batches
  where workspace_id = p_workspace_id
    and event_id = p_event_id
    and (preview_id = p_preview_id or idempotency_key = p_idempotency_key)
  limit 1;
  if batch.id is null then
    return null;
  end if;
  return public.receipt_to_json(batch);
end;
$$;

create or replace function public.event_to_json(p_event public.events)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lead_name text;
  lead_removed boolean;
  task_done integer;
  task_total integer;
  attendance_total integer;
begin
  if p_event.lead_membership_id is not null then
    select pr.display_name, m.removed_at is not null
    into lead_name, lead_removed
    from public.memberships m
    join public.profiles pr on pr.user_id = m.user_id
    where m.id = p_event.lead_membership_id;
  end if;
  select
    count(*) filter (where status = 'done'),
    count(*)
  into task_done, task_total
  from public.tasks
  where event_id = p_event.id and removed_at is null;
  attendance_total := public.event_attendance_count(p_event.workspace_id, p_event.id);

  return jsonb_build_object(
    'id', p_event.id,
    'workspaceId', p_event.workspace_id,
    'title', p_event.title,
    'description', p_event.description,
    'location', p_event.location,
    'startsAt', p_event.starts_at,
    'endsAt', p_event.ends_at,
    'timezone', p_event.timezone,
    'leadMembershipId', p_event.lead_membership_id,
    'leadName', lead_name,
    'leadFormer', coalesce(lead_removed, false),
    'status', p_event.status,
    'archivedAt', p_event.archived_at,
    'version', p_event.version,
    'createdBy', p_event.created_by,
    'taskDone', coalesce(task_done, 0),
    'taskTotal', coalesce(task_total, 0),
    'attendanceCount', attendance_total
  );
end;
$$;

revoke all on function public.commit_attendance_import(uuid, boolean, text) from public, anon;
revoke all on function public.lookup_import_receipt(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.event_attendance_count(uuid, uuid) from public, anon;
grant execute on function public.commit_attendance_import(uuid, boolean, text) to authenticated;
grant execute on function public.lookup_import_receipt(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.event_attendance_count(uuid, uuid) to authenticated;
