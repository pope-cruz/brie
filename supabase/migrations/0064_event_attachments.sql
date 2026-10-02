-- Files and links attached to an event: partnership docs, slides, orders, receipts.
-- A file's bytes live in the private `event-files` Storage bucket under
-- `<workspace id>/<event id>/<attachment id>/<file name>`; this table is the record of it.
-- Everyone in the workspace can open them; owners and organizers add, remove, and restore.
create table public.event_attachments (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id),
  event_id uuid not null,
  kind text not null check (kind in ('file', 'link')),
  title text not null check (char_length(title) between 1 and 200),
  url text check (url is null or (char_length(url) <= 2000 and url ~* '^https?://[^[:space:]]+$')),
  storage_path text check (storage_path is null or char_length(storage_path) <= 500),
  content_type text not null default '' check (char_length(content_type) <= 200),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  removed_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id),
  check ((kind = 'link' and url is not null and storage_path is null)
      or (kind = 'file' and storage_path is not null and url is null))
);
create index event_attachments_event_idx on public.event_attachments (workspace_id, event_id, removed_at, created_at);
create trigger event_attachments_touch before update on public.event_attachments
  for each row execute procedure public.touch_updated_at();
alter table public.event_attachments enable row level security;
revoke all on table public.event_attachments from public, anon, authenticated;

create function public.event_attachment_to_json(p_item public.event_attachments)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_item.id, 'eventId', p_item.event_id, 'kind', p_item.kind,
    'title', p_item.title, 'url', p_item.url, 'storagePath', p_item.storage_path,
    'contentType', p_item.content_type, 'sizeBytes', p_item.size_bytes,
    'createdAt', p_item.created_at,
    'createdByName', coalesce((select p.display_name from public.profiles p where p.user_id = p_item.created_by), ''),
    'removedAt', p_item.removed_at, 'version', p_item.version
  );
$$;
revoke all on function public.event_attachment_to_json(public.event_attachments) from public, anon, authenticated;

create function public.list_event_attachments(p_workspace_id uuid, p_event_id uuid, p_include_removed boolean)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare member public.memberships;
begin
  member := public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  if not exists (select 1 from public.events where workspace_id = p_workspace_id and id = p_event_id) then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  return coalesce((
    select jsonb_agg(public.event_attachment_to_json(a) order by a.created_at, a.id)
    from public.event_attachments a
    where a.workspace_id = p_workspace_id and a.event_id = p_event_id
      and (a.removed_at is null
        or (coalesce(p_include_removed, false) and member.role in ('owner', 'organizer')))
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_event_attachments(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.list_event_attachments(uuid, uuid, boolean) to authenticated;

-- The client picks the id (and uploads a file under it first), so a retried add is a no-op.
-- For a file, the size and type come from the stored object, not from the browser.
create function public.add_event_attachment(
  p_workspace_id uuid, p_event_id uuid, p_attachment_id uuid, p_kind text,
  p_title text, p_url text, p_storage_path text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  saved public.event_attachments;
  object_meta jsonb;
begin
  perform 1 from public.workspaces where id = p_workspace_id for update;
  perform public.require_event_writable(p_workspace_id, p_event_id);
  select * into saved from public.event_attachments where id = p_attachment_id;
  if saved.id is not null then
    if saved.workspace_id <> p_workspace_id or saved.event_id <> p_event_id then
      perform public.raise_app_error('CONFLICT', 'Try adding it again.');
    end if;
    return public.event_attachment_to_json(saved);
  end if;
  if p_attachment_id is null
    or char_length(trim(coalesce(p_title, ''))) not between 1 and 200
    or p_kind is null or p_kind not in ('file', 'link')
    or (p_kind = 'link' and (p_url is null or char_length(p_url) > 2000 or p_url !~* '^https?://[^[:space:]]+$'))
    or (p_kind = 'file' and (p_storage_path is null or char_length(p_storage_path) > 500
      or p_storage_path not like p_workspace_id::text || '/' || p_event_id::text || '/' || p_attachment_id::text || '/%'))
  then
    perform public.raise_app_error('VALIDATION', 'Check the file or link and try again.');
  end if;
  if (select count(*) from public.event_attachments
      where workspace_id = p_workspace_id and event_id = p_event_id and removed_at is null) >= 100 then
    perform public.raise_app_error('LIMIT_EXCEEDED', 'An event can hold 100 files and links. Remove some first.');
  end if;
  if p_kind = 'file' then
    select o.metadata into object_meta from storage.objects o
    where o.bucket_id = 'event-files' and o.name = p_storage_path;
    if not found then
      perform public.raise_app_error('VALIDATION', 'The upload didn’t finish. Try again.');
    end if;
  end if;
  insert into public.event_attachments (id, workspace_id, event_id, kind, title, url, storage_path,
    content_type, size_bytes, created_by)
  values (p_attachment_id, p_workspace_id, p_event_id, p_kind, trim(p_title),
    case when p_kind = 'link' then p_url end,
    case when p_kind = 'file' then p_storage_path end,
    left(coalesce(object_meta->>'mimetype', ''), 200),
    (object_meta->>'size')::bigint,
    auth.uid())
  returning * into saved;
  perform public.write_audit(p_workspace_id, 'add_event_attachment', 'event_attachment', saved.id,
    jsonb_build_object('eventId', p_event_id, 'kind', p_kind));
  return public.event_attachment_to_json(saved);
end;
$$;
revoke all on function public.add_event_attachment(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.add_event_attachment(uuid, uuid, uuid, text, text, text, text) to authenticated;

create function public.remove_event_attachment(p_workspace_id uuid, p_attachment_id uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare saved public.event_attachments;
begin
  select * into saved from public.event_attachments where id = p_attachment_id and workspace_id = p_workspace_id;
  if saved.id is null then
    perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  perform public.require_event_writable(p_workspace_id, saved.event_id);
  update public.event_attachments set removed_at = now(), version = version + 1
  where id = p_attachment_id and workspace_id = p_workspace_id
    and version = p_expected_version and removed_at is null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This item changed. Reload the latest version.');
  end if;
  perform public.write_audit(p_workspace_id, 'remove_event_attachment', 'event_attachment', saved.id, '{}'::jsonb);
  return public.event_attachment_to_json(saved);
end;
$$;
revoke all on function public.remove_event_attachment(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.remove_event_attachment(uuid, uuid, integer) to authenticated;

create function public.restore_event_attachment(p_workspace_id uuid, p_attachment_id uuid, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare saved public.event_attachments;
begin
  select * into saved from public.event_attachments where id = p_attachment_id and workspace_id = p_workspace_id;
  if saved.id is null then
    perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  perform public.require_event_writable(p_workspace_id, saved.event_id);
  update public.event_attachments set removed_at = null, version = version + 1
  where id = p_attachment_id and workspace_id = p_workspace_id
    and version = p_expected_version and removed_at is not null
  returning * into saved;
  if saved.id is null then
    perform public.raise_app_error('CONFLICT', 'This item changed. Reload the latest version.');
  end if;
  perform public.write_audit(p_workspace_id, 'restore_event_attachment', 'event_attachment', saved.id, '{}'::jsonb);
  return public.event_attachment_to_json(saved);
end;
$$;
revoke all on function public.restore_event_attachment(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.restore_event_attachment(uuid, uuid, integer) to authenticated;

-- Storage access check, called by the bucket's policies with the object name.
-- Reading needs any active membership in the workspace that owns the event.
-- Uploading needs owner/organizer on an event that isn't archived, under a fresh attachment id.
create function public.event_file_access(p_object_name text, p_write boolean)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  parts text[] := string_to_array(p_object_name, '/');
  ws uuid;
  ev uuid;
  member public.memberships;
begin
  if array_length(parts, 1) <> 4
    or parts[1] !~ '^[0-9a-f-]{36}$' or parts[2] !~ '^[0-9a-f-]{36}$' or parts[3] !~ '^[0-9a-f-]{36}$'
    or parts[4] = '' then
    return false;
  end if;
  ws := parts[1]::uuid;
  ev := parts[2]::uuid;
  member := public.active_membership(ws);
  if member.id is null then
    return false;
  end if;
  if not p_write then
    return exists (select 1 from public.events where workspace_id = ws and id = ev);
  end if;
  return member.role in ('owner', 'organizer')
    and exists (select 1 from public.events where workspace_id = ws and id = ev and archived_at is null)
    and not exists (select 1 from public.event_attachments where id = parts[3]::uuid);
end;
$$;
revoke all on function public.event_file_access(text, boolean) from public, anon, authenticated;
grant execute on function public.event_file_access(text, boolean) to authenticated;

-- The bucket and its policies need the Storage service's tables. A database started
-- without Storage (the CI database job) skips this block; every full stack has them.
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Storage tables not present; skipping the event-files bucket.';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('event-files', 'event-files', false, 26214400)
  on conflict (id) do update set public = false, file_size_limit = 26214400;
  create policy "event files are readable by workspace members" on storage.objects
    for select to authenticated
    using (bucket_id = 'event-files' and public.event_file_access(name, false));
  create policy "event files are uploaded by organizers" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'event-files' and public.event_file_access(name, true));
end;
$$;
