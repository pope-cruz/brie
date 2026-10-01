// The planning read contract (migration 0061). It has no imports so the
// assistant server can share it. A breaking change to either shape needs a new
// contract version, not an edit: readers outside the app depend on it.

export const EVENT_PLAN_CONTRACT = 'brie.event-plan/1'
export const EVENT_SEARCH_CONTRACT = 'brie.event-search/1'

export type PlanEventStatus = 'draft' | 'planned' | 'completed' | 'canceled'

export type EventPlan = {
  contract: typeof EVENT_PLAN_CONTRACT
  event: {
    id: string
    title: string
    description: string
    location: string
    status: PlanEventStatus
    startsAt: string
    endsAt: string
    timezone: string
    /** The event's start date in its own time zone (YYYY-MM-DD). */
    localDate: string
    archived: boolean
    teamBriefing: string
  }
  venue: {
    id: string
    name: string
    venueType: 'nyu_room' | 'outside'
    capacity: number | null
    address: string
    leadTimeDays: number
    costNotes: string
    accessibility: string
    equipment: string
    restrictions: string
    notes: string
    archived: boolean
  } | null
  booking: {
    venueName: string
    currentStatus: 'Not started' | 'In progress' | 'Blocked' | 'Complete'
    currentStepTitle: string | null
    nextDeadline: string | null
    steps: Array<{ title: string; status: 'not_started' | 'in_progress' | 'blocked' | 'complete'; deadline: string }>
  } | null
  todos: Array<{
    title: string
    notes: string
    status: 'todo' | 'in_progress' | 'done'
    dueDate: string | null
    /** Days between the due date and the event day; negative when due after it. */
    dueDaysBeforeEvent: number | null
    /** Whether someone is assigned. Who is assigned is not part of the contract. */
    assigned: boolean
  }>
  schedule: Array<{
    title: string
    startsAt: string
    endsAt: string
    minutesFromStart: number
    durationMinutes: number
    instructions: string
    peopleCount: number
  }>
  attendance: {
    confirmed: number
    /** Owners and organizers only; null for members. */
    firstTime: number | null
    repeat: number | null
  }
}

export type EventSearchWindow = 'past' | 'upcoming' | 'any'

export type EventSearchResult = {
  contract: typeof EVENT_SEARCH_CONTRACT
  query: string
  when: EventSearchWindow
  events: Array<{
    id: string
    title: string
    status: PlanEventStatus
    startsAt: string
    endsAt: string
    timezone: string
    localDate: string
    archived: boolean
    location: string
    venue: { id: string; name: string } | null
    descriptionExcerpt: string
    confirmedAttendance: number
    todoCount: number
    scheduleCount: number
  }>
}
