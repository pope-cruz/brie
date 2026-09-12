// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunOfShowPage } from '../../src/app/features/schedule/RunOfShowPage'

const state = vi.hoisted(() => ({
  event: { id: 'event', startsAt: '2026-09-17T23:30:00Z', endsAt: '2026-09-18T00:30:00Z', timezone: 'America/New_York' },
  save: vi.fn(),
}))
vi.mock('react-router-dom', () => ({ useOutletContext: () => ({ workspace: { id: 'workspace', role: 'owner' }, event: state.event }) }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === 'team' ? { members: [] } : [], refetch: vi.fn() }),
}))
vi.mock('../../src/app/data/api', () => ({
  listSegments: vi.fn(), listTeam: vi.fn(), removeSegment: vi.fn(), restoreSegment: vi.fn(), saveSegment: (...args: unknown[]) => state.save(...args),
}))
let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  // jsdom does not implement layout observation used by Radix Checkbox.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  state.save.mockReset()
  host = document.createElement('div'); host.className = 'brie-app'; document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(createElement(RunOfShowPage)) })
  await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === 'Add segment')!.click() })
  await act(async () => {
    const title = host.querySelector<HTMLInputElement>('input[data-slot="input"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Welcome desk')
    title.dispatchEvent(new Event('input', { bubbles: true }))
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function submit() {
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

describe('schedule editor', () => {
  it('defaults to the event date and local times and saves the same instants', async () => {
    expect(host.querySelector<HTMLInputElement>('[aria-label="Start time"]')?.value).toBe('19:30')
    expect(host.querySelector<HTMLInputElement>('[aria-label="End time"]')?.value).toBe('20:30')
    expect(host.querySelector<HTMLInputElement>('[aria-label="Start date"]')?.value).toBe('2026-09-17')
    await submit()
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ startsAt: '2026-09-17T23:30:00.000Z', endsAt: '2026-09-18T00:30:00.000Z', ackWarnings: false }))
  })
  it('does not automatically acknowledge a server schedule warning', async () => {
    state.save.mockRejectedValue({ message: 'VALIDATION', details: 'Overlap detected.', hint: '{"warnings":"overlap"}' })
    await submit()
    expect(host.querySelectorAll('[role="checkbox"]')[1]?.getAttribute('data-state')).toBe('unchecked')
    await act(async () => { host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1].click() })
    await submit()
    expect(state.save).toHaveBeenLastCalledWith(expect.objectContaining({ ackWarnings: true }))
  })
  it('keeps end date in step with typed start date until same-day is unchecked', async () => {
    async function typeDate(value: string) {
      await act(async () => {
        const input = host.querySelector<HTMLInputElement>('[aria-label="Start date"]')!
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await typeDate('2026-09-19')
    expect(host.querySelector<HTMLInputElement>('[aria-label="End date"]')?.value).toBe('2026-09-19')
    expect(host.querySelector<HTMLInputElement>('[aria-label="End date"]')?.disabled).toBe(true)
    await act(async () => { host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click() })
    await typeDate('2026-09-20')
    expect(host.querySelector<HTMLInputElement>('[aria-label="End date"]')?.value).toBe('2026-09-19')
    expect(host.querySelector<HTMLInputElement>('[aria-label="End date"]')?.disabled).toBe(false)
  })

})
