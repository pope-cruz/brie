-- Privileged (security definer) functions bypass table permissions, so only the
-- intended RPCs may be callable. A new RPC must be added to the list below on purpose.
begin;
select plan(2);

select is(
  array(
    select p.proname::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
    order by 1
  ),
  array['peek_invitation'],
  'Signed-out visitors can call only peek_invitation'
);

select is(
  array(
    select p.proname::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname <> all (array[
        'accept_invitation', 'archive_event', 'change_member_role', 'commit_attendance_import',
        'create_event', 'create_invitation', 'create_workspace', 'duplicate_event',
        'get_attendee_detail', 'get_event', 'get_import_preview', 'get_import_receipt',
        'get_workspace', 'list_attendance_history', 'list_event_imports', 'list_event_people',
        'list_event_tasks', 'list_events', 'list_my_workspaces', 'list_overview_segments',
        'list_overview_tasks', 'list_removed_tasks', 'list_segments', 'list_team',
        'list_workspace_tasks', 'lookup_import_receipt', 'peek_invitation',
        'prepare_attendance_import', 'preview_revert_import', 'remove_member', 'remove_segment',
        'remove_task', 'restore_event', 'restore_segment', 'restore_task',
        'revert_attendance_import', 'revoke_invitation', 'save_segment', 'save_task',
        'save_workspace', 'set_task_status', 'transfer_ownership', 'update_event'
      ])
    order by 1
  ),
  '{}'::text[],
  'Signed-in users can call only the app''s RPCs, not internal helpers'
);

select * from finish();
rollback;
