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
        'accept_invitation', 'archive_booking_log_entry', 'archive_event', 'archive_event_booking', 'archive_venue', 'begin_workspace_attendance_export', 'change_member_role', 'commit_attendance_import', 'compare_venues',
        'create_event', 'create_invitation', 'create_workspace', 'delete_import_source', 'duplicate_event', 'export_event_attendance', 'export_workspace_attendance',
        'get_attendee_detail', 'get_booking_request_checks', 'get_booking_request_draft', 'get_event', 'get_event_attendance_groups', 'get_event_booking', 'get_event_venue', 'get_import_preview', 'get_import_receipt', 'get_import_source', 'get_venue', 'get_venue_booking_steps',
        'get_workspace', 'list_archived_event_bookings', 'list_attendance_groups', 'list_attendance_history', 'list_booking_log_entries', 'list_event_attendance_groups', 'list_event_imports', 'list_event_people',
        'list_event_tasks', 'list_events', 'list_home_schedule', 'list_my_workspaces', 'list_overview_segments',
        'list_overview_tasks', 'list_removed_tasks', 'list_segments', 'list_team',
        'list_venues', 'list_workspace_tasks', 'lookup_import_receipt', 'peek_invitation',
        'paste_schedule', 'prepare_attendance_import', 'prepare_mixed_attendance_import', 'preview_revert_import', 'remove_member', 'remove_segment',
        'remove_task', 'restore_booking_log_entry', 'restore_event', 'restore_event_booking', 'restore_segment', 'restore_task', 'restore_venue',
        'revert_attendance_import', 'revoke_invitation', 'save_segment_and_shift', 'save_segment_people', 'save_task', 'save_team_briefing',
        'save_booking_log_entry', 'save_booking_request_draft', 'save_venue', 'save_workspace', 'set_booking_request_check', 'set_booking_step_status', 'set_event_venue', 'set_task_status', 'set_venue_booking_steps', 'start_event_booking', 'transfer_ownership', 'update_event', 'update_event_and_shift'
      ])
    order by 1
  ),
  '{}'::text[],
  'Signed-in users can call only the app''s RPCs, not internal helpers'
);

select * from finish();
rollback;
