-- Task rules: members change only the status of their own tasks; stale versions conflict; archived events are read-only.
begin;
select plan(16);

insert into auth.users (id, email) values
 ('c2000000-0000-4000-8000-000000000001', 'task-owner@example.test'),
 ('c2000000-0000-4000-8000-000000000002', 'task-organizer@example.test'),
 ('c2000000-0000-4000-8000-000000000003', 'task-member-a@example.test'),
 ('c2000000-0000-4000-8000-000000000004', 'task-member-b@example.test'),
 ('c2000000-0000-4000-8000-000000000005', 'task-former@example.test');
insert into public.workspaces (id, name, timezone) values
 ('c2000000-0000-4000-8000-0000000000aa', 'Task rules test', 'UTC');
insert into public.memberships (id, workspace_id, user_id, role, email_normalized, removed_at) values
 ('c2000000-0000-4000-8000-0000000000b1', 'c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-000000000001', 'owner', 'task-owner@example.test', null),
 ('c2000000-0000-4000-8000-0000000000b2', 'c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-000000000002', 'organizer', 'task-organizer@example.test', null),
 ('c2000000-0000-4000-8000-0000000000b3', 'c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-000000000003', 'member', 'task-member-a@example.test', null),
 ('c2000000-0000-4000-8000-0000000000b4', 'c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-000000000004', 'member', 'task-member-b@example.test', null),
 ('c2000000-0000-4000-8000-0000000000b5', 'c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-000000000005', 'member', 'task-former@example.test', now());
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
 ('c2000000-0000-4000-8000-0000000000e1', 'c2000000-0000-4000-8000-0000000000aa', 'Task rules event', now() + interval '1 day', now() + interval '1 day 2 hours', 'UTC', 'c2000000-0000-4000-8000-000000000001');
insert into public.tasks (id, workspace_id, event_id, title, assignee_membership_id, created_by) values
 ('c2000000-0000-4000-8000-0000000000c1', 'c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1', 'Member A task', 'c2000000-0000-4000-8000-0000000000b3', 'c2000000-0000-4000-8000-000000000001'),
 ('c2000000-0000-4000-8000-0000000000c2', 'c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1', 'Member B task', 'c2000000-0000-4000-8000-0000000000b4', 'c2000000-0000-4000-8000-000000000001'),
 ('c2000000-0000-4000-8000-0000000000c3', 'c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1', 'Unassigned task', null, 'c2000000-0000-4000-8000-000000000001');

set local role authenticated;

-- Member A.
select set_config('request.jwt.claim.sub', 'c2000000-0000-4000-8000-000000000003', true);
select is(public.set_task_status('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000c1', 'done', 1)->>'status', 'done', 'Member completes a task assigned to them');
select throws_ok($$select public.set_task_status('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000c2', 'done', 1)$$, 'P0001', 'FORBIDDEN', 'Member cannot change a teammate''s task');
select throws_ok($$select public.set_task_status('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000c3', 'done', 1)$$, 'P0001', 'FORBIDDEN', 'Member cannot change an unassigned task');
select throws_ok($$select public.save_task('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1', 'c2000000-0000-4000-8000-0000000000c1', 'Renamed', '', 'c2000000-0000-4000-8000-0000000000b3', null, 'done', 2, null)$$, 'P0001', 'FORBIDDEN', 'Member cannot edit task details, even on their own task');
select throws_ok($$select public.save_task('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1', null, 'New task', '', null, null, 'todo', 1, 'member-create-task')$$, 'P0001', 'FORBIDDEN', 'Member cannot create tasks');
select throws_ok($$select public.remove_task('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000c1', 2)$$, 'P0001', 'FORBIDDEN', 'Member cannot remove tasks');
select throws_ok($$select public.list_removed_tasks('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1')$$, 'P0001', 'FORBIDDEN', 'Member cannot list removed tasks');
select throws_ok($$update public.tasks set status = 'done'$$, '42501', 'permission denied for table tasks', 'Direct task writes are denied');
select throws_ok($$select public.set_task_status('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000c1', 'todo', 1)$$, 'P0001', 'CONFLICT', 'A stale version is rejected instead of overwriting');

-- Organizer.
select set_config('request.jwt.claim.sub', 'c2000000-0000-4000-8000-000000000002', true);
select is(public.set_task_status('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000c2', 'in_progress', 1)->>'status', 'in_progress', 'Organizer can change any task status');
select is(public.save_task('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1', 'c2000000-0000-4000-8000-0000000000c3', 'Set up tables', '', 'c2000000-0000-4000-8000-0000000000b4', null, 'todo', 1, null)->>'assigneeMembershipId', 'c2000000-0000-4000-8000-0000000000b4', 'Organizer can assign a task');
select throws_ok($$select public.save_task('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1', 'c2000000-0000-4000-8000-0000000000c3', 'Other writer', '', null, null, 'todo', 1, null)$$, 'P0001', 'CONFLICT', 'A second save from the same version conflicts');
select throws_ok($$select public.save_task('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1', 'c2000000-0000-4000-8000-0000000000c3', 'Set up tables', '', 'c2000000-0000-4000-8000-0000000000b5', null, 'todo', 2, null)$$, 'P0001', 'VALIDATION', 'Tasks cannot be assigned to a removed member');

-- Archived events are read-only.
reset role;
update public.events set archived_at = now(), version = version + 1 where id = 'c2000000-0000-4000-8000-0000000000e1';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2000000-0000-4000-8000-000000000004', true);
select throws_ok($$select public.set_task_status('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000c2', 'done', 2)$$, 'P0001', 'FORBIDDEN', 'Member cannot change tasks on an archived event');
select set_config('request.jwt.claim.sub', 'c2000000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.save_task('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000e1', 'c2000000-0000-4000-8000-0000000000c3', 'Late edit', '', null, null, 'todo', 2, null)$$, 'P0001', 'FORBIDDEN', 'Organizer cannot edit tasks on an archived event');
select throws_ok($$select public.remove_task('c2000000-0000-4000-8000-0000000000aa', 'c2000000-0000-4000-8000-0000000000c3', 2)$$, 'P0001', 'FORBIDDEN', 'Tasks on an archived event cannot be removed');

reset role;
select * from finish();
rollback;
