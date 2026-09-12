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

create or replace function public.list_removed_tasks(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer']::public.member_role[]);
  return coalesce((
    select jsonb_agg(public.task_to_json(t) order by t.removed_at desc)
    from public.tasks t
    where t.workspace_id = p_workspace_id
      and t.event_id = p_event_id
      and t.removed_at is not null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_workspace_tasks(
  p_workspace_id uuid,
  p_status text,
  p_assignee text,
  p_include_closed boolean,
  p_page integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.memberships;
  page integer;
  total integer;
  rows jsonb;
begin
  actor := public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  page := greatest(coalesce(p_page, 1), 1);

  select count(*) into total
  from public.tasks t
  join public.events e on e.id = t.event_id
  left join public.memberships am on am.id = t.assignee_membership_id
  where t.workspace_id = p_workspace_id
    and t.removed_at is null
    and (coalesce(p_include_closed, false) or (e.archived_at is null and e.status not in ('completed', 'canceled')))
    and (p_status is null or p_status = 'all' or (p_status = 'open' and t.status <> 'done') or (p_status = 'done' and t.status = 'done'))
    and (
      p_assignee is null or p_assignee = 'anyone'
      or (p_assignee = 'me' and t.assignee_membership_id = actor.id and am.removed_at is null)
      or (p_assignee = 'unassigned' and (t.assignee_membership_id is null or am.removed_at is not null))
      or t.assignee_membership_id::text = p_assignee
    );

  select coalesce(jsonb_agg(public.task_to_json(x) order by x.sort_key, x.due_date nulls last, x.created_at, x.id), '[]'::jsonb)
  into rows
  from (
    select t.*,
      case
        when t.status = 'done' then 3
        when public.task_overdue(t, e) then 0
        when t.due_date is not null then 1
        else 2
      end as sort_key
    from public.tasks t
    join public.events e on e.id = t.event_id
    left join public.memberships am on am.id = t.assignee_membership_id
    where t.workspace_id = p_workspace_id
      and t.removed_at is null
      and (coalesce(p_include_closed, false) or (e.archived_at is null and e.status not in ('completed', 'canceled')))
      and (p_status is null or p_status = 'all' or (p_status = 'open' and t.status <> 'done') or (p_status = 'done' and t.status = 'done'))
      and (
        p_assignee is null or p_assignee = 'anyone'
        or (p_assignee = 'me' and t.assignee_membership_id = actor.id and am.removed_at is null)
        or (p_assignee = 'unassigned' and (t.assignee_membership_id is null or am.removed_at is not null))
        or t.assignee_membership_id::text = p_assignee
      )
    order by sort_key, t.due_date nulls last, t.created_at, t.id
    offset (page - 1) * 50
    limit 50
  ) x;

  return jsonb_build_object('rows', rows, 'total', total, 'page', page);
end;
$$;

revoke all on function public.remove_task(uuid, uuid, integer) from public, anon;
revoke all on function public.restore_task(uuid, uuid, integer) from public, anon;
revoke all on function public.list_removed_tasks(uuid, uuid) from public, anon;
revoke all on function public.list_workspace_tasks(uuid, text, text, boolean, integer) from public, anon;
grant execute on function public.remove_task(uuid, uuid, integer) to authenticated;
grant execute on function public.restore_task(uuid, uuid, integer) to authenticated;
grant execute on function public.list_removed_tasks(uuid, uuid) to authenticated;
grant execute on function public.list_workspace_tasks(uuid, text, text, boolean, integer) to authenticated;
