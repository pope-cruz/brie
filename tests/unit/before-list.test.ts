// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/app/data/errors'
import { EventTasksPage } from '../../src/app/features/tasks/TasksPage'
import { sortTodos } from '../../src/app/lib/todos'

const state = vi.hoisted(() => ({ role: 'owner', archivedAt: null as string | null }))
const api = vi.hoisted(() => ({ listEventTasks: vi.fn(), listRemovedTasks: vi.fn(), listTeam: vi.fn(), saveTask: vi.fn(), setTaskStatus: vi.fn(), removeTask: vi.fn(), restoreTask: vi.fn() }))
vi.mock('../../src/app/data/api', () => api)

let rows: Array<Record<string, unknown>> = []
const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'desk', workspaceId: 'workspace', eventId: 'event', eventTitle: 'Welcome night', eventStatus: 'planned', eventArchived: false,
  title: 'Set up the welcome desk', notes: '', assigneeMembershipId: null, assigneeName: null, assigneeFormer: false,
  dueDate: null, status: 'todo', removedAt: null, version: 1, overdue: false, ...overrides,
})

let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }) }
async function mount(search = '') {
  const context = {
    workspace: { id: 'workspace', role: state.role, membershipId: 'me' },
    event: { id: 'event', title: 'Welcome night', timezone: 'America/New_York', archivedAt: state.archivedAt },
  }
  router = createMemoryRouter([{ path: '/', element: createElement(Outlet, { context }), children: [{ index: true, element: createElement(EventTasksPage) }] }], { initialEntries: [`/${search}#before`] })
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}
const field = <T extends HTMLElement = HTMLInputElement>(label: string) => host.querySelector<T>(`[aria-label="${label}"]`)!
const button = (text: string) => [...document.querySelectorAll('button')].find((el) => el.textContent === text)!
async function type(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function press(target: HTMLElement, key: string) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
  await flush()
}
async function click(element: HTMLElement) { await act(async () => element.click()); await flush() }
const titles = () => [...host.querySelectorAll('[aria-label="To-dos"] [role="listitem"]')].map((row) =>
  (row.querySelector('.todo-title-input') as HTMLInputElement | null)?.value ?? row.querySelector('.todo-title-button, .todo-title-text')?.textContent?.replace(/^Edit /, ''))

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-18T16:00:00Z')) // Friday, Sep 18 in New York
  state.role = 'owner'
  state.archivedAt = null
  sessionStorage.clear()
  Object.values(api).forEach((fn) => fn.mockReset())
  rows = [task()]
  api.listEventTasks.mockImplementation(async () => ({ rows, total: rows.length, page: 1 }))
  api.listRemovedTasks.mockResolvedValue([])
  api.listTeam.mockResolvedValue({ members: [{ id: 'me', displayName: 'Sam', removedAt: null }, { id: 'ana', displayName: 'Ana', removedAt: null }] })
  let created = 0
  api.saveTask.mockImplementation(async (input) => task({
    id: input.taskId ?? `new-${++created}`, title: input.title, notes: input.notes, dueDate: input.dueDate,
    assigneeMembershipId: input.assigneeMembershipId, assigneeName: input.assigneeMembershipId === 'ana' ? 'Ana' : null,
    status: input.status, version: input.taskId ? input.expectedVersion + 1 : 1,
  }))
  api.setTaskStatus.mockImplementation(async (_w, id, status, version) => ({ ...rows.find((row) => row.id === id), status, version: version + 1 }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  host = document.createElement('div'); host.className = 'brie-app'; document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); router?.dispose(); host.remove(); vi.useRealTimers() })

describe('Before add row', () => {
  it('saves on Enter, keeps the date and person, and starts the next to-do', async () => {
    await mount()
    await type(field('New to-do'), 'Print name badges')
    await type(field('Date for new to-do'), 'thu')
    expect(host.textContent).toContain('Thu, Sep 24')
    await type(field<HTMLSelectElement>('Person for new to-do'), 'ana')
    await press(field('New to-do'), 'Enter')
    expect(api.saveTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: null, title: 'Print name badges', dueDate: '2026-09-24', assigneeMembershipId: 'ana', status: 'todo',
    }))
    expect(field('New to-do').value).toBe('')
    expect(field('Date for new to-do').value).toBe('Thu, Sep 24')
    expect(document.activeElement).toBe(field('New to-do'))
    expect(titles()).toContain('Print name badges')
  })

  it('explains an unreadable date instead of saving', async () => {
    await mount()
    await type(field('New to-do'), 'Order food')
    await type(field('Date for new to-do'), 'someday')
    await press(field('New to-do'), 'Enter')
    expect(api.saveTask).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Enter a date like fri or 10/17.')
  })

  it('turns pasted lines into one confirmed batch', async () => {
    await mount()
    const input = field('New to-do')
    await act(async () => {
      const paste = new Event('paste', { bubbles: true, cancelable: true })
      Object.assign(paste, { clipboardData: { getData: () => '- Book the room\n- Order food\n\n3. Print signs' } })
      input.dispatchEvent(paste)
    })
    await flush()
    expect(document.body.textContent).toContain('Add 3 to-dos?')
    await click(button('Add 3 to-dos'))
    expect(api.saveTask.mock.calls.map(([input]) => input.title)).toEqual(['Book the room', 'Order food', 'Print signs'])
    expect(new Set(api.saveTask.mock.calls.map(([input]) => input.requestKey)).size).toBe(3)
  })

  it('stops a failed batch and retries only what is left', async () => {
    api.saveTask.mockImplementationOnce(async (input) => task({ id: 'a', title: input.title }))
      .mockRejectedValueOnce(new AppError('UNAVAILABLE', 'Couldn’t reach Brie.'))
    await mount()
    const input = field('New to-do')
    await act(async () => {
      const paste = new Event('paste', { bubbles: true, cancelable: true })
      Object.assign(paste, { clipboardData: { getData: () => 'One\nTwo\nThree' } })
      input.dispatchEvent(paste)
    })
    await flush()
    await click(button('Add 3 to-dos'))
    expect(host.textContent).toContain('Added 1 of 3. “Two” didn’t save')
    await click(button('Retry remaining (2)'))
    expect(api.saveTask.mock.calls.map(([call]) => call.title)).toEqual(['One', 'Two', 'Two', 'Three'])
  })
})

describe('Before rows', () => {
  it('saves an edited row when focus leaves it', async () => {
    await mount()
    await type(field('Title for Set up the welcome desk'), 'Set up the check-in desk')
    await act(async () => { field('Title for Set up the welcome desk').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })) })
    await flush()
    expect(api.saveTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'desk', title: 'Set up the check-in desk', expectedVersion: 1, status: 'todo' }))
    expect(host.textContent).toContain('Saved')
  })

  it('saves a dated row again without retyping the date', async () => {
    rows = [task({ dueDate: '2026-10-19' })]
    await mount()
    expect(field('Date for Set up the welcome desk').value).toBe('Mon, Oct 19')
    const title = field('Title for Set up the welcome desk')
    await type(title, 'Set up the desk')
    await press(title, 'Enter')
    expect(api.saveTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Set up the desk', dueDate: '2026-10-19' }))
  })

  it('saves a person pick right away', async () => {
    await mount()
    await type(field<HTMLSelectElement>('Person for Set up the welcome desk'), 'ana')
    expect(api.saveTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'desk', assigneeMembershipId: 'ana', title: 'Set up the welcome desk' }))
  })

  it('keeps typed text after a failed save and offers Retry', async () => {
    api.saveTask.mockRejectedValueOnce(new AppError('UNAVAILABLE', 'Couldn’t reach Brie.'))
    await mount()
    const title = field('Title for Set up the welcome desk')
    await type(title, 'Changed title')
    await press(title, 'Enter')
    expect(title.value).toBe('Changed title')
    expect(host.textContent).toContain('Couldn’t reach Brie.')
    await click(button('Retry'))
    expect(api.saveTask).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Changed title' }))
  })

  it('offers Reload latest when someone else saved first', async () => {
    api.saveTask.mockRejectedValueOnce(new AppError('CONFLICT', 'This task changed.'))
    await mount()
    const title = field('Title for Set up the welcome desk')
    await type(title, 'My version')
    await press(title, 'Enter')
    expect(host.textContent).toContain('Someone else changed this to-do. Your text is kept.')
    expect(title.value).toBe('My version')
    rows = [task({ title: 'Their version', version: 2 })]
    await click(button('Reload latest'))
    expect(field('Title for Their version').value).toBe('Their version')
  })

  it('reverts the row with Escape', async () => {
    await mount()
    const title = field('Title for Set up the welcome desk')
    await type(title, 'Oops')
    await press(title, 'Escape')
    expect(title.value).toBe('Set up the welcome desk')
  })

  it('orders overdue, dated, then undated, and collapses done at the end', async () => {
    rows = [
      task({ id: 'u', title: 'Undated' }),
      task({ id: 'd', title: 'Done', status: 'done' }),
      task({ id: 'l', title: 'Later', dueDate: '2026-10-01' }),
      task({ id: 'o', title: 'Overdue', dueDate: '2026-09-10', overdue: true }),
      task({ id: 's', title: 'Sooner', dueDate: '2026-09-20' }),
    ]
    await mount()
    expect(titles()).toEqual(['Overdue', 'Sooner', 'Later', 'Undated', ''])
    expect(host.querySelector('.todo-done > summary')?.textContent).toBe('Done (1)')
  })

  it('checks off in place with the row version', async () => {
    await mount()
    await click(field('Done: Set up the welcome desk'))
    expect(api.setTaskStatus).toHaveBeenCalledWith('workspace', 'desk', 'done', 1)
    expect(host.querySelector('.todo-done > summary')?.textContent).toBe('Done (1)')
  })

  it('removes with Undo', async () => {
    api.removeTask.mockResolvedValue(task({ removedAt: '2026-09-18T16:00:00Z', version: 2 }))
    await mount()
    await click(button('Remove'))
    expect(api.removeTask).toHaveBeenCalledWith('workspace', 'desk', 1)
    await click(button('Undo'))
    expect(api.restoreTask).toHaveBeenCalledWith('workspace', 'desk', 2)
  })
})

describe('Before for members and filters', () => {
  it('lets a member check off only their own to-dos and read full notes', async () => {
    state.role = 'member'
    rows = [task({ id: 'tape', title: 'Tape run', assigneeMembershipId: 'me', notes: 'Bring tape.\nAnd scissors.' }), task({ id: 'signs', title: 'Signs', assigneeMembershipId: 'ana' })]
    await mount()
    expect(host.querySelector('.todo-title-input')).toBeNull()
    expect(field('Done: Tape run').disabled).toBe(false)
    expect(field('Done: Signs').disabled).toBe(true)
    await click(button('Tape run'))
    expect(host.textContent).toContain('Bring tape.\nAnd scissors.')
  })

  it('keeps every row read-only on an archived event', async () => {
    state.archivedAt = '2026-09-01T00:00:00Z'
    rows = [task({ assigneeMembershipId: 'me' })]
    await mount()
    expect(host.querySelector('.todo-title-input')).toBeNull()
    expect(field('Done: Set up the welcome desk').disabled).toBe(true)
    expect(field('New to-do')).toBeNull()
  })

  it('filters to Mine in the URL and offers Show everyone', async () => {
    await mount('?todos=mine')
    expect(host.textContent).toContain('Nothing assigned to you')
    await click(button('Show everyone'))
    expect(router.state.location.search).toBe('')
    expect(router.state.location.hash).toBe('#before')
    expect(titles()).toContain('Set up the welcome desk')
  })
})

describe('Before on phones', () => {
  it('shows organizers read rows and edits in a full-screen sheet', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 767px)', addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    try {
      await mount()
      expect(host.querySelector('.todo-title-input')).toBeNull()
      expect(field('New to-do')).toBeNull()
      await click(button('Edit Set up the welcome desk'))
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      expect(dialog.textContent).toContain('Edit to-do')
      const title = [...dialog.querySelectorAll('input')][0] as HTMLInputElement
      await type(title, 'Set up the check-in desk')
      await click([...dialog.querySelectorAll('button')].find((el) => el.textContent === 'Save')!)
      expect(api.saveTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'desk', title: 'Set up the check-in desk', expectedVersion: 1 }))
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('sortTodos', () => {
  it('keeps list order among undated to-dos', () => {
    const list = [task({ id: 'b' }), task({ id: 'a' })] as never[]
    expect(sortTodos(list).map((row: { id: string }) => row.id)).toEqual(['b', 'a'])
  })
})
