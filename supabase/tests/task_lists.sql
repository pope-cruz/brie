begin;
select plan(4);
insert into auth.users(id,email) values ('33333333-3333-4333-8333-333333333333','task-list-test@example.test');
insert into public.workspaces(id,name,timezone) values ('33333333-3333-4333-8333-333333333334','Task list test','UTC');
insert into public.memberships(workspace_id,user_id,role,email_normalized) values ('33333333-3333-4333-8333-333333333334','33333333-3333-4333-8333-333333333333','owner','task-list-test@example.test');
insert into public.events(id,workspace_id,title,starts_at,ends_at,timezone,created_by) values
 ('33333333-3333-4333-8333-333333333335','33333333-3333-4333-8333-333333333334','Test event',now(),now()+interval '1 hour','UTC','33333333-3333-4333-8333-333333333333');
insert into public.tasks(workspace_id,event_id,title,created_by) values
 ('33333333-3333-4333-8333-333333333334','33333333-3333-4333-8333-333333333335','Welcome desk','33333333-3333-4333-8333-333333333333');
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select is(public.list_event_tasks('33333333-3333-4333-8333-333333333334','33333333-3333-4333-8333-333333333335','all','anyone',1)->'rows'->0->>'title','Welcome desk','Event task list serializes a populated task');
select is(public.list_overview_tasks('33333333-3333-4333-8333-333333333334','33333333-3333-4333-8333-333333333335')->0->>'title','Welcome desk','Overview serializes a populated task');
select is(public.list_workspace_tasks('33333333-3333-4333-8333-333333333334','all','anyone',false,1)->'rows'->0->>'title','Welcome desk','Workspace task list serializes a populated task');
select is(jsonb_array_length(public.list_event_tasks('33333333-3333-4333-8333-333333333334','33333333-3333-4333-8333-333333333335','done','anyone',1)->'rows'),0,'Status filtering still excludes open tasks');
reset role;
select * from finish();
rollback;
