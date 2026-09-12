begin;
select plan(8);

select has_table('public', 'workspaces', 'workspaces exist');
select has_table('public', 'memberships', 'memberships exist');
select has_table('public', 'events', 'events exist');
select has_table('public', 'tasks', 'tasks exist');
select has_table('public', 'attendance_batches', 'attendance batches exist');
select has_function('public', 'create_workspace', 'create_workspace exists');
select has_function('public', 'commit_attendance_import', 'commit_attendance_import exists');
select has_function('public', 'transfer_ownership', 'transfer_ownership exists');

select * from finish();
rollback;
