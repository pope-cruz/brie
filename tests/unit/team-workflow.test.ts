// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceTasksPage } from '../../src/app/features/tasks/TasksPage'
import { SettingsPage } from '../../src/app/features/workspaces/SettingsPage'

const state = vi.hoisted(() => ({ role: 'member' }))
const api = vi.hoisted(() => ({ listWorkspaceTasks: vi.fn(), listTeam: vi.fn(), listEventTasks: vi.fn(), listRemovedTasks: vi.fn(), saveTask: vi.fn(), setTaskStatus: vi.fn(), removeTask: vi.fn(), restoreTask: vi.fn(), createInvitation: vi.fn(), changeMemberRole: vi.fn(), removeMember: vi.fn(), revokeInvitation: vi.fn(), saveWorkspace: vi.fn(), transferOwnership: vi.fn() }))
vi.mock('../../src/app/data/api', () => api)
vi.mock('../../src/app/features/workspaces/workspaceContext', () => ({ useCurrentWorkspace: () => ({ id: 'workspace', membershipId: 'member', name: 'Test team', role: state.role, timezone: 'America/New_York', version: 1 }) }))
const task = () => ({ id: 'task', workspaceId: 'workspace', eventId: 'event', eventTitle: 'Welcome night', title: 'Set up the welcome desk', notes: 'Bring markers.\nMeet by the entrance.', assigneeMembershipId: 'member', assigneeName: 'Sam', assigneeFormer: false, status: 'todo', dueDate: null, version: 1, eventArchived: false, overdue: false })
let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }) }
async function mount(settings = false, search = '') {
  router = createMemoryRouter([{ path: '/', element: createElement(settings ? SettingsPage : WorkspaceTasksPage) }], { initialEntries: [`/${settings ? '?tab=team' : search}`] })
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
  api.listWorkspaceTasks.mockResolvedValue({ rows: [task()], total: 1, page: 1 })
  api.listTeam.mockResolvedValue({ members: [{ id: 'member', displayName: 'Sam', email: 'sam@example.test', role: 'member', version: 1 }], invitations: [] })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  host = document.createElement('div'); host.className = 'brie-app'; document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); router?.dispose(); host.remove(); vi.unstubAllGlobals() })

describe('team task workflow', () => {
  it('lets an assigned member save only status from the detail panel', async () => {
    await mount(); await click(task().title)
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(task().notes)
    expect(host.querySelector('textarea')).toBeNull()
    await change(field('Status'), 'done'); await click('Save status')
    expect(api.setTaskStatus).toHaveBeenCalledWith('workspace', 'task', 'done', 1)
    expect(api.saveTask).not.toHaveBeenCalled()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(host.textContent).toContain('Task saved.')
  })
  it('keeps another member’s assignment read-only', async () => {
    api.listWorkspaceTasks.mockResolvedValue({ rows: [{ ...task(), assigneeMembershipId: 'other' }], total: 1, page: 1 })
    await mount(); await click(task().title)
    expect((field('Status') as HTMLSelectElement).disabled).toBe(true)
    expect(button('Save status')).toBeUndefined()
    expect(host.textContent).toContain('Only its assignee or an organizer')
  })
  it('keeps archived tasks read-only for organizers too', async () => {
    state.role = 'organizer'
    api.listWorkspaceTasks.mockResolvedValue({ rows: [{ ...task(), eventArchived: true }], total: 1, page: 1 })
    await mount(); await click(task().title)
    expect((field('Status') as HTMLSelectElement).disabled).toBe(true)
    expect(button('Save task')).toBeUndefined()
    expect(host.textContent).toContain('This event is archived')
  })
  it('preserves a proposed status on failure and permits retry', async () => {
    api.setTaskStatus.mockRejectedValueOnce(new Error('Check your connection.'))
    await mount(); await click(task().title); await change(field('Status'), 'done'); await click('Save status')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Check your connection.')
    expect((field('Status') as HTMLSelectElement).value).toBe('done')
    await click('Save status')
    expect(api.setTaskStatus).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
  it('closes a task opened from a deep link and keeps the filters', async () => {
    await mount(false, '?task=task&status=all&assignee=anyone')
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    await click('Close')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(router.state.location.search).toBe('?status=all&assignee=anyone')
  })
  it('protects unsaved edits when closing and allows explicit discard', async () => {
    state.role = 'organizer'
    await mount(); await click(task().title); await change(field('Title'), 'Updated title'); await click('Close')
    expect(host.textContent).toContain('Discard your unsaved changes?')
    await click('Keep editing')
    expect((field('Title') as HTMLInputElement).value).toBe('Updated title')
    await click('Close'); await click('Discard changes')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(api.saveTask).not.toHaveBeenCalled()
  })
  it('clears both filters when showing all tasks from an empty personal list', async () => {
    api.listWorkspaceTasks.mockResolvedValue({ rows: [], total: 0, page: 1 })
    await mount(); await click('Show all tasks')
    const params = new URLSearchParams(router.state.location.search)
    expect(params.get('status')).toBe('all')
    expect(params.get('assignee')).toBe('anyone')
  })
})

describe('team invitation feedback', () => {
  it('explains manual sharing and handles a clipboard failure', async () => {
    state.role = 'owner'
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    api.createInvitation.mockResolvedValue({ token: 'test-token', email: 'sam@example.test' })
    await mount(true)
    expect(host.textContent).toContain('Brie does not send an invitation email')
    await change(field('Email'), 'sam@example.test'); await click('Create link')
    expect((field('Invitation link') as HTMLInputElement).value).toContain('/app/invite/test-token')
    await click('Copy invitation link')
    expect(host.textContent).toContain('copy it manually')
    expect(host.textContent).toContain('They must sign in with that email')
  })
  it('reports a failed role change instead of failing silently', async () => {
    state.role = 'owner'; api.changeMemberRole.mockRejectedValue(new Error('Role change failed.'))
    await mount(true)
    await change(host.querySelector('[aria-label="Role for Sam"]')!, 'organizer'); await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Role change failed.')
    expect((host.querySelector('[aria-label="Role for Sam"]') as HTMLSelectElement).value).toBe('member')
  })
  it('does not show a false empty team while loading fails', async () => {
    state.role = 'owner'; api.listTeam.mockRejectedValue(new Error('offline'))
    await mount(true)
    expect(host.textContent).toContain('Couldn’t load the team')
    expect(host.textContent).not.toContain('No pending invitations.')
  })
  it('explains removal and supports cancel before making a change', async () => {
    state.role = 'owner'; await mount(true); await click('Remove')
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Sam will lose access')
    expect(document.activeElement?.textContent).toBe('Cancel')
    await click('Cancel')
    expect(api.removeMember).not.toHaveBeenCalled()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
  it('keeps a failed removal confirmation open for retry', async () => {
    state.role = 'owner'; api.removeMember.mockRejectedValueOnce(new Error('Check your connection.'))
    await mount(true); await click('Remove'); await click('Remove teammate')
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Check your connection.')
    await click('Remove teammate')
    expect(api.removeMember).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(host.textContent).toContain('Teammate removed.')
  })
})
