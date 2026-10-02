// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectAssistantPage } from '../../src/app/features/auth/ConnectAssistantPage'

const mocks = vi.hoisted(() => ({
  getAuthorizationDetails: vi.fn(), approveAuthorization: vi.fn(), denyAuthorization: vi.fn(),
  connectAssistant: vi.fn(), listMyWorkspaces: vi.fn(), user: { id: 'user', email: 'owner@example.test' } as { id: string; email: string } | null,
}))
vi.mock('../../src/app/data/api', () => ({ connectAssistant: mocks.connectAssistant, listMyWorkspaces: mocks.listMyWorkspaces }))
vi.mock('../../src/app/data/client', () => ({ getSupabase: () => ({ auth: { oauth: mocks } }) }))
vi.mock('../../src/app/features/auth/SessionProvider', () => ({ useSession: () => ({ configured: true, loading: false, user: mocks.user }) }))
let host: HTMLDivElement, root: Root, client: QueryClient
let router: ReturnType<typeof createMemoryRouter>
const request = { authorization_id: 'req', client: { id: 'client', name: 'Cloud Assistant' }, redirect_uri: 'https://assistant.example/callback', scope: 'openid email' }
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) }) }
async function mount(path = '/app/connect-assistant?authorization_id=req') {
  router = createMemoryRouter([
    { path: '/app/connect-assistant', Component: ConnectAssistantPage },
    { path: '/app/sign-in', Component: () => createElement('p', null, 'Sign in') },
  ], { initialEntries: [path] })
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}
function button(label: string) { return [...host.querySelectorAll('button')].find((node) => node.textContent === label)! }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  for (const mock of [mocks.getAuthorizationDetails, mocks.approveAuthorization, mocks.denyAuthorization, mocks.connectAssistant, mocks.listMyWorkspaces]) mock.mockReset()
  mocks.user = { id: 'user', email: 'owner@example.test' }
  mocks.getAuthorizationDetails.mockResolvedValue({ data: request, error: null })
  mocks.listMyWorkspaces.mockResolvedValue([{ id: 'one', name: 'Dinner Club', role: 'owner' }, { id: 'two', name: 'Other Club', role: 'member' }])
  mocks.connectAssistant.mockResolvedValue({ id: 'grant' })
  // Stop before browser navigation; full redirect/code exchange is covered by the local integration rehearsal.
  mocks.approveAuthorization.mockResolvedValue({ data: null, error: new Error('retry') })
  mocks.denyAuthorization.mockResolvedValue({ data: null, error: new Error('retry') })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); host.className = 'brie-app'; document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); router.dispose(); host.remove() })
describe('assistant connection page', () => {
  it('explains how to start when no authorization is supplied', async () => {
    await mount('/app/connect-assistant')
    expect(host.textContent).toContain('Start the connection in your assistant’s settings')
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled()
  })
  it('preserves the request through email sign-in', async () => {
    mocks.user = null; await mount()
    expect(router.state.location.pathname).toBe('/app/sign-in')
    expect(new URLSearchParams(router.state.location.search).get('return')).toBe('/app/connect-assistant?authorization_id=req')
    expect(mocks.getAuthorizationDetails).not.toHaveBeenCalled()
  })
  it('shows the client and callback, excludes member workspaces, and defaults to read only', async () => {
    await mount()
    expect(host.textContent).toContain('Cloud Assistant')
    expect(host.textContent).toContain('https://assistant.example/callback')
    expect(host.textContent).toContain('owner@example.test')
    expect(host.textContent).not.toContain('Other Club')
    await act(async () => button('Connect assistant').click())
    expect(mocks.connectAssistant).toHaveBeenCalledWith('one', 'client', 'Cloud Assistant', 'read')
    expect(mocks.approveAuthorization).toHaveBeenCalledWith('req', { skipBrowserRedirect: true })
  })
  it('cancels without creating workspace access', async () => {
    await mount(); await act(async () => button('Cancel').click())
    expect(mocks.connectAssistant).not.toHaveBeenCalled()
    expect(mocks.denyAuthorization).toHaveBeenCalledWith('req', { skipBrowserRedirect: true })
  })
  it('cannot approve without an organizer workspace', async () => {
    mocks.listMyWorkspaces.mockResolvedValue([{ id: 'two', name: 'Other Club', role: 'member' }])
    await mount()
    expect(host.textContent).toContain('You need to be an owner or organizer')
    expect(button('Connect assistant')).toBeUndefined()
  })
  it('does not approve when saving the workspace grant fails', async () => {
    mocks.connectAssistant.mockRejectedValue(new Error('No permission'))
    await mount(); await act(async () => button('Connect assistant').click())
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('No permission')
    expect(mocks.approveAuthorization).not.toHaveBeenCalled()
  })
  it('leaves an expired request with a clear retry state', async () => {
    mocks.getAuthorizationDetails.mockResolvedValue({ data: null, error: new Error('expired') })
    await mount(); expect(host.textContent).toContain('Start again from your assistant')
    expect(button('Connect assistant')).toBeUndefined()
  })
})
