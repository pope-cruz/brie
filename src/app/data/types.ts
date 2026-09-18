export type MemberRole = 'owner' | 'organizer' | 'member'
export type EventStatus = 'draft' | 'planned' | 'completed' | 'canceled'
export type TaskStatus = 'todo' | 'in_progress' | 'done'
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
  ownerMembershipId: string | null
  ownerName: string | null
  ownerFormer: boolean
  instructions: string
  removedAt: string | null
  version: number
  sortOrder: number
  overlaps: boolean
  outOfRange: boolean
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
}

export type PreviewOutcome =
  | 'new'
  | 'already_recorded'
  | 'duplicate'
  | 'invalid'
  | 'blank_ignored'

export type ImportPreview = {
  id: string
  eventId: string
  expiresAt: string
  attendanceVersion: number
  fileLabel: string
  fileHash: string
  existingReceiptId: string | null
  counts: {
    newAttendance: number
    alreadyRecorded: number
    duplicates: number
    invalid: number
    blank: number
    accepted: number
  }
  rows: Array<{
    rowNumber: number
    name: string
    email: string
    outcome: PreviewOutcome
    reason: string
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
  if (status === 'in_progress') return 'In progress'
  return 'Done'
}
