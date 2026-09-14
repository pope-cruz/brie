// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventFormPage } from '../../src/app/features/events/EventFormPage'

const api = vi.hoisted(() => ({ getEvent: vi.fn(), listTeam: vi.fn() }))
vi.mock('../../src/app/data/api', () => ({ ...api, createEvent: vi.fn(), duplicateEvent: vi.fn(), updateEvent: vi.fn() }))
vi.mock('../../src/app/features/workspaces/workspaceContext', () => ({
  useCurrentWorkspace: () => ({ id: 'workspace', timezone: 'America/New_York', role: 'owner' }),
}))
const event = (id: string) => ({ id, title: `Event ${id}`, description: '', location: '',
  startsAt: '2026-10-01T17:00:00Z', endsAt: '2026-10-01T18:00:00Z', timezone: 'America/New_York',
  status: 'draft', version: 1, leadMembershipId: null })
let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }) }
async function mount(mode: 'edit' | 'duplicate' = 'edit') {
  router = createMemoryRouter([{ path: '/events/:eventId', element: createElement(EventFormPage, { mode }) }], { initialEntries: ['/events/one'] })
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}
function titleInput() { return host.querySelector<HTMLInputElement>('input[maxlength="120"]') ?? host.querySelector<HTMLInputElement>('form input')! }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  api.getEvent.mockReset().mockImplementation((_workspace, id) => Promise.resolve(event(id)))
  api.listTeam.mockReset().mockResolvedValue({ members: [], invitations: [] })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); router?.dispose(); host.remove(); vi.unstubAllGlobals() })

describe('event editor recovery', () => {
  it.each(['edit', 'duplicate'] as const)('blocks the %s form on a failed load and recovers with server values', async (mode) => {
    api.getEvent.mockRejectedValueOnce(new Error('network unavailable'))
    await mount(mode)
    expect(host.querySelector('form')).toBeNull()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load this event')
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/app/w/workspace/events')
    await act(async () => host.querySelector('button')!.click())
    await flush()
    expect(titleInput().value).toBe(mode === 'duplicate' ? 'Event one copy' : 'Event one')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
  it('shows a loading state without an editable form while the request is unresolved', async () => {
    api.getEvent.mockReturnValue(new Promise(() => {}))
    await mount()
    expect(host.querySelector('form')).toBeNull()
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading…')
  })
  it('loads the correct form when navigating directly between cached events', async () => {
    client.setQueryData(['event', 'workspace', 'one'], event('one'))
    client.setQueryData(['event', 'workspace', 'two'], event('two'))
    await mount()
    expect(titleInput().value).toBe('Event one')
    await act(async () => { await router.navigate('/events/two') })
    await flush()
    expect(titleInput().value).toBe('Event two')
  })
  it('preserves the current draft when a background refetch fails', async () => {
    await mount()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(titleInput(), 'Unsaved draft')
      titleInput().dispatchEvent(new Event('input', { bubbles: true }))
    })
    api.getEvent.mockRejectedValue(new Error('offline'))
    await act(async () => { await client.invalidateQueries({ queryKey: ['event'] }) })
    await flush()
    expect(titleInput().value).toBe('Unsaved draft')
  })
})
