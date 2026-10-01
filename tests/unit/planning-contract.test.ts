import { describe, expect, it } from 'vitest'
import plan from '../fixtures/event-plan-v1.json'
import search from '../fixtures/event-search-v1.json'
import { EVENT_PLAN_CONTRACT, EVENT_SEARCH_CONTRACT } from '../../src/app/data/planningContract'

// Both fixtures were captured from the real RPCs (supabase/tests/planning_contract.sql
// data, read as an owner, with a booking started). The key and type checks
// fail if the database gains, loses, or retypes a field without a new version,
// or if src/app/data/planningContract.ts should change to match. Regenerate the
// fixtures only together with a contract version bump.

const keys = (value: object) => Object.keys(value).sort()

type Kind = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
const kind = (value: unknown): Kind => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value as Kind
const kinds = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).map(([key, field]) => [key, kind(field)]))

describe('planning contract v1', () => {
  it('names its version', () => {
    expect(plan.contract).toBe(EVENT_PLAN_CONTRACT)
    expect(search.contract).toBe(EVENT_SEARCH_CONTRACT)
  })

  it('keeps the event plan shape', () => {
    expect(keys(plan)).toEqual(['attendance', 'booking', 'contract', 'event', 'schedule', 'todos', 'venue'])
    expect(keys(plan.event)).toEqual(['archived', 'description', 'endsAt', 'id', 'localDate', 'location', 'startsAt', 'status', 'teamBriefing', 'timezone', 'title'])
    expect(keys(plan.venue)).toEqual(['accessibility', 'address', 'archived', 'capacity', 'costNotes', 'equipment', 'id', 'leadTimeDays', 'name', 'notes', 'restrictions', 'venueType'])
    expect(keys(plan.booking)).toEqual(['currentStatus', 'currentStepTitle', 'nextDeadline', 'steps', 'venueName'])
    expect(keys(plan.booking.steps[0])).toEqual(['deadline', 'status', 'title'])
    expect(keys(plan.todos[0])).toEqual(['assigned', 'dueDate', 'dueDaysBeforeEvent', 'notes', 'status', 'title'])
    expect(keys(plan.schedule[0])).toEqual(['durationMinutes', 'endsAt', 'instructions', 'minutesFromStart', 'peopleCount', 'startsAt', 'title'])
    expect(keys(plan.attendance)).toEqual(['confirmed', 'firstTime', 'repeat'])
  })

  it('keeps each field\'s type', () => {
    expect(kinds(plan.event)).toEqual({
      id: 'string', title: 'string', description: 'string', location: 'string', status: 'string',
      startsAt: 'string', endsAt: 'string', timezone: 'string', localDate: 'string', archived: 'boolean', teamBriefing: 'string',
    })
    expect(kinds(plan.venue)).toEqual({
      id: 'string', name: 'string', venueType: 'string', capacity: 'number', address: 'string', leadTimeDays: 'number',
      costNotes: 'string', accessibility: 'string', equipment: 'string', restrictions: 'string', notes: 'string', archived: 'boolean',
    })
    expect(kinds(plan.booking)).toEqual({ venueName: 'string', currentStatus: 'string', currentStepTitle: 'string', nextDeadline: 'string', steps: 'array' })
    expect(kinds(plan.todos[0])).toEqual({ title: 'string', notes: 'string', status: 'string', dueDate: 'string', dueDaysBeforeEvent: 'number', assigned: 'boolean' })
    expect(kinds(plan.schedule[0])).toEqual({
      title: 'string', startsAt: 'string', endsAt: 'string', minutesFromStart: 'number', durationMinutes: 'number', instructions: 'string', peopleCount: 'number',
    })
    expect(kinds(plan.attendance)).toEqual({ confirmed: 'number', firstTime: 'number', repeat: 'number' })
    expect(kinds(search.events[0])).toEqual({
      id: 'string', title: 'string', status: 'string', startsAt: 'string', endsAt: 'string', timezone: 'string', localDate: 'string',
      archived: 'boolean', location: 'string', venue: 'object', descriptionExcerpt: 'string', confirmedAttendance: 'number', todoCount: 'number', scheduleCount: 'number',
    })
  })

  it('keeps the search shape', () => {
    expect(keys(search)).toEqual(['contract', 'events', 'query', 'when'])
    expect(keys(search.events[0])).toEqual([
      'archived', 'confirmedAttendance', 'descriptionExcerpt', 'endsAt', 'id', 'localDate', 'location',
      'scheduleCount', 'startsAt', 'status', 'timezone', 'title', 'todoCount', 'venue',
    ])
  })

  it('carries no contact details', () => {
    const text = JSON.stringify([plan, search])
    expect(text).not.toMatch(/@/)
    expect(text).not.toMatch(/email|phone|membership|assignee/i)
  })
})
