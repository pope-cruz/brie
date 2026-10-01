import { FunctionsHttpError } from '@supabase/supabase-js'
import { getSupabase, rpc } from './client'
import { toAppError } from './errors'
import type { StatusMap } from '../lib/mixedAttendance'
import type { EventPlan, EventSearchResult, EventSearchWindow } from './planningContract'
import type {
  AttendanceExportRow,
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
  TeamInvitation,
  Workspace,
  Venue,
  VenueComparison,
  VenueDetail,
  VenueBookingStepTemplate,
  VenueBookingSteps,
  EventBooking,
  BookingRequestItemKey,
  BookingRequestCheck,
  BookingLogEntry,
  WorkspaceAttendanceField,
  WorkspaceAttendanceRow,
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

export type InvitationDelivery = 'sent' | 'not_configured' | 'rate_limited' | 'failed' | 'unavailable'

/**
 * Creates the invitation through the `send-invitation` function, which also emails the link.
 * When the function can't be reached (not deployed, network), the invitation is created
 * directly so the owner can still copy the link. Errors the command itself raises are
 * passed through unchanged.
 */
export async function sendInvitation(workspaceId: string, email: string, role: Exclude<MemberRole, 'owner'>) {
  const { data, error } = await getSupabase().functions.invoke<Invitation & { delivery: InvitationDelivery }>(
    'send-invitation',
    { body: { workspaceId, email, role } },
  )
  if (!error && data) return data
  if (error instanceof FunctionsHttpError) {
    const body = await (error.context as Response).json().catch(() => null) as { error?: unknown } | null
    if (body?.error && typeof body.error === 'object') throw toAppError(body.error)
  }
  const invite = await createInvitation(workspaceId, email, role)
  return { ...invite, delivery: 'unavailable' as const }
}

export async function revokeInvitation(invitationId: string) {
  return rpc('revoke_invitation', { p_invitation_id: invitationId })
}

export async function peekInvitation(token: string) {
  return rpc<{ workspaceName: string; role: MemberRole; emailMasked: string; expiresAt: string; alreadyMember: boolean; workspaceId: string | null }>(
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
  return rpc<{ members: Membership[]; invitations: TeamInvitation[] }>('list_team', {
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

export async function listVenues(workspaceId: string, includeArchived = false) {
  return rpc<Venue[]>('list_venues', { p_workspace_id: workspaceId, p_include_archived: includeArchived })
}

export async function compareVenues(workspaceId: string, includeArchived: boolean, eventId: string | null) {
  return rpc<VenueComparison[]>('compare_venues', {
    p_workspace_id: workspaceId, p_include_archived: includeArchived, p_event_id: eventId,
  })
}

export async function getEventPlan(workspaceId: string, eventId: string) {
  return rpc<EventPlan>('get_event_plan', { p_workspace_id: workspaceId, p_event_id: eventId })
}

export async function searchEvents(workspaceId: string, query: string, when: EventSearchWindow, venueId: string | null = null, limit = 10) {
  return rpc<EventSearchResult>('search_events', {
    p_workspace_id: workspaceId, p_query: query, p_when: when, p_venue_id: venueId, p_limit: limit,
  })
}

export async function getVenue(workspaceId: string, venueId: string) {
  return rpc<VenueDetail>('get_venue', { p_workspace_id: workspaceId, p_venue_id: venueId })
}

export async function saveVenue(workspaceId: string, venueId: string | null, venue: Omit<Venue, 'id' | 'workspaceId' | 'removedAt' | 'version'>, expectedVersion: number | null) {
  return rpc<Venue>('save_venue', {
    p_workspace_id: workspaceId, p_venue_id: venueId, p_name: venue.name,
    p_venue_type: venue.venueType, p_capacity: venue.capacity, p_address: venue.address,
    p_cost_notes: venue.costNotes, p_accessibility: venue.accessibility,
    p_equipment: venue.equipment, p_booking_contact: venue.bookingContact,
    p_booking_link: venue.bookingLink, p_lead_time_days: venue.leadTimeDays,
    p_restrictions: venue.restrictions, p_notes: venue.notes,
    p_expected_version: expectedVersion,
  })
}

export async function archiveVenue(workspaceId: string, venueId: string, expectedVersion: number) {
  return rpc<Venue>('archive_venue', { p_workspace_id: workspaceId, p_venue_id: venueId, p_expected_version: expectedVersion })
}

export async function restoreVenue(workspaceId: string, venueId: string, expectedVersion: number) {
  return rpc<Venue>('restore_venue', { p_workspace_id: workspaceId, p_venue_id: venueId, p_expected_version: expectedVersion })
}

export async function getEventVenue(workspaceId: string, eventId: string) {
  return rpc<{ venueId: string | null; venueName: string | null; version: number }>('get_event_venue', {
    p_workspace_id: workspaceId, p_event_id: eventId,
  })
}

export async function setEventVenue(workspaceId: string, eventId: string, venueId: string | null, expectedVersion: number) {
  return rpc<{ venueId: string | null; version: number }>('set_event_venue', {
    p_workspace_id: workspaceId, p_event_id: eventId, p_venue_id: venueId,
    p_expected_version: expectedVersion,
  })
}

export async function getVenueBookingSteps(workspaceId: string, venueId: string) {
  return rpc<VenueBookingSteps>('get_venue_booking_steps', { p_workspace_id: workspaceId, p_venue_id: venueId })
}

export async function setVenueBookingSteps(workspaceId: string, venueId: string, steps: VenueBookingStepTemplate[], version: number) {
  return rpc<VenueBookingSteps>('set_venue_booking_steps', {
    p_workspace_id: workspaceId, p_venue_id: venueId, p_steps: steps, p_expected_version: version,
  })
}

export async function getEventBooking(workspaceId: string, eventId: string) {
  return rpc<EventBooking | null>('get_event_booking', { p_workspace_id: workspaceId, p_event_id: eventId })
}

export async function listArchivedEventBookings(workspaceId: string, eventId: string) {
  return rpc<EventBooking[]>('list_archived_event_bookings', { p_workspace_id: workspaceId, p_event_id: eventId })
}

export async function startEventBooking(workspaceId: string, eventId: string) {
  return rpc<EventBooking>('start_event_booking', { p_workspace_id: workspaceId, p_event_id: eventId })
}

export async function setBookingStepStatus(workspaceId: string, stepId: string, status: EventBooking['steps'][number]['status'], version: number) {
  return rpc<EventBooking>('set_booking_step_status', {
    p_workspace_id: workspaceId, p_step_id: stepId, p_status: status, p_expected_version: version,
  })
}

export async function archiveEventBooking(workspaceId: string, bookingId: string, version: number) {
  return rpc<EventBooking>('archive_event_booking', { p_workspace_id: workspaceId, p_booking_id: bookingId, p_expected_version: version })
}

export async function restoreEventBooking(workspaceId: string, bookingId: string, version: number) {
  return rpc<EventBooking>('restore_event_booking', { p_workspace_id: workspaceId, p_booking_id: bookingId, p_expected_version: version })
}

export async function getBookingRequestChecks(workspaceId: string, bookingId: string) {
  return rpc<BookingRequestCheck[]>('get_booking_request_checks', { p_workspace_id: workspaceId, p_booking_id: bookingId })
}

export async function setBookingRequestCheck(
  workspaceId: string, bookingId: string, itemKey: BookingRequestItemKey,
  checked: boolean, version: number | null,
) {
  return rpc<BookingRequestCheck>('set_booking_request_check', {
    p_workspace_id: workspaceId, p_booking_id: bookingId, p_item_key: itemKey,
    p_checked: checked, p_expected_version: version,
  })
}

export async function getBookingRequestDraft(workspaceId: string, bookingId: string) {
  return rpc<{ draft: string; updatedAt: string | null; version: number }>('get_booking_request_draft', {
    p_workspace_id: workspaceId, p_booking_id: bookingId,
  })
}

export async function saveBookingRequestDraft(workspaceId: string, bookingId: string, draft: string, version: number) {
  return rpc<{ draft: string; updatedAt: string; version: number }>('save_booking_request_draft', {
    p_workspace_id: workspaceId, p_booking_id: bookingId,
    p_draft: draft, p_expected_version: version,
  })
}

export async function listBookingLogEntries(workspaceId: string, bookingId: string, includeArchived = false) {
  return rpc<BookingLogEntry[]>('list_booking_log_entries', {
    p_workspace_id: workspaceId, p_booking_id: bookingId, p_include_archived: includeArchived,
  })
}

export async function saveBookingLogEntry(
  workspaceId: string, bookingId: string, entryId: string | null,
  entryType: BookingLogEntry['entryType'], occurredAt: string, notes: string,
  version: number | null,
) {
  return rpc<BookingLogEntry>('save_booking_log_entry', {
    p_workspace_id: workspaceId, p_booking_id: bookingId, p_entry_id: entryId,
    p_entry_type: entryType, p_occurred_at: occurredAt, p_notes: notes,
    p_expected_version: version,
  })
}

export async function archiveBookingLogEntry(workspaceId: string, entryId: string, version: number) {
  return rpc<Pick<BookingLogEntry, 'id' | 'removedAt' | 'version'>>('archive_booking_log_entry', {
    p_workspace_id: workspaceId, p_entry_id: entryId, p_expected_version: version,
  })
}

export async function restoreBookingLogEntry(workspaceId: string, entryId: string, version: number) {
  return rpc<Pick<BookingLogEntry, 'id' | 'removedAt' | 'version'>>('restore_booking_log_entry', {
    p_workspace_id: workspaceId, p_entry_id: entryId, p_expected_version: version,
  })
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

export async function prepareMixedAttendanceImport(input: {
  workspaceId: string
  eventId: string
  fileLabel: string
  fileHash: string
  mapping: Record<string, unknown>
  statusMap: StatusMap
  rows: Array<Record<string, string | number | string[]>>
  blankCount: number
}) {
  return rpc<ImportPreview>('prepare_mixed_attendance_import', {
    p_workspace_id: input.workspaceId,
    p_event_id: input.eventId,
    p_file_label: input.fileLabel,
    p_file_hash: input.fileHash,
    p_parser_version: 'brie-csv-1',
    p_mapping: input.mapping,
    p_status_map: input.statusMap,
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

export async function exportEventAttendance(workspaceId: string, eventId: string) {
  return rpc<AttendanceExportRow[]>('export_event_attendance', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
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

export async function getImportSource(workspaceId: string, batchId: string) {
  return rpc<{ headers: string[]; rows: string[][]; deleteAfter: string }>('get_import_source', {
    p_workspace_id: workspaceId,
    p_batch_id: batchId,
  })
}

export async function deleteImportSource(workspaceId: string, batchId: string) {
  return rpc<ImportReceipt>('delete_import_source', {
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

export type AttendanceGroupFilters = {
  attendedEventId?: string
  anyEventIds?: string[]
  firstEventId?: string
  minEvents?: number
  notSeenSince?: string
  from?: string
  to?: string
}

export async function listAttendanceGroups(workspaceId: string, query: string, filters: AttendanceGroupFilters, page: number) {
  return rpc<PageResult<import('./types').AttendancePerson> & { peopleCount: number; eventCount: number }>(
    'list_attendance_groups',
    { p_workspace_id: workspaceId, p_query: query, p_filters: filters, p_page: page },
  )
}

export type EventAttendanceGroup = {
  eventId: string
  title: string
  startsAt: string
  firstTime: number
  repeat: number
}

export async function listEventAttendanceGroups(workspaceId: string) {
  return rpc<EventAttendanceGroup[]>('list_event_attendance_groups', { p_workspace_id: workspaceId })
}

export async function getEventAttendanceGroups(workspaceId: string, eventId: string) {
  return rpc<{ firstTime: number; repeat: number }>('get_event_attendance_groups', {
    p_workspace_id: workspaceId, p_event_id: eventId,
  })
}

export async function beginWorkspaceAttendanceExport(
  workspaceId: string, fields: WorkspaceAttendanceField[], filters: AttendanceGroupFilters,
) {
  return rpc<{ id: string }>('begin_workspace_attendance_export', {
    p_workspace_id: workspaceId, p_fields: fields, p_filters: filters,
  })
}

export async function exportWorkspaceAttendancePage(
  workspaceId: string, exportId: string, afterAttendeeId: string | null,
) {
  return rpc<{ rows: WorkspaceAttendanceRow[]; nextAfter: string | null; count: number }>(
    'export_workspace_attendance', {
      p_workspace_id: workspaceId, p_export_id: exportId,
      p_after_attendee_id: afterAttendeeId, p_limit: 1000,
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
      active: boolean
      batches: Array<{
        id: string
        fileLabel: string
        rowNumber: number
        committedAt: string
        importedBy: string
        status: 'active' | 'reverted'
        revertedAt: string | null
      }>
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
