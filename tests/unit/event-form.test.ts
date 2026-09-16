// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventFormPage } from '../../src/app/features/events/EventFormPage'

const api = vi.hoisted(() => ({ getEvent: vi.fn(), listTeam: vi.fn(), createEvent: vi.fn(), duplicateEvent: vi.fn(), updateEvent: vi.fn() }))
vi.mock('../../src/app/data/api', () => api)
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
async function mount(mode: 'new' | 'edit' | 'duplicate' = 'edit') {
  router = createMemoryRouter([
    { path: '/events/:eventId', element: createElement(EventFormPage, { mode }) },
    { path: '*', element: createElement('p', { 'data-testid': 'elsewhere' }, 'elsewhere') },
  ], { initialEntries: ['/events/one'] })
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}
function titleInput() { return host.querySelector<HTMLInputElement>('input[maxlength="120"]') ?? host.querySelector<HTMLInputElement>('form input')! }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  api.getEvent.mockReset().mockImplementation((_workspace, id) => Promise.resolve(event(id)))
  api.listTeam.mockReset().mockResolvedValue({ members: [], invitations: [] })
  api.createEvent.mockReset(); api.duplicateEvent.mockReset(); api.updateEvent.mockReset()
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

function submitForm() {
  return act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(element)
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

describe('event editor saves', () => {
  it('shows required-field guidance instead of a daylight-saving message when dates are blank', async () => {
    await mount('new')
    await act(async () => setValue(titleInput(), 'Welcome night'))
    await submitForm()
    await flush()
    const alerts = [...host.querySelectorAll('[role="alert"]')].map((node) => node.textContent)
    expect(alerts).toContain('Enter a start date and time.')
    expect(alerts).toContain('Enter an end date and time.')
    expect(alerts.join(' ')).not.toContain('does not exist')
    expect(api.createEvent).not.toHaveBeenCalled()
  })
  it('updates the cached event so the header shows the new status before any refetch', async () => {
    api.updateEvent.mockImplementation(async (input) => ({ ...event('one'), status: input.status, version: 2 }))
    client.setQueryData(['events', 'workspace', 'upcoming'], { items: [] })
    await mount('edit')
    const statusSelect = [...host.querySelectorAll<HTMLSelectElement>('select')].find((node) =>
      [...node.options].some((option) => option.value === 'planned'))!
    await act(async () => setValue(statusSelect, 'planned'))
    await submitForm()
    await flush()
    expect(api.updateEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'one', status: 'planned', expectedVersion: 1 }))
    expect(client.getQueryData(['event', 'workspace', 'one'])).toMatchObject({ status: 'planned', version: 2 })
    expect(client.getQueryState(['events', 'workspace', 'upcoming'])?.isInvalidated).toBe(true)
    expect(router.state.location.pathname).toBe('/app/w/workspace/events/one')
  })
  it('does not offer description or location edits that a duplicate would discard', async () => {
    api.duplicateEvent.mockResolvedValue({ ...event('copy'), title: 'Event one copy' })
    await mount('duplicate')
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.querySelector('input[maxlength="200"]')).toBeNull()
    expect(host.textContent).toContain('original description, location')
    await submitForm()
    await flush()
    expect(api.duplicateEvent).toHaveBeenCalledWith(expect.objectContaining({ sourceEventId: 'one', title: 'Event one copy' }))
    expect(client.getQueryData(['event', 'workspace', 'copy'])).toMatchObject({ title: 'Event one copy' })
  })
})
