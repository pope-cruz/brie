create or replace function public.preview_revert_import(p_workspace_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  batch public.attendance_batches;
  revision integer;
  disappear integer;
  retained integer;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into batch from public.attendance_batches where id = p_batch_id and workspace_id = p_workspace_id;
  if batch.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  select version into revision
  from public.event_attendance_revisions
  where workspace_id = p_workspace_id and event_id = batch.event_id;

  if batch.reverted_at is not null then
    return jsonb_build_object(
      'batchId', batch.id,
      'alreadyReverted', true,
      'disappear', 0,
      'retained', 0,
      'attendanceVersion', revision,
      'batchVersion', batch.version
    );
  end if;

  select count(*) into disappear
  from public.attendance_contributions c
  where c.batch_id = batch.id
    and not exists (
      select 1
      from public.attendance_contributions o
      join public.attendance_batches b on b.id = o.batch_id
      where o.event_id = c.event_id
        and o.attendee_id = c.attendee_id
        and o.batch_id <> c.batch_id
        and b.reverted_at is null
    );

  select count(*) into retained
  from public.attendance_contributions c
  where c.batch_id = batch.id
    and exists (
      select 1
      from public.attendance_contributions o
      join public.attendance_batches b on b.id = o.batch_id
      where o.event_id = c.event_id
        and o.attendee_id = c.attendee_id
        and o.batch_id <> c.batch_id
        and b.reverted_at is null
    );

  return jsonb_build_object(
    'batchId', batch.id,
    'alreadyReverted', false,
    'disappear', disappear,
    'retained', retained,
    'attendanceVersion', revision,
    'batchVersion', batch.version
  );
end;
$$;

create or replace function public.revert_attendance_import(
  p_workspace_id uuid,
  p_batch_id uuid,
  p_expected_batch_version integer,
  p_expected_attendance_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.attendance_batches;
  ev public.events;
  current_version integer;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into batch from public.attendance_batches where id = p_batch_id and workspace_id = p_workspace_id for update;
  if batch.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  select * into ev from public.events where id = batch.event_id;
  if ev.archived_at is not null then
    perform public.raise_app_error('FORBIDDEN', 'Restore this event before changing attendance.');
  end if;
  if batch.reverted_at is not null then
    return public.receipt_to_json(batch);
  end if;
  select version into current_version
  from public.event_attendance_revisions
  where workspace_id = p_workspace_id and event_id = batch.event_id
  for update;
  if current_version is distinct from p_expected_attendance_version
     or batch.version is distinct from p_expected_batch_version then
    perform public.raise_app_error('CONFLICT', 'Attendance changed. Review the impact again.');
  end if;

  update public.attendance_batches
  set reverted_at = now(), reverted_by = auth.uid(), version = version + 1
  where id = batch.id
  returning * into batch;

  update public.event_attendance_revisions
  set version = version + 1
  where workspace_id = p_workspace_id and event_id = batch.event_id;

  perform public.write_audit(
    p_workspace_id,
    'revert_attendance_import',
    'attendance_batch',
    batch.id,
    '{}'::jsonb
  );
  return public.receipt_to_json(batch);
end;
$$;

create or replace function public.purge_expired_previews()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.import_previews
  where expires_at < now()
    and id not in (select preview_id from public.attendance_batches);
  get diagnostics deleted = row_count;
  update public.import_previews
  set accepted_rows = '[]'::jsonb, row_outcomes = '[]'::jsonb
  where expires_at < now();
  return deleted;
end;
$$;

revoke all on function public.preview_revert_import(uuid, uuid) from public, anon;
revoke all on function public.revert_attendance_import(uuid, uuid, integer, integer) from public, anon;
revoke all on function public.purge_expired_previews() from public, anon;
grant execute on function public.preview_revert_import(uuid, uuid) to authenticated;
grant execute on function public.revert_attendance_import(uuid, uuid, integer, integer) to authenticated;
