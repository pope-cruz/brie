// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantAccessPage } from '../../src/app/features/workspaces/AssistantAccessPage'
import { claudeCodeCommand, describeAction, mcpServerUrl, outcomeLabel } from '../../src/app/lib/assistantAccess'

const api = vi.hoisted(() => ({
  listAssistantTokens: vi.fn(),
  listAssistantActions: vi.fn(),
  createAssistantToken: vi.fn(),
  revokeAssistantToken: vi.fn(),
}))
vi.mock('../../src/app/data/api', () => api)
vi.mock('../../src/app/features/auth/SessionProvider', () => ({ useSession: () => ({ user: { id: 'user' } }) }))

const SECRET = `brie_${'a'.repeat(64)}`
const token = {
  id: 'token-1', label: 'Claude on my laptop', scope: 'read', prefix: 'brie_aaaaaaaa',
  createdAt: '2026-09-30T12:00:00Z', expiresAt: '2026-10-30T12:00:00Z', lastUsedAt: null,
  revokedAt: null, status: 'active', createdBy: 'user', createdByName: 'Olive Owner',
}

let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

async function mount(role = 'organizer') {
  router = createMemoryRouter(
    [{
      path: '/app/w/workspace',
      element: createElement(Outlet, { context: { id: 'workspace', role, timezone: 'UTC' } }),
      children: [{ path: 'assistant', element: createElement(AssistantAccessPage) }],
    }],
    { initialEntries: ['/app/w/workspace/assistant'] },
  )
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}

function button(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll('button')].find((el) => el.textContent === text)
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.values(api).forEach((fn) => fn.mockReset())
  api.listAssistantTokens.mockResolvedValue([token])
  api.listAssistantActions.mockResolvedValue([
    { id: 2, tool: 'search_events', arguments: { query: 'founder dinner' }, outcome: 'ok', createdAt: '2026-09-30T13:00:00Z', tokenId: 'token-1', tokenLabel: 'Claude on my laptop' },
    { id: 1, tool: 'get_event_plan', arguments: { eventId: 'x' }, outcome: 'UNAVAILABLE', createdAt: '2026-09-30T12:30:00Z', tokenId: 'token-1', tokenLabel: 'Claude on my laptop' },
  ])
  api.createAssistantToken.mockResolvedValue({ ...token, id: 'token-2', label: 'Team laptop', secret: SECRET })
  api.revokeAssistantToken.mockResolvedValue({ ...token, status: 'revoked' })
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
  vi.unstubAllGlobals()
})

describe('assistant access helpers', () => {
  it('builds the server URL and Claude Code command', () => {
    expect(mcpServerUrl('https://abc.supabase.co/')).toBe('https://abc.supabase.co/functions/v1/mcp')
    expect(claudeCodeCommand('https://abc.supabase.co/functions/v1/mcp', SECRET))
      .toBe(`claude mcp add --transport http brie https://abc.supabase.co/functions/v1/mcp --header "Authorization: Bearer ${SECRET}"`)
  })

  it('describes logged calls in plain language', () => {
    expect(describeAction({ tool: 'search_events', arguments: { query: 'dinner' } })).toBe('Searched events: “dinner”')
    expect(describeAction({ tool: 'get_event_plan', arguments: {} })).toBe('Read an event plan')
    expect(describeAction({ tool: 'mystery', arguments: {} })).toBe('Called mystery')
    expect(outcomeLabel('ok')).toBe('Done')
    expect(outcomeLabel('UNAVAILABLE')).toBe('Not found in this workspace')
    expect(outcomeLabel('BOOM')).toBe('Failed (BOOM)')
  })
})

describe('assistant access page', () => {
  it('is unavailable to members and loads nothing', async () => {
    await mount('member')
    expect(host.querySelector('h1')?.textContent).toBe('This page isn’t available')
    expect(api.listAssistantTokens).not.toHaveBeenCalled()
  })

  it('lists keys without their secret and shows logged activity', async () => {
    await mount()
    expect(host.textContent).toContain('Claude on my laptop')
    expect(host.textContent).toContain('brie_aaaaaaaa…')
    expect(host.textContent).toContain('Last used Never')
    expect(host.textContent).toContain('Searched events: “founder dinner”')
    expect(host.textContent).toContain('Not found in this workspace')
  })

  it('requires a name, then shows the new key once with a ready command', async () => {
    await mount()
    await act(async () => button('Create key')!.click())
    expect(host.textContent).toContain('Name the key so you can recognize it later.')
    expect(api.createAssistantToken).not.toHaveBeenCalled()
    await type(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Claude on my laptop"]')!, 'Team laptop')
    await act(async () => button('Create key')!.click())
    await flush()
    expect(api.createAssistantToken).toHaveBeenCalledWith('workspace', 'Team laptop', 'read', 30)
    expect(host.textContent).toContain('This is the only time Brie shows this key.')
    expect([...host.querySelectorAll('input')].some((input) => input.value === SECRET)).toBe(true)
    expect(host.querySelector('textarea')?.value).toContain(`Authorization: Bearer ${SECRET}`)
    await act(async () => button('I’ve saved it')!.click())
    expect(host.textContent).not.toContain(SECRET)
  })

  it('revokes a key after confirmation', async () => {
    await mount()
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Revoke Claude on my laptop"]')!.click())
    expect(document.body.textContent).toContain('Any assistant using this key loses access on its next request.')
    await act(async () => button('Revoke key')!.click())
    await flush()
    expect(api.revokeAssistantToken).toHaveBeenCalledWith('workspace', 'token-1')
  })
})
