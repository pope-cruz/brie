// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../../src/app/features/workspaces/SettingsPage'

const state = vi.hoisted(() => ({ role: 'member' }))
const api = vi.hoisted(() => ({ listWorkspaceTasks: vi.fn(), listTeam: vi.fn(), listEventTasks: vi.fn(), listRemovedTasks: vi.fn(), saveTask: vi.fn(), setTaskStatus: vi.fn(), removeTask: vi.fn(), restoreTask: vi.fn(), createInvitation: vi.fn(), changeMemberRole: vi.fn(), removeMember: vi.fn(), revokeInvitation: vi.fn(), saveWorkspace: vi.fn(), transferOwnership: vi.fn() }))
vi.mock('../../src/app/data/api', () => api)
vi.mock('../../src/app/features/workspaces/workspaceContext', () => ({ useCurrentWorkspace: () => ({ id: 'workspace', membershipId: 'member', name: 'Test team', role: state.role, timezone: 'America/New_York', version: 1 }) }))
let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }) }
async function mount() {
  router = createMemoryRouter([{ path: '/', element: createElement(SettingsPage) }], { initialEntries: ['/?tab=team'] })
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}
function button(text: string) { return [...host.querySelectorAll('button')].find((el) => el.textContent === text)! }
async function click(text: string) { await act(async () => button(text).click()); await flush() }
function field(label: string) { const id = [...host.querySelectorAll('label')].find((el) => el.textContent === label)!.htmlFor; return host.querySelector<HTMLElement>(`[id="${id}"]`)! }
async function change(element: HTMLElement, value: string) {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  state.role = 'member'
  Object.values(api).forEach((fn) => fn.mockReset().mockResolvedValue({}))
  api.listTeam.mockResolvedValue({ members: [{ id: 'member', displayName: 'Sam', email: 'sam@example.test', role: 'member', version: 1 }], invitations: [] })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  host = document.createElement('div'); host.className = 'brie-app'; document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); router?.dispose(); host.remove(); vi.unstubAllGlobals() })

describe('team invitation feedback', () => {
  it('explains manual sharing and handles a clipboard failure', async () => {
    state.role = 'owner'
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    api.createInvitation.mockResolvedValue({ token: 'test-token', email: 'sam@example.test' })
    await mount()
    expect(host.textContent).toContain('Brie does not send an invitation email')
    expect((field('Role') as HTMLSelectElement).value).toBe('organizer')
    await change(field('Email'), 'sam@example.test'); await click('Create link')
    expect((field('Invitation link') as HTMLInputElement).value).toContain('/app/invite/test-token')
    await click('Copy invitation link')
    expect(host.textContent).toContain('copy it manually')
    expect(host.textContent).toContain('They must sign in with that email')
  })
  it('replaces a lost pending link and shows the new link for the same organizer', async () => {
    state.role = 'owner'
    api.listTeam.mockResolvedValue({ members: [], invitations: [{ id: 'invite-1', email: 'organizer@example.test', role: 'organizer', expiresAt: '2026-10-01T00:00:00Z' }] })
    api.createInvitation.mockResolvedValue({ token: 'replacement-token', email: 'organizer@example.test' })
    await mount()
    await click('Create new link')
    expect(api.createInvitation).toHaveBeenCalledWith('workspace', 'organizer@example.test', 'organizer')
    expect((field('Invitation link') as HTMLInputElement).value).toContain('/app/invite/replacement-token')
    expect(host.textContent).toContain('The earlier link no longer works')
  })
  it('labels an expired invitation and still offers a new link', async () => {
    state.role = 'owner'
    api.listTeam.mockResolvedValue({ members: [], invitations: [{ id: 'invite-1', email: 'organizer@example.test', role: 'organizer', expiresAt: '2026-09-01T00:00:00Z', expired: true }] })
    await mount()
    expect(host.textContent).toContain('organizer@example.test · Organizer · Expired')
    expect(button('Create new link')).toBeTruthy()
  })
  it('reports a failed role change instead of failing silently', async () => {
    state.role = 'owner'; api.changeMemberRole.mockRejectedValue(new Error('Role change failed.'))
    await mount()
    await change(host.querySelector('[aria-label="Role for Sam"]')!, 'organizer'); await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Role change failed.')
    expect((host.querySelector('[aria-label="Role for Sam"]') as HTMLSelectElement).value).toBe('member')
  })
  it('does not show a false empty team while loading fails', async () => {
    state.role = 'owner'; api.listTeam.mockRejectedValue(new Error('offline'))
    await mount()
    expect(host.textContent).toContain('Couldn’t load the team')
    expect(host.textContent).not.toContain('No invitations waiting for a response.')
  })
  it('explains removal and supports cancel before making a change', async () => {
    state.role = 'owner'; await mount(); await click('Remove')
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Sam will lose access')
    expect(document.activeElement?.textContent).toBe('Cancel')
    await click('Cancel')
    expect(api.removeMember).not.toHaveBeenCalled()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
  it('keeps a failed removal confirmation open for retry', async () => {
    state.role = 'owner'; api.removeMember.mockRejectedValueOnce(new Error('Check your connection.'))
    await mount(); await click('Remove'); await click('Remove teammate')
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Check your connection.')
    await click('Remove teammate')
    expect(api.removeMember).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(host.textContent).toContain('Teammate removed.')
  })
})
