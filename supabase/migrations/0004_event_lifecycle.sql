create table public.audit_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  actor_user_id uuid references auth.users (id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  occurred_at timestamptz not null default now(),
  safe_metadata jsonb not null default '{}'::jsonb
);

create index audit_workspace_idx on public.audit_entries (workspace_id, occurred_at desc);

create or replace function public.write_audit(
  p_workspace_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_entries (workspace_id, actor_user_id, action, entity_type, entity_id, safe_metadata)
  values (p_workspace_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.require_event_writable(p_workspace_id uuid, p_event_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  select * into ev from public.events where id = p_event_id and workspace_id = p_workspace_id;
  if ev.id is null then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  if ev.archived_at is not null then
    perform public.raise_app_error('FORBIDDEN', 'Restore this event before editing it.');
  end if;
  return ev;
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

alter table public.audit_entries enable row level security;
revoke all on table public.audit_entries from public, anon, authenticated;
revoke all on function public.update_event(uuid, uuid, text, text, text, timestamptz, timestamptz, text, uuid, public.event_status, integer) from public, anon;
revoke all on function public.archive_event(uuid, uuid, integer) from public, anon;
revoke all on function public.restore_event(uuid, uuid, integer) from public, anon;
grant execute on function public.update_event(uuid, uuid, text, text, text, timestamptz, timestamptz, text, uuid, public.event_status, integer) to authenticated;
grant execute on function public.archive_event(uuid, uuid, integer) to authenticated;
grant execute on function public.restore_event(uuid, uuid, integer) to authenticated;
