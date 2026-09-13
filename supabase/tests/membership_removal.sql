-- Team administration: removed members lose access, IDs from other workspaces stay unavailable, and ownership moves safely.
begin;
select plan(21);

insert into auth.users (id, email) values
 ('d3000000-0000-4000-8000-000000000001', 'team-owner@example.test'),
 ('d3000000-0000-4000-8000-000000000002', 'team-organizer@example.test'),
 ('d3000000-0000-4000-8000-000000000003', 'team-member@example.test'),
 ('d3000000-0000-4000-8000-000000000009', 'team-outsider@example.test');
insert into public.workspaces (id, name, timezone) values
 ('d3000000-0000-4000-8000-0000000000aa', 'Team test', 'UTC'),
 ('d3000000-0000-4000-8000-0000000000bb', 'Other workspace', 'UTC');
insert into public.memberships (id, workspace_id, user_id, role, email_normalized) values
 ('d3000000-0000-4000-8000-0000000000b1', 'd3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-000000000001', 'owner', 'team-owner@example.test'),
 ('d3000000-0000-4000-8000-0000000000b2', 'd3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-000000000002', 'organizer', 'team-organizer@example.test'),
 ('d3000000-0000-4000-8000-0000000000b3', 'd3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-000000000003', 'member', 'team-member@example.test'),
 ('d3000000-0000-4000-8000-0000000000b9', 'd3000000-0000-4000-8000-0000000000bb', 'd3000000-0000-4000-8000-000000000009', 'owner', 'team-outsider@example.test');
insert into public.events (id, workspace_id, title, starts_at, ends_at, timezone, created_by) values
 ('d3000000-0000-4000-8000-0000000000e1', 'd3000000-0000-4000-8000-0000000000aa', 'Team event', now() + interval '1 day', now() + interval '1 day 2 hours', 'UTC', 'd3000000-0000-4000-8000-000000000001'),
 ('d3000000-0000-4000-8000-0000000000e2', 'd3000000-0000-4000-8000-0000000000bb', 'Other event', now() + interval '1 day', now() + interval '1 day 2 hours', 'UTC', 'd3000000-0000-4000-8000-000000000009');
insert into public.tasks (id, workspace_id, event_id, title, assignee_membership_id, created_by) values
 ('d3000000-0000-4000-8000-0000000000c1', 'd3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000e1', 'Welcome desk', 'd3000000-0000-4000-8000-0000000000b3', 'd3000000-0000-4000-8000-000000000001'),
 ('d3000000-0000-4000-8000-0000000000c2', 'd3000000-0000-4000-8000-0000000000bb', 'd3000000-0000-4000-8000-0000000000e2', 'Other task', null, 'd3000000-0000-4000-8000-000000000009');

set local role authenticated;

-- Organizer: no team administration, no reach into other workspaces.
select set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000002', true);
select throws_ok($$select public.remove_member('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000b3', 1)$$, 'P0001', 'FORBIDDEN', 'Organizer cannot remove teammates');
select throws_ok($$select public.change_member_role('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000b3', 'organizer', 1)$$, 'P0001', 'FORBIDDEN', 'Organizer cannot change roles');
select throws_ok($$select public.get_event('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000e2')$$, 'P0001', 'UNAVAILABLE', 'An event from another workspace is unavailable, even with its ID');
select throws_ok($$select public.set_task_status('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000c2', 'done', 1)$$, 'P0001', 'UNAVAILABLE', 'A task from another workspace is unavailable');
select throws_ok($$select public.get_event('d3000000-0000-4000-8000-0000000000bb', 'd3000000-0000-4000-8000-0000000000e2')$$, 'P0001', 'UNAVAILABLE', 'Another workspace is unavailable');

-- Member: no settings.
select set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000003', true);
select throws_ok($$select public.save_workspace('d3000000-0000-4000-8000-0000000000aa', 'Renamed', 'UTC', 1)$$, 'P0001', 'FORBIDDEN', 'Member cannot change workspace settings');

-- Owner removes the member.
select set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000001', true);
select throws_ok($$select public.remove_member('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000b1', 1)$$, 'P0001', 'FORBIDDEN', 'Owner cannot remove themselves');
select throws_ok($$select public.change_member_role('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000b3', 'owner', 1)$$, 'P0001', 'FORBIDDEN', 'Ownership only moves through transfer');
select lives_ok($$select public.remove_member('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000b3', 1)$$, 'Owner removes the member');

-- The removed member is locked out on their next request.
select set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000003', true);
select is(jsonb_array_length(public.list_my_workspaces()), 0, 'Removed member no longer lists the workspace');
select throws_ok($$select public.get_workspace('d3000000-0000-4000-8000-0000000000aa')$$, 'P0001', 'UNAVAILABLE', 'Removed member cannot open the workspace');
select throws_ok($$select public.list_events('d3000000-0000-4000-8000-0000000000aa', 'all', '', 1)$$, 'P0001', 'UNAVAILABLE', 'Removed member cannot list events');
select throws_ok($$select public.set_task_status('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000c1', 'done', 1)$$, 'P0001', 'UNAVAILABLE', 'Removed member cannot update their former assignment');

-- Their former assignment is labeled and can be reassigned, but not back to them.
select set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000001', true);
select is(public.list_event_tasks('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000e1', 'all', 'anyone', 1)->'rows'->0->>'assigneeFormer', 'true', 'Former assignment is labeled as a former member');
select is(jsonb_array_length(public.list_event_tasks('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000e1', 'open', 'unassigned', 1)->'rows'), 1, 'Open tasks held by removed members count as unassigned');
select throws_ok($$select public.save_task('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000e1', 'd3000000-0000-4000-8000-0000000000c1', 'Welcome desk', '', 'd3000000-0000-4000-8000-0000000000b3', null, 'todo', 1, null)$$, 'P0001', 'VALIDATION', 'Removed member cannot be assigned again');

-- Ownership transfer leaves exactly one owner.
select lives_ok($$select public.transfer_ownership('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000b2', 1, 1)$$, 'Owner transfers ownership to the organizer');
select throws_ok($$select public.create_invitation('d3000000-0000-4000-8000-0000000000aa', 'next@example.test', 'member')$$, 'P0001', 'FORBIDDEN', 'Previous owner loses owner actions');
select set_config('request.jwt.claim.sub', 'd3000000-0000-4000-8000-000000000002', true);
select is(public.get_workspace('d3000000-0000-4000-8000-0000000000aa')->>'role', 'owner', 'Organizer is now the owner');
select throws_ok($$select public.transfer_ownership('d3000000-0000-4000-8000-0000000000aa', 'd3000000-0000-4000-8000-0000000000b1', 1, 1)$$, 'P0001', 'CONFLICT', 'Transfer with stale versions is rejected');

reset role;
select is((select count(*)::int from public.memberships where workspace_id = 'd3000000-0000-4000-8000-0000000000aa' and role = 'owner' and removed_at is null), 1, 'Exactly one owner remains');

select * from finish();
rollback;
