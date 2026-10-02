import type { AttendanceStatus, PreviewGroup, RsvpStatus, StatusMap } from '../lib/mixedAttendance'

export type MemberRole = 'owner' | 'organizer' | 'member'
export type EventStatus = 'draft' | 'planned' | 'completed' | 'canceled'
export type TaskStatus = 'todo' | 'done'
export type ImportBatchStatus = 'active' | 'reverted'

export type Profile = {
  userId: string
  displayName: string
}

export type Workspace = {
  id: string
  name: string
  timezone: string
  version: number
}

export type Membership = {
  id: string
  workspaceId: string
  userId: string
  role: MemberRole
  email: string
  displayName: string
  joinedAt: string
  removedAt: string | null
  former?: boolean
  version: number
}

export type Invitation = {
  id: string
  workspaceId: string
  email: string
  role: Exclude<MemberRole, 'owner'>
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  token?: string
}

export type TeamInvitation = Pick<Invitation, 'id' | 'email' | 'role' | 'expiresAt'> & {
  expired: boolean
}

export type EventRecord = {
  id: string
  workspaceId: string
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  timezone: string
  teamBriefing: string
  leadMembershipId: string | null
  leadName: string | null
  leadFormer: boolean
  status: EventStatus
  archivedAt: string | null
  version: number
  createdBy: string
  taskDone: number
  taskTotal: number
  attendanceCount: number | null
}

export type Venue = {
  id: string
  workspaceId: string
  name: string
  venueType: 'nyu_room' | 'outside'
  capacity: number | null
  address: string
  costNotes: string
  accessibility: string
  equipment: string
  bookingContact: string
  bookingLink: string
  leadTimeDays: number
  restrictions: string
  notes: string
  removedAt: string | null
  version: number
}

export type VenueDetail = Venue & {
  pastEvents: Array<{ id: string; title: string; startsAt: string; timezone: string; location: string }>
}

export type VenueConflict = { id: string; title: string; startsAt: string; endsAt: string; timezone: string }

export type VenueComparison = Venue & {
  usage: { pastEventCount: number; lastUsedOn: string | null; largestAttendance: number | null }
  /** Present only when compared for one event. */
  fit: { requestBy: string; requestByPassed: boolean; linkedToEvent: boolean; conflicts: VenueConflict[] } | null
}

export type AssistantScope = 'read' | 'read_draft'

export type AssistantToken = {
  id: string
  label: string
  scope: AssistantScope
  /** The first characters of the key, to tell keys apart. */
  prefix: string
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  status: 'active' | 'expired' | 'revoked'
  createdBy: string
  createdByName: string
}

export type AssistantAction = {
  id: number
  tool: string
  arguments: Record<string, string | number | boolean>
  outcome: string
  createdAt: string
  tokenId: string
  tokenLabel: string
}

export type PlanDraftTodo = { title: string; notes: string; dueDaysBeforeEvent: number | null }
export type PlanDraftScheduleItem = { title: string; minutesFromStart: number; durationMinutes: number; instructions: string }

export type PlanDraft = {
  id: string
  status: 'pending' | 'accepted' | 'discarded'
  version: number
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  timezone: string
  localDate: string
  venue: { id: string; name: string; capacity: number | null; archived: boolean } | null
  expectedAttendance: number | null
  teamBriefing: string
  todos: PlanDraftTodo[]
  schedule: PlanDraftScheduleItem[]
  assumptions: string[]
  summary: string
  citedEvents: Array<{ id: string; title: string; startsAt: string; timezone: string; archived: boolean }>
  keyLabel: string
  proposedByName: string
  createdAt: string
  decidedAt: string | null
  decidedByName: string | null
  acceptedEventId: string | null
}

export type PlanDraftChanges = {
  title?: string
  startsAt?: string
  endsAt?: string
  timezone?: string
  includeVenue?: boolean
  todoIndexes?: number[]
  scheduleIndexes?: number[]
}

export type VenueBookingStepTemplate = { title: string; offsetDays: number }
export type VenueBookingSteps = { steps: VenueBookingStepTemplate[]; customized: boolean; version: number }
export type EventBookingStep = VenueBookingStepTemplate & {
  id: string
  position: number
  status: 'not_started' | 'in_progress' | 'blocked' | 'complete'
  statusAt: string
  version: number
  deadline: string
}
export type EventBooking = {
  id: string
  eventId: string
  venueId: string
  venueName: string
  venueMismatch: boolean
  leadTimeDays: number
  removedAt: string | null
  version: number
  steps: EventBookingStep[]
  currentStatus: string
  currentStepTitle: string | null
  nextDeadline: string | null
}

export type BookingRequestItemKey =
  | 'event_details' | 'date_time' | 'attendance' | 'accessibility'
  | 'equipment' | 'restrictions' | 'submit_request'
export type BookingRequestCheck = { itemKey: BookingRequestItemKey; checkedAt: string | null; version: number }
export type BookingLogEntry = {
  id: string
  entryType: 'reply' | 'quote' | 'hold' | 'confirmation'
  occurredAt: string
  notes: string
  createdBy: string
  removedAt: string | null
  version: number
}

export type TaskRecord = {
  id: string
  workspaceId: string
  eventId: string
  eventTitle: string
  eventStatus: EventStatus
  eventArchived: boolean
  title: string
  notes: string
  assigneeMembershipId: string | null
  assigneeName: string | null
  assigneeFormer: boolean
  dueDate: string | null
  status: TaskStatus
  removedAt: string | null
  version: number
  overdue: boolean
}

export type SegmentRecord = {
  id: string
  workspaceId: string
  eventId: string
  title: string
  startsAt: string
  endsAt: string
  people: Array<{ id: string; name: string; former: boolean }>
  instructions: string
  removedAt: string | null
  version: number
  overlaps: boolean
  outOfRange: boolean
}

export type HomeScheduleRecord = SegmentRecord & {
  eventTitle: string
  eventStartsAt: string
  eventEndsAt: string
  eventTimezone: string
}

export type AttendancePerson = {
  id: string
  name: string | null
  email: string
  eventsAttended: number
  lastAttended: string | null
  lastEventId: string | null
  lastEventTitle: string | null
  lastEventStatus: EventStatus | null
  recordedIn: string | null
}

export type AttendanceExportRow = {
  name: string | null
  email: string
  sources: Array<{ fileLabel: string; rowNumber: number; recordedAt: string }>
}

export type WorkspaceAttendanceField =
  | 'name' | 'email' | 'eventsAttended' | 'firstAttended' | 'lastAttended' | 'eventTitles' | 'sources'

export type WorkspaceAttendanceRow = {
  name?: string | null
  email?: string
  eventsAttended?: number
  firstAttended?: string | null
  lastAttended?: string | null
  eventTitles?: string[]
  sources?: Array<{ fileLabel: string; rowNumber: number }>
}

export type ImportReceipt = {
  id: string
  eventId: string
  fileLabel: string
  committedAt: string
  importedBy: string
  added: number
  alreadyRecorded: number
  skipped: number
  status: ImportBatchStatus
  revertedAt: string | null
  // Set while the import's original rows are kept (mixed imports, opt-in).
  sourceRowCount?: number | null
  sourceDeleteAfter?: string | null
}

export type PreviewOutcome =
  | 'new'
  | 'already_recorded'
  | 'duplicate'
  | 'invalid'
  | 'blank_ignored'
  | 'not_counted'
  | 'unresolved'

export type ImportPreview = {
  id: string
  eventId: string
  expiresAt: string
  attendanceVersion: number
  fileLabel: string
  fileHash: string
  existingReceiptId: string | null
  // Null for previews made by prepare_attendance_import (every valid row attended).
  statusMap?: StatusMap | null
  keepSource?: boolean
  counts: {
    newAttendance: number
    alreadyRecorded: number
    duplicates: number
    invalid: number
    blank: number
    accepted: number
    notCounted?: number
    unresolved?: number
  }
  rows: Array<{
    rowNumber: number
    name: string
    email: string
    outcome: PreviewOutcome
    reason: string
    // Mixed previews only; legacy rows are grouped by outcome on the client.
    group?: PreviewGroup
    rsvp?: RsvpStatus
    attendance?: AttendanceStatus
    rsvpSource?: string | null
    attendanceSource?: string | null
    timestamp?: string | null
    phone?: string | null
    affiliation?: string | null
    storedName?: string | null
    // Active attendance at this event from an earlier import.
    recordedAttended?: boolean
    // Differences from what is stored. Never applied by the import.
    changes?: Array<{ field: 'name' | 'attendance'; from: string; to: string }>
  }>
}

export type PageResult<T> = {
  rows: T[]
  total: number
  page: number
}

export function canManageEvents(role: MemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'organizer'
}

export function canSeeAttendance(role: MemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'organizer'
}

export function canAdminWorkspace(role: MemberRole | null | undefined): boolean {
  return role === 'owner'
}

export function isEventClosed(event: Pick<EventRecord, 'status' | 'archivedAt'>): boolean {
  return event.archivedAt !== null || event.status === 'completed' || event.status === 'canceled'
}

export function roleLabel(role: MemberRole): string {
  if (role === 'owner') return 'Owner'
  if (role === 'organizer') return 'Organizer'
  return 'Member'
}

export function statusLabel(status: EventStatus): string {
  if (status === 'draft') return 'Draft'
  if (status === 'planned') return 'Planned'
  if (status === 'completed') return 'Completed'
  return 'Canceled'
}

export function taskStatusLabel(status: TaskStatus): string {
  if (status === 'todo') return 'Todo'
  return 'Done'
}

export type EventAttachment = {
  id: string
  eventId: string
  kind: 'file' | 'link'
  title: string
  url: string | null
  storagePath: string | null
  contentType: string
  sizeBytes: number | null
  createdAt: string
  createdByName: string
  removedAt: string | null
  version: number
}
