// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/app/data/errors'
import { HomePage } from '../../src/app/features/workspaces/HomePage'
import { groupByEvent } from '../../src/app/lib/groupByEvent'
import { appChildren } from '../../src/app/appRoutes'

const state = vi.hoisted(() => ({ role: 'member' }))
const api = vi.hoisted(() => ({ listWorkspaceTasks: vi.fn(), listEvents: vi.fn(), setTaskStatus: vi.fn() }))
vi.mock('../../src/app/data/api', () => api)
vi.mock('../../src/app/features/workspaces/workspaceContext', () => ({ useCurrentWorkspace: () => ({ id: 'workspace', membershipId: 'me', role: state.role }) }))

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'desk', workspaceId: 'workspace', eventId: 'welcome', eventTitle: 'Welcome night', title: 'Set up the welcome desk',
  notes: '', assigneeMembershipId: 'me', assigneeName: 'Sam', assigneeFormer: false, status: 'todo', dueDate: null,
  version: 1, eventArchived: false, overdue: false, ...overrides,
})

let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }) }
async function mount() {
  router = createMemoryRouter([{ path: '/', element: createElement(HomePage) }], { initialEntries: ['/'] })
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}
const checkbox = (title: string) => [...host.querySelectorAll('label')].find((el) => el.textContent === title)!.querySelector('input')!
async function click(element: HTMLElement) { await act(async () => element.click()); await flush() }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.role = 'member'
  Object.values(api).forEach((fn) => fn.mockReset())
  api.listWorkspaceTasks.mockResolvedValue({ rows: [task()], total: 1, page: 1 })
  api.listEvents.mockResolvedValue({ rows: [], total: 0, page: 1 })
  api.setTaskStatus.mockImplementation(async (_w, _id, status, version) => task({ status, version: version + 1 }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  host = document.createElement('div'); host.className = 'brie-app'; document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); router?.dispose(); host.remove() })

describe('Home', () => {
  it('asks only for my open to-dos in unclosed events', async () => {
    await mount()
    expect(api.listWorkspaceTasks).toHaveBeenCalledWith('workspace', 'open', 'me', false, 1)
    expect(host.querySelector('h3 a')?.textContent).toBe('Welcome night')
    expect(api.listEvents).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Upcoming events')
  })

  it('checks off in place, then unchecks with the new version', async () => {
    await mount()
    await click(checkbox('Set up the welcome desk'))
    expect(api.setTaskStatus).toHaveBeenCalledWith('workspace', 'desk', 'done', 1)
    expect(checkbox('Set up the welcome desk').checked).toBe(true)
    await click(checkbox('Set up the welcome desk'))
    expect(api.setTaskStatus).toHaveBeenLastCalledWith('workspace', 'desk', 'todo', 2)
    expect(checkbox('Set up the welcome desk').checked).toBe(false)
  })

  it('rolls back a failed check-off and retries from the row', async () => {
    api.setTaskStatus.mockRejectedValueOnce(new AppError('UNAVAILABLE', 'Couldn’t reach Brie.'))
    await mount()
    await click(checkbox('Set up the welcome desk'))
    expect(checkbox('Set up the welcome desk').checked).toBe(false)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t reach Brie.')
    await click([...host.querySelectorAll('button')].find((el) => el.textContent === 'Retry')!)
    expect(api.setTaskStatus).toHaveBeenLastCalledWith('workspace', 'desk', 'done', 1)
    expect(checkbox('Set up the welcome desk').checked).toBe(true)
  })

  it('refreshes instead of forcing a change someone else made first', async () => {
    api.setTaskStatus.mockRejectedValueOnce(new AppError('CONFLICT', 'This task changed.'))
    await mount()
    api.listWorkspaceTasks.mockResolvedValue({ rows: [], total: 0, page: 1 })
    await click(checkbox('Set up the welcome desk'))
    expect(host.textContent).toContain('changed while you were checking it off')
    expect(host.textContent).toContain('Nothing assigned to you yet')
  })

  it('shows organizers the next five upcoming events', async () => {
    state.role = 'organizer'
    api.listWorkspaceTasks.mockResolvedValue({ rows: [], total: 0, page: 1 })
    api.listEvents.mockResolvedValue({ total: 6, page: 1, rows: Array.from({ length: 6 }, (_, index) => ({
      id: `e${index}`, title: `Event ${index}`, startsAt: '2026-10-20T22:00:00Z', endsAt: '2026-10-21T00:00:00Z', timezone: 'America/New_York',
    })) })
    await mount()
    expect(api.listEvents).toHaveBeenCalledWith('workspace', 'upcoming', '', 1)
    expect([...host.querySelectorAll('.home-event a')].map((el) => el.textContent)).toEqual(['Event 0', 'Event 1', 'Event 2', 'Event 3', 'Event 4'])
  })
})

describe('groupByEvent', () => {
  it('keeps the list order and groups each event once', () => {
    const rows = [task({ id: 'a', eventId: 'x' }), task({ id: 'b', eventId: 'y' }), task({ id: 'c', eventId: 'x' })] as never[]
    expect(groupByEvent(rows).map((group) => [group.eventId, group.tasks.map((row: { id: string }) => row.id)])).toEqual([['x', ['a', 'c']], ['y', ['b']]])
  })
})

describe('workspace redirects', () => {
  const redirect = async (path: string) => {
    router?.dispose()
    router = createMemoryRouter(
      appChildren[4].children!.filter((route) => ['tasks', 'attendance', 'attendance/:personId'].includes(route.path!))
        .concat([{ path: '*', Component: () => null }]).map((route) => ({ ...route, path: `/app/w/:workspaceId/${route.path}` })),
      { initialEntries: [path] })
    await act(async () => root.render(createElement(RouterProvider, { router, key: path })))
    await flush()
    return router.state.location.pathname + router.state.location.search
  }
  it('sends old Tasks and Attendance bookmarks to Home and People', async () => {
    expect(await redirect('/app/w/ws/tasks?status=done')).toBe('/app/w/ws/home')
    expect(await redirect('/app/w/ws/attendance?q=bo&page=2')).toBe('/app/w/ws/people?q=bo&page=2')
    expect(await redirect('/app/w/ws/attendance/person-1?q=bo')).toBe('/app/w/ws/people/person-1?q=bo')
  })
})
