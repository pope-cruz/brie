// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailsPanel, QuickCreateButton } from '../../src/app/features/events/EventPanels'
import { EditDetailsRedirect } from '../../src/app/features/events/EventLayout'

const api = vi.hoisted(() => ({ createEvent: vi.fn(), updateEvent: vi.fn(), duplicateEvent: vi.fn(), getEvent: vi.fn(), listTeam: vi.fn() }))
vi.mock('../../src/app/data/api', () => api)

const workspace = { id: 'w', name: 'Club', role: 'owner', membershipId: 'me', timezone: 'America/New_York', version: 1 } as never
const event = {
  id: 'e1', workspaceId: 'w', title: 'Welcome night', description: '', location: '', startsAt: '2026-10-20T22:00:00Z',
  endsAt: '2026-10-21T00:00:00Z', timezone: 'America/New_York', status: 'draft', version: 4, leadMembershipId: null,
} as never

let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }) }
async function mount(element: ReturnType<typeof createElement>, path = '/') {
  router = createMemoryRouter([
    { path: '/', element },
    { path: '/app/w/:w/events/:e', element: createElement('p', { id: 'landed' }, 'event page') },
  ], { initialEntries: [path] })
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}
const inDoc = (selector: string) => document.querySelector<HTMLElement>(selector)
const byLabel = (text: string) => {
  const named = document.querySelector<HTMLInputElement>(`[aria-label="${text}"]`)
  if (named) return named
  const label = [...document.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith(text))
  return (label?.htmlFor ? document.getElementById(label.htmlFor) : label?.querySelector('input,select,textarea')) as HTMLInputElement
}
const button = (text: string) => [...document.querySelectorAll('button')].find((item) => item.textContent === text)!
async function type(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function click(element: HTMLElement) { await act(async () => element.click()); await flush() }
async function escape() {
  await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  await flush()
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.values(api).forEach((fn) => fn.mockReset())
  api.listTeam.mockResolvedValue({ members: [], invitations: [] })
  api.createEvent.mockImplementation(async (input) => ({ ...(event as object), id: 'new-event', title: input.title }))
  api.updateEvent.mockImplementation(async (input) => ({ ...(event as object), title: input.title, status: input.status, version: 5 }))
  sessionStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  host = document.createElement('div'); host.className = 'brie-app'; document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); router?.dispose(); host.remove(); vi.unstubAllGlobals() })

describe('quick create', () => {
  it('asks only title, zone, and times, then opens the event with focus on Before', async () => {
    await mount(createElement(QuickCreateButton, { workspace }))
    await click(button('New event'))
    expect(inDoc('.event-quick-popover')).not.toBeNull()
    expect(byLabel('Description')).toBeUndefined()
    expect(byLabel('Lead')).toBeUndefined()
    expect(document.body.textContent).toContain('Times in')
    await type(byLabel('Title'), 'Game night')
    await type(byLabel('Start date'), '2026-10-22')
    await type(byLabel('Start time'), '19:00')
    await type(byLabel('End time'), '21:00')
    await act(async () => { byLabel('Title').form!.requestSubmit() })
    await flush()
    expect(api.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'w', title: 'Game night', startsAt: '2026-10-22T23:00:00.000Z', endsAt: '2026-10-23T01:00:00.000Z', timezone: 'America/New_York',
    }))
    expect(router.state.location.pathname).toBe('/app/w/w/events/new-event')
    expect(router.state.location.state).toEqual({ focus: 'before' })
  })

  it('closes untouched on Escape but confirms before discarding typed input', async () => {
    await mount(createElement(QuickCreateButton, { workspace }))
    await click(button('New event'))
    await escape()
    expect(inDoc('.event-quick-popover')).toBeNull()

    await click(button('New event'))
    await type(byLabel('Title'), 'Half typed')
    await escape()
    expect(inDoc('.event-quick-popover')).not.toBeNull()
    expect(document.body.textContent).toContain('Discard what you typed?')
    await click(button('Keep editing'))
    expect(byLabel('Title').value).toBe('Half typed')
    await escape()
    await click(button('Discard'))
    expect(inDoc('.event-quick-popover')).toBeNull()

    await click(button('New event'))
    expect(document.body.textContent).not.toContain('Discard what you typed?')
    expect(byLabel('Title').value).toBe('')
  })

  it('shows a server field error once', async () => {
    const { AppError } = await import('../../src/app/data/errors')
    api.createEvent.mockRejectedValueOnce(new AppError('VALIDATION', 'End must be after start.', { endsAt: 'End must be after start.' }))
    await mount(createElement(QuickCreateButton, { workspace }))
    await click(button('New event'))
    await type(byLabel('Title'), 'Game night')
    await type(byLabel('Start date'), '2026-10-22')
    await type(byLabel('Start time'), '19:00')
    await type(byLabel('End time'), '21:00')
    await act(async () => { byLabel('Title').form!.requestSubmit() })
    await flush()
    expect(document.body.textContent!.split('End must be after start.').length - 1).toBe(1)
    await type(byLabel('End time'), '22:00')
    expect(document.body.textContent).not.toContain('End must be after start.')
  })

  it('makes a repeated clock time on the fall-back night an explicit choice', async () => {
    await mount(createElement(QuickCreateButton, { workspace }))
    await click(button('New event'))
    await type(byLabel('Title'), 'Late show')
    await type(byLabel('Start date'), '2026-11-01')
    await type(byLabel('Start time'), '01:30')
    await type(byLabel('End time'), '02:30')
    await act(async () => { byLabel('Title').form!.requestSubmit() })
    await flush()
    expect(api.createEvent).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('This time happens twice')
  })
})

describe('details panel', () => {
  it('edits every field against the version that was opened', async () => {
    const onClose = vi.fn()
    await mount(createElement(DetailsPanel, { workspace, event, onClose }))
    expect(inDoc('.event-details-panel')).not.toBeNull()
    expect(byLabel('Description')).toBeDefined()
    expect(byLabel('Location')).toBeDefined()
    await type(byLabel('Title'), 'Welcome night 2')
    await type(byLabel('Status') as unknown as HTMLSelectElement, 'planned')
    await click(button('Save'))
    expect(api.updateEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1', title: 'Welcome night 2', status: 'planned', expectedVersion: 4 }))
    expect(onClose).toHaveBeenCalled()
  })

  it('confirms before closing with unsaved changes', async () => {
    const onClose = vi.fn()
    await mount(createElement(DetailsPanel, { workspace, event, onClose }))
    await type(byLabel('Location'), 'Room 101')
    await click(button('Close'))
    expect(onClose).not.toHaveBeenCalled()
    await click(button('Discard'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('old edit URL', () => {
  it('opens the details panel on the event page', async () => {
    router = createMemoryRouter([
      { path: '/app/w/:workspaceId/events/:eventId/edit', element: createElement(EditDetailsRedirect) },
      { path: '/app/w/:workspaceId/events/:eventId', element: createElement('p', null, 'event') },
    ], { initialEntries: ['/app/w/w/events/e1/edit'] })
    await act(async () => root.render(createElement(RouterProvider, { router })))
    await flush()
    expect(router.state.location.pathname + router.state.location.search).toBe('/app/w/w/events/e1?details=1')
  })
})
