import { rpc } from './client'
import type {
  EventRecord,
  EventStatus,
  HomeScheduleRecord,
  ImportPreview,
  ImportReceipt,
  Invitation,
  MemberRole,
  Membership,
  PageResult,
  SegmentRecord,
  TaskRecord,
  TaskStatus,
  Workspace,
} from './types'

export type WorkspaceSummary = Workspace & {
  role: MemberRole
  membershipId: string
  displayName?: string
  email?: string
}

export async function createWorkspace(input: {
  name: string
  timezone: string
  displayName: string
  requestKey: string
}) {
  return rpc<{ workspace: Workspace; membership: { id: string; role: MemberRole } }>('create_workspace', {
    p_name: input.name,
    p_timezone: input.timezone,
    p_display_name: input.displayName,
    p_request_key: input.requestKey,
  })
}

export async function listMyWorkspaces() {
  return rpc<WorkspaceSummary[]>('list_my_workspaces')
}

export async function getWorkspace(workspaceId: string) {
  return rpc<WorkspaceSummary>('get_workspace', { p_workspace_id: workspaceId })
}

export async function createInvitation(workspaceId: string, email: string, role: Exclude<MemberRole, 'owner'>) {
  return rpc<Invitation>('create_invitation', {
    p_workspace_id: workspaceId,
    p_email: email,
    p_role: role,
  })
}

export async function revokeInvitation(invitationId: string) {
  return rpc('revoke_invitation', { p_invitation_id: invitationId })
}

export async function peekInvitation(token: string) {
  return rpc<{ workspaceName: string; role: MemberRole; emailMasked: string; expiresAt: string }>(
    'peek_invitation',
    { p_token: token },
  )
}

export async function acceptInvitation(token: string) {
  return rpc<{ workspaceId: string; alreadyMember: boolean; role: MemberRole }>('accept_invitation', {
    p_token: token,
  })
}

export async function listTeam(workspaceId: string) {
  return rpc<{ members: Membership[]; invitations: Invitation[] }>('list_team', {
    p_workspace_id: workspaceId,
  })
}

export async function listEvents(workspaceId: string, filter: string, query: string, page: number) {
  return rpc<PageResult<EventRecord>>('list_events', {
    p_workspace_id: workspaceId,
    p_filter: filter,
    p_query: query,
    p_page: page,
  })
}

export async function getEvent(workspaceId: string, eventId: string) {
  return rpc<EventRecord>('get_event', { p_workspace_id: workspaceId, p_event_id: eventId })
}

export async function saveTeamBriefing(
  workspaceId: string,
  eventId: string,
  teamBriefing: string,
  expectedVersion: number,
) {
  return rpc<EventRecord>('save_team_briefing', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
    p_team_briefing: teamBriefing,
    p_expected_version: expectedVersion,
  })
}

export async function createEvent(input: {
  workspaceId: string
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  timezone: string
  leadMembershipId: string | null
  requestKey: string
}) {
  return rpc<EventRecord>('create_event', {
    p_workspace_id: input.workspaceId,
    p_title: input.title,
    p_description: input.description,
    p_location: input.location,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_timezone: input.timezone,
    p_lead_membership_id: input.leadMembershipId,
    p_request_key: input.requestKey,
  })
}

export async function updateEvent(input: {
  workspaceId: string
  eventId: string
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  timezone: string
  leadMembershipId: string | null
  status: EventStatus
  expectedVersion: number
  shiftSchedule?: boolean
}) {
  return rpc<EventRecord>(input.shiftSchedule ? 'update_event_and_shift' : 'update_event', {
    p_workspace_id: input.workspaceId,
    p_event_id: input.eventId,
    p_title: input.title,
    p_description: input.description,
    p_location: input.location,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_timezone: input.timezone,
    p_lead_membership_id: input.leadMembershipId,
    p_status: input.status,
    p_expected_version: input.expectedVersion,
  })
}

export async function archiveEvent(workspaceId: string, eventId: string, version: number) {
  return rpc<EventRecord>('archive_event', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
    p_expected_version: version,
  })
}

export async function restoreEvent(workspaceId: string, eventId: string, version: number) {
  return rpc<EventRecord>('restore_event', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
    p_expected_version: version,
  })
}

export async function duplicateEvent(input: {
  workspaceId: string
  sourceEventId: string
  title: string
  startsAt: string
  endsAt: string
  timezone: string
  requestKey: string
}) {
  return rpc<EventRecord>('duplicate_event', {
    p_workspace_id: input.workspaceId,
    p_source_event_id: input.sourceEventId,
    p_title: input.title,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_timezone: input.timezone,
    p_request_key: input.requestKey,
  })
}

export async function listEventTasks(
  workspaceId: string,
  eventId: string,
  status: string,
  assignee: string,
  page: number,
) {
  return rpc<PageResult<TaskRecord>>('list_event_tasks', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
    p_status: status,
    p_assignee: assignee,
    p_page: page,
  })
}

export async function listWorkspaceTasks(
  workspaceId: string,
  status: string,
  assignee: string,
  includeClosed: boolean,
  page: number,
) {
  return rpc<PageResult<TaskRecord>>('list_workspace_tasks', {
    p_workspace_id: workspaceId,
    p_status: status,
    p_assignee: assignee,
    p_include_closed: includeClosed,
    p_page: page,
  })
}

export async function saveTask(input: {
  workspaceId: string
  eventId: string
  taskId: string | null
  title: string
  notes: string
  assigneeMembershipId: string | null
  dueDate: string | null
  status: TaskStatus
  expectedVersion: number
  requestKey: string
}) {
  return rpc<TaskRecord>('save_task', {
    p_workspace_id: input.workspaceId,
    p_event_id: input.eventId,
    p_task_id: input.taskId,
    p_title: input.title,
    p_notes: input.notes,
    p_assignee_membership_id: input.assigneeMembershipId,
    p_due_date: input.dueDate,
    p_status: input.status,
    p_expected_version: input.expectedVersion,
    p_request_key: input.requestKey,
  })
}

export async function setTaskStatus(
  workspaceId: string,
  taskId: string,
  status: TaskStatus,
  version: number,
) {
  return rpc<TaskRecord>('set_task_status', {
    p_workspace_id: workspaceId,
    p_task_id: taskId,
    p_status: status,
    p_expected_version: version,
  })
}

export async function removeTask(workspaceId: string, taskId: string, version: number) {
  return rpc<TaskRecord>('remove_task', {
    p_workspace_id: workspaceId,
    p_task_id: taskId,
    p_expected_version: version,
  })
}

export async function restoreTask(workspaceId: string, taskId: string, version: number) {
  return rpc<TaskRecord>('restore_task', {
    p_workspace_id: workspaceId,
    p_task_id: taskId,
    p_expected_version: version,
  })
}

export async function listRemovedTasks(workspaceId: string, eventId: string) {
  return rpc<TaskRecord[]>('list_removed_tasks', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
  })
}

export async function saveSegment(input: {
  workspaceId: string
  eventId: string
  segmentId: string | null
  title: string
  startsAt: string
  endsAt: string
  personIds: string[]
  instructions: string
  ackWarnings: boolean
  expectedVersion: number
  requestKey: string
  shiftLater?: boolean
}) {
  return rpc<SegmentRecord>(input.shiftLater ? 'save_segment_and_shift' : 'save_segment_people', {
    p_workspace_id: input.workspaceId,
    p_event_id: input.eventId,
    p_segment_id: input.segmentId,
    p_title: input.title,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_person_ids: input.personIds,
    p_instructions: input.instructions,
    p_ack_warnings: input.ackWarnings,
    p_expected_version: input.expectedVersion,
    p_request_key: input.requestKey,
  })
}

export async function listSegments(workspaceId: string, eventId: string, includeRemoved = false) {
  return rpc<SegmentRecord[]>('list_segments', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
    p_include_removed: includeRemoved,
  })
}

export async function listHomeSchedule(workspaceId: string) {
  return rpc<HomeScheduleRecord[]>('list_home_schedule', { p_workspace_id: workspaceId })
}

export async function pasteSchedule(input: {
  workspaceId: string
  eventId: string
  rows: Array<{ title: string; startsAt: string; endsAt: string; personIds: string[]; instructions: string }>
  ackWarnings: boolean
  requestKey: string
}) {
  return rpc<SegmentRecord[]>('paste_schedule', {
    p_workspace_id: input.workspaceId,
    p_event_id: input.eventId,
    p_rows: input.rows,
    p_ack_warnings: input.ackWarnings,
    p_request_key: input.requestKey,
  })
}

export async function removeSegment(workspaceId: string, segmentId: string, version: number) {
  return rpc<SegmentRecord>('remove_segment', {
    p_workspace_id: workspaceId,
    p_segment_id: segmentId,
    p_expected_version: version,
  })
}

export async function restoreSegment(workspaceId: string, segmentId: string, version: number) {
  return rpc<SegmentRecord>('restore_segment', {
    p_workspace_id: workspaceId,
    p_segment_id: segmentId,
    p_expected_version: version,
  })
}

export async function prepareAttendanceImport(input: {
  workspaceId: string
  eventId: string
  fileLabel: string
  fileHash: string
  mapping: Record<string, unknown>
  rows: Array<{ rowNumber: number; name: string; email: string }>
  blankCount: number
}) {
  return rpc<ImportPreview>('prepare_attendance_import', {
    p_workspace_id: input.workspaceId,
    p_event_id: input.eventId,
    p_file_label: input.fileLabel,
    p_file_hash: input.fileHash,
    p_parser_version: 'brie-csv-1',
    p_mapping: input.mapping,
    p_rows: input.rows,
    p_blank_count: input.blankCount,
  })
}

export async function getImportPreview(previewId: string) {
  return rpc<ImportPreview>('get_import_preview', { p_preview_id: previewId })
}

export async function commitAttendanceImport(
  previewId: string,
  skipInvalidAck: boolean,
  idempotencyKey: string,
) {
  return rpc<ImportReceipt>('commit_attendance_import', {
    p_preview_id: previewId,
    p_skip_invalid_ack: skipInvalidAck,
    p_idempotency_key: idempotencyKey,
  })
}

export async function lookupImportReceipt(
  workspaceId: string,
  eventId: string,
  previewId: string,
  idempotencyKey: string,
) {
  return rpc<ImportReceipt | null>('lookup_import_receipt', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
    p_preview_id: previewId,
    p_idempotency_key: idempotencyKey,
  })
}

export async function listEventPeople(workspaceId: string, eventId: string, query: string, page: number) {
  return rpc<PageResult<import('./types').AttendancePerson>>('list_event_people', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
    p_query: query,
    p_page: page,
  })
}

export async function listEventImports(workspaceId: string, eventId: string) {
  return rpc<ImportReceipt[]>('list_event_imports', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
  })
}

export async function getImportReceipt(workspaceId: string, batchId: string) {
  return rpc<ImportReceipt>('get_import_receipt', {
    p_workspace_id: workspaceId,
    p_batch_id: batchId,
  })
}

export async function previewRevertImport(workspaceId: string, batchId: string) {
  return rpc<{
    batchId: string
    alreadyReverted: boolean
    disappear: number
    retained: number
    attendanceVersion: number
    batchVersion: number
  }>('preview_revert_import', {
    p_workspace_id: workspaceId,
    p_batch_id: batchId,
  })
}

export async function revertAttendanceImport(
  workspaceId: string,
  batchId: string,
  batchVersion: number,
  attendanceVersion: number,
) {
  return rpc<ImportReceipt>('revert_attendance_import', {
    p_workspace_id: workspaceId,
    p_batch_id: batchId,
    p_expected_batch_version: batchVersion,
    p_expected_attendance_version: attendanceVersion,
  })
}

export async function listAttendanceHistory(
  workspaceId: string,
  query: string,
  from: string | null,
  to: string | null,
  page: number,
) {
  return rpc<PageResult<import('./types').AttendancePerson> & { peopleCount: number; eventCount: number }>(
    'list_attendance_history',
    {
      p_workspace_id: workspaceId,
      p_query: query,
      p_from: from,
      p_to: to,
      p_page: page,
    },
  )
}

export async function getAttendeeDetail(workspaceId: string, attendeeId: string) {
  return rpc<{
    id: string
    name: string | null
    email: string
    eventsAttended: number
    firstAttended: string | null
    lastAttended: string | null
    events: Array<{
      eventId: string
      title: string
      startsAt: string
      timezone: string
      status: EventStatus
      archivedAt: string | null
      batches: Array<{ id: string; fileLabel: string; committedAt: string }>
    }>
  }>('get_attendee_detail', {
    p_workspace_id: workspaceId,
    p_attendee_id: attendeeId,
  })
}

export async function saveWorkspace(workspaceId: string, name: string, timezone: string, version: number) {
  return rpc<Workspace>('save_workspace', {
    p_workspace_id: workspaceId,
    p_name: name,
    p_timezone: timezone,
    p_expected_version: version,
  })
}

export async function changeMemberRole(
  workspaceId: string,
  membershipId: string,
  role: MemberRole,
  version: number,
) {
  return rpc('change_member_role', {
    p_workspace_id: workspaceId,
    p_membership_id: membershipId,
    p_role: role,
    p_expected_version: version,
  })
}

export async function removeMember(workspaceId: string, membershipId: string, version: number) {
  return rpc('remove_member', {
    p_workspace_id: workspaceId,
    p_membership_id: membershipId,
    p_expected_version: version,
  })
}

export async function transferOwnership(
  workspaceId: string,
  membershipId: string,
  ownerVersion: number,
  targetVersion: number,
) {
  return rpc('transfer_ownership', {
    p_workspace_id: workspaceId,
    p_membership_id: membershipId,
    p_expected_owner_version: ownerVersion,
    p_expected_target_version: targetVersion,
  })
}
