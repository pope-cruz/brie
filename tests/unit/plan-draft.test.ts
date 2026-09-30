// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDraft } from '../../src/app/data/types'
import { DraftReviewPage } from '../../src/app/features/drafts/DraftReviewPage'
import { DraftListPage } from '../../src/app/features/drafts/DraftListPage'
import { acceptChanges, addDays, dueLabel, initialEdits, previewDraft } from '../../src/app/lib/planDraft'

const api = vi.hoisted(() => ({
  getPlanDraft: vi.fn(),
  listPlanDrafts: vi.fn(),
  acceptPlanDraft: vi.fn(),
  discardPlanDraft: vi.fn(),
}))
vi.mock('../../src/app/data/api', () => api)

const draft: PlanDraft = {
  id: 'draft-1', status: 'pending', version: 1,
  title: 'Fall founder dinner', description: 'Seated dinner.', location: '',
  startsAt: '2026-11-13T00:00:00.000Z', endsAt: '2026-11-13T03:00:00.000Z', timezone: 'America/New_York', localDate: '2026-11-12',
  venue: { id: 'loft', name: 'Loft', capacity: 60, archived: false },
  expectedAttendance: 40, teamBriefing: 'Greet at the door.',
  todos: [
    { title: 'Book caterer', notes: 'Vegetarian options', dueDaysBeforeEvent: 21 },
    { title: 'Print name cards', notes: '', dueDaysBeforeEvent: 2 },
    { title: 'Send thank-you notes', notes: '', dueDaysBeforeEvent: -2 },
  ],
  schedule: [
    { title: 'Setup', minutesFromStart: -60, durationMinutes: 60, instructions: '' },
    { title: 'Dinner', minutesFromStart: 30, durationMinutes: 90, instructions: 'Serve at 7:30' },
  ],
  assumptions: ['40 people, like last spring', 'Same caterer lead time'],
  summary: 'Based on the spring dinner.',
  citedEvents: [{ id: 'spring', title: 'Spring founder dinner', startsAt: '2026-04-10T23:00:00Z', timezone: 'America/New_York', archived: false }],
  keyLabel: 'Drafting', proposedByName: 'Orin Organizer', createdAt: '2026-09-30T12:00:00Z',
  decidedAt: null, decidedByName: null, acceptedEventId: null,
}

describe('draft helpers', () => {
  it('adds calendar days across months', () => {
    expect(addDays('2026-11-12', -21)).toBe('2026-10-22')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('previews due dates from the event day and schedule times from the start', () => {
    const preview = previewDraft(draft, draft.startsAt, draft.endsAt, draft.timezone)
    expect(preview.todos.map((todo) => todo.dueDate)).toEqual(['2026-10-22', '2026-11-10', '2026-11-14'])
    expect(preview.schedule[0]).toEqual({ startsAt: '2026-11-12T23:00:00.000Z', endsAt: '2026-11-13T00:00:00.000Z', outsideEvent: true })
    expect(preview.schedule[1].outsideEvent).toBe(false)
  })

  it('moves everything with a new start', () => {
    const preview = previewDraft(draft, '2026-11-20T00:00:00.000Z', '2026-11-20T03:00:00.000Z', draft.timezone)
    expect(preview.todos[0].dueDate).toBe('2026-10-29')
    expect(preview.schedule[1].startsAt).toBe('2026-11-20T00:30:00.000Z')
  })

  it('sends only what the organizer changed', () => {
    expect(acceptChanges(draft, initialEdits(draft))).toEqual({})
    const edits = initialEdits(draft)
    edits.title = '  Founder dinner (fall) '
    edits.keptTodos.delete(1)
    edits.includeVenue = false
    edits.startsAt = '2026-11-13T00:00:00Z'
    expect(acceptChanges(draft, edits)).toEqual({ title: 'Founder dinner (fall)', includeVenue: false, todoIndexes: [0, 2] })
  })

  it('labels due dates in plain language', () => {
    expect(dueLabel(null)).toBe('No due date')
    expect(dueLabel(0)).toBe('Due on the event day')
    expect(dueLabel(1)).toBe('Due 1 day before')
    expect(dueLabel(-2)).toBe('Due 2 days after')
  })
})

let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

async function mount(path: string, role = 'organizer') {
  router = createMemoryRouter(
    [{
      path: '/app/w/workspace',
      element: createElement(Outlet, { context: { id: 'workspace', role, timezone: 'America/New_York' } }),
      children: [
        { path: 'drafts', element: createElement(DraftListPage) },
        { path: 'drafts/:draftId', element: createElement(DraftReviewPage) },
        { path: 'events/:eventId', element: createElement('p', null, 'event page') },
      ],
    }],
    { initialEntries: [path] },
  )
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}

const button = (text: string) => [...document.querySelectorAll('button')].find((el) => el.textContent === text)

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.values(api).forEach((fn) => fn.mockReset())
  api.getPlanDraft.mockResolvedValue(draft)
  api.listPlanDrafts.mockResolvedValue([draft])
  api.acceptPlanDraft.mockResolvedValue({ eventId: 'new-event', todos: 2, scheduleItems: 2 })
  api.discardPlanDraft.mockResolvedValue({ ...draft, status: 'discarded' })
  sessionStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div')
  host.className = 'brie-app'
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  router?.dispose()
  host.remove()
})

describe('draft pages', () => {
  it('are unavailable to members', async () => {
    await mount('/app/w/workspace/drafts/draft-1', 'member')
    expect(host.querySelector('h1')?.textContent).toBe('This page isn’t available')
    expect(api.getPlanDraft).not.toHaveBeenCalled()
  })

  it('lists pending drafts with what needs checking', async () => {
    await mount('/app/w/workspace/drafts')
    expect(api.listPlanDrafts).toHaveBeenCalledWith('workspace', false)
    expect(host.textContent).toContain('Fall founder dinner')
    expect(host.textContent).toContain('3 to-dos · 2 schedule items · 2 assumptions to check · based on 1 past event')
  })

  it('shows assumptions, cited events, and where each item lands', async () => {
    await mount('/app/w/workspace/drafts/draft-1')
    expect(host.querySelector('.app-draft-callout')?.textContent).toContain('40 people, like last spring')
    expect(host.textContent).toContain('Planned for 40 people.')
    expect([...host.querySelectorAll('a')].some((link) => link.textContent === 'Spring founder dinner' && link.getAttribute('href') === '/app/w/workspace/events/spring')).toBe(true)
    expect(host.textContent).toContain('Due 21 days before (Oct 22, 2026) · Unassigned')
    expect(host.textContent).toContain('6:00 PM–7:00 PM Setup · outside event hours')
    expect(host.textContent).toContain('no booking is made')
  })

  it('accepts with the organizer’s changes and opens the new event', async () => {
    await mount('/app/w/workspace/drafts/draft-1')
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Keep to-do: Print name cards"]')!.click())
    expect(host.textContent).toContain('To-dos (2 of 3 kept)')
    await act(async () => button('Create draft event')!.click())
    await flush()
    expect(api.acceptPlanDraft).toHaveBeenCalledWith('workspace', 'draft-1', { todoIndexes: [0, 2] }, 1, expect.any(String))
    expect(host.textContent).toContain('event page')
  })

  it('discards after confirmation', async () => {
    await mount('/app/w/workspace/drafts/draft-1')
    await act(async () => button('Discard')!.click())
    await act(async () => button('Discard draft')!.click())
    await flush()
    expect(api.discardPlanDraft).toHaveBeenCalledWith('workspace', 'draft-1', 1)
  })

  it('shows the outcome of a reviewed draft without actions', async () => {
    api.getPlanDraft.mockResolvedValue({ ...draft, status: 'accepted', acceptedEventId: 'new-event', decidedAt: '2026-10-01T12:00:00Z', decidedByName: 'Olive Owner' })
    await mount('/app/w/workspace/drafts/draft-1')
    expect(host.textContent).toContain('by Olive Owner')
    expect(button('Create draft event')).toBeUndefined()
    expect(host.querySelector('input[aria-label^="Keep"]')).toBeNull()
  })
})
