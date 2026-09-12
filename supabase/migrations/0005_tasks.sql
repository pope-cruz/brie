create type public.task_status as enum ('todo', 'in_progress', 'done');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id),
  event_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  assignee_membership_id uuid,
  due_date date,
  status public.task_status not null default 'todo',
  removed_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (workspace_id, id),
  foreign key (workspace_id, event_id) references public.events (workspace_id, id),
  foreign key (workspace_id, assignee_membership_id) references public.memberships (workspace_id, id)
);

create index tasks_event_idx on public.tasks (workspace_id, event_id, status, due_date, id);
create index tasks_assignee_idx on public.tasks (workspace_id, assignee_membership_id, status, due_date, id);

create trigger tasks_touch before update on public.tasks
  for each row execute procedure public.touch_updated_at();

create or replace function public.task_overdue(p_task public.tasks, p_event public.events)
returns boolean
language sql
stable
as $$
  select p_task.due_date is not null
    and p_task.status is distinct from 'done'
    and p_task.removed_at is null
    and p_event.archived_at is null
    and p_event.status not in ('completed', 'canceled')
    and p_task.due_date < ((now() at time zone p_event.timezone)::date);
$$;

create or replace function public.task_to_json(p_task public.tasks)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
  assignee_name text;
  assignee_removed boolean;
begin
  select * into ev from public.events where id = p_task.event_id;
  if p_task.assignee_membership_id is not null then
    select pr.display_name, m.removed_at is not null
    into assignee_name, assignee_removed
    from public.memberships m
    join public.profiles pr on pr.user_id = m.user_id
    where m.id = p_task.assignee_membership_id;
  end if;
  return jsonb_build_object(
    'id', p_task.id,
    'workspaceId', p_task.workspace_id,
    'eventId', p_task.event_id,
    'eventTitle', ev.title,
    'eventStatus', ev.status,
    'eventArchived', ev.archived_at is not null,
    'title', p_task.title,
    'notes', p_task.notes,
    'assigneeMembershipId', p_task.assignee_membership_id,
    'assigneeName', assignee_name,
    'assigneeFormer', coalesce(assignee_removed, false),
    'dueDate', p_task.due_date,
    'status', p_task.status,
    'removedAt', p_task.removed_at,
    'version', p_task.version,
    'overdue', public.task_overdue(p_task, ev)
  );
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
    'attendanceCount', null
  );
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

create or replace function public.list_event_tasks(
  p_workspace_id uuid,
  p_event_id uuid,
  p_status text,
  p_assignee text,
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
  if not exists (select 1 from public.events where id = p_event_id and workspace_id = p_workspace_id) then
    perform public.raise_app_error('UNAVAILABLE', 'This page isn’t available.');
  end if;
  page := greatest(coalesce(p_page, 1), 1);

  select count(*) into total
  from public.tasks t
  left join public.memberships am on am.id = t.assignee_membership_id
  where t.workspace_id = p_workspace_id
    and t.event_id = p_event_id
    and t.removed_at is null
    and (p_status is null or p_status = 'all' or (p_status = 'open' and t.status <> 'done') or (p_status = 'done' and t.status = 'done'))
    and (
      p_assignee is null or p_assignee = 'anyone'
      or (p_assignee = 'me' and t.assignee_membership_id = actor.id and am.removed_at is null)
      or (p_assignee = 'unassigned' and (t.assignee_membership_id is null or am.removed_at is not null))
      or t.assignee_membership_id::text = p_assignee
    );

  select coalesce(jsonb_agg(public.task_to_json(x) order by x.sort_key, x.created_at, x.id), '[]'::jsonb)
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
      and t.event_id = p_event_id
      and t.removed_at is null
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

create or replace function public.list_overview_tasks(p_workspace_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_roles(p_workspace_id, array['owner', 'organizer', 'member']::public.member_role[]);
  return coalesce((
    select jsonb_agg(public.task_to_json(x) order by x.sort_key, x.due_date nulls last, x.created_at)
    from (
      select t.*,
        case
          when public.task_overdue(t, e) then 0
          when t.due_date is not null then 1
          else 2
        end as sort_key
      from public.tasks t
      join public.events e on e.id = t.event_id
      where t.event_id = p_event_id
        and t.workspace_id = p_workspace_id
        and t.removed_at is null
        and t.status <> 'done'
      order by sort_key, t.due_date nulls last, t.created_at
      limit 5
    ) x
  ), '[]'::jsonb);
end;
$$;

alter table public.tasks enable row level security;
revoke all on table public.tasks from public, anon, authenticated;
revoke all on function public.save_task(uuid, uuid, uuid, text, text, uuid, date, public.task_status, integer, text) from public, anon;
revoke all on function public.set_task_status(uuid, uuid, public.task_status, integer) from public, anon;
revoke all on function public.list_event_tasks(uuid, uuid, text, text, integer) from public, anon;
revoke all on function public.list_overview_tasks(uuid, uuid) from public, anon;
grant execute on function public.save_task(uuid, uuid, uuid, text, text, uuid, date, public.task_status, integer, text) to authenticated;
grant execute on function public.set_task_status(uuid, uuid, public.task_status, integer) to authenticated;
grant execute on function public.list_event_tasks(uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.list_overview_tasks(uuid, uuid) to authenticated;
