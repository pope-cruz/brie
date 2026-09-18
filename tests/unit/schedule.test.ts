// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunOfShowPage } from '../../src/app/features/schedule/RunOfShowPage'

// 7:30–8:30 PM EDT on Thursday, Sep 17.
const state = vi.hoisted(() => ({
  role: 'owner',
  event: {
    id: 'event', title: 'Tech@NYU Demo Night', location: 'Room 101', teamBriefing: '', version: 1,
    startsAt: '2026-09-17T23:30:00Z', endsAt: '2026-09-18T00:30:00Z', timezone: 'America/New_York', archivedAt: null,
  },
  save: vi.fn(),
  remove: vi.fn(),
  segments: [] as Array<Record<string, unknown>>,
}))

vi.mock('react-router-dom', () => ({ useOutletContext: () => ({ workspace: { id: 'workspace', role: state.role }, event: state.event }) }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === 'team' ? { members: [] } : state.segments, refetch: vi.fn() }),
}))
vi.mock('../../src/app/data/api', () => ({
  listSegments: vi.fn(), listTeam: vi.fn(), removeSegment: (...args: unknown[]) => state.remove(...args), restoreSegment: vi.fn(), saveTeamBriefing: vi.fn(),
  saveSegment: (...args: unknown[]) => state.save(...args),
}))

let host: HTMLDivElement
let root: Root

function segment(overrides: Record<string, unknown>) {
  return {
    id: 'segment', workspaceId: 'workspace', eventId: 'event', title: 'Doors open',
    startsAt: '2026-09-17T23:30:00Z', endsAt: '2026-09-18T00:00:00Z', ownerMembershipId: null,
    ownerName: null, ownerFormer: false, instructions: 'Welcome guests.', removedAt: null,
    version: 3, sortOrder: 1000, overlaps: false, outOfRange: false, ...overrides,
  }
}

const field = <T extends HTMLElement = HTMLInputElement>(label: string) => host.querySelector<T>(`[aria-label="${label}"]`)!
const button = (text: string) => [...host.querySelectorAll('button')].find((item) => item.textContent === text)

async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init })) })
}

async function render() {
  await act(async () => { root.render(createElement(RunOfShowPage)) })
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.role = 'owner'
  state.segments = []
  state.remove.mockReset().mockResolvedValue(undefined)
  state.save.mockReset().mockImplementation(async (input) => segment({
    id: 'saved', title: input.title, startsAt: input.startsAt, endsAt: input.endsAt,
    ownerMembershipId: input.ownerMembershipId, instructions: input.instructions, version: 1,
  }))
  host = document.createElement('div')
  host.className = 'brie-app'
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('run of show add row', () => {
  it('starts at the event start with a 30-minute length and saves on Enter', async () => {
    await render()
    expect(field('Start for new item').value).toBe('7:30 PM')
    expect(field('Length for new item').value).toBe('30 min')
    expect(host.textContent).toContain('Ends 8 PM')
    await type(field('Activity for new item'), 'Welcome desk')
    await press(field('Activity for new item'), 'Enter')
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Welcome desk',
      startsAt: '2026-09-17T23:30:00.000Z',
      endsAt: '2026-09-18T00:00:00.000Z',
      segmentId: null,
      ackWarnings: true,
    }))
  })

  it('reads a bare hour as the nearer AM or PM and a typed length', async () => {
    await render()
    await type(field('Start for new item'), '8')
    await type(field('Length for new item'), '1h15')
    expect(host.textContent).toContain('Ends 9:15 PM')
    await type(field('Activity for new item'), 'Panel')
    await press(field('Length for new item'), 'Enter')
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({
      startsAt: '2026-09-18T00:00:00.000Z',
      endsAt: '2026-09-18T01:15:00.000Z',
    }))
  })

  it('shows the next day when a length crosses midnight', async () => {
    await render()
    await type(field('Start for new item'), '11:45p')
    await type(field('Length for new item'), '30')
    expect(host.textContent).toContain('Ends 12:15 AM next day')
  })

  it('explains an unreadable start or length instead of saving', async () => {
    await render()
    await type(field('Activity for new item'), 'Welcome desk')
    await type(field('Start for new item'), 'soon')
    await press(field('Activity for new item'), 'Enter')
    expect(host.textContent).toContain('Enter a start time like 6:30 PM.')
    await type(field('Start for new item'), '7:30p')
    await type(field('Length for new item'), 'long')
    await press(field('Activity for new item'), 'Enter')
    expect(host.textContent).toContain('Enter a length like 30 min or 1 hr.')
    expect(state.save).not.toHaveBeenCalled()
  })

  it('keeps multiline notes and saves from notes only with Ctrl+Enter', async () => {
    await render()
    await type(field('Activity for new item'), 'Welcome desk')
    const notes = field<HTMLTextAreaElement>('Notes for new item')
    await type(notes, 'Put signs by the elevator.\nKeep the east door clear.')
    await press(notes, 'Enter')
    expect(state.save).not.toHaveBeenCalled()
    await press(notes, 'Enter', { ctrlKey: true })
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ instructions: 'Put signs by the elevator.\nKeep the east door clear.' }))
  })

  it('keeps the draft after a failed save', async () => {
    state.save.mockRejectedValueOnce(new Error('Connection failed.'))
    await render()
    await type(field('Activity for new item'), 'Welcome desk')
    await type(field<HTMLTextAreaElement>('Notes for new item'), 'Keep this note.')
    await press(field('Activity for new item'), 'Enter')
    expect(host.textContent).toContain('Connection failed.')
    expect(field('Activity for new item').value).toBe('Welcome desk')
    expect(field<HTMLTextAreaElement>('Notes for new item').value).toBe('Keep this note.')
  })

  it('starts after the last item', async () => {
    state.segments = [segment({})]
    await render()
    expect(field('Start for new item').value).toBe('8 PM')
  })
})

describe('run of show rows', () => {
  it('orders by time, not by saved position', async () => {
    state.segments = [
      segment({ id: 'late', title: 'Doors open', startsAt: '2026-09-18T00:00:00Z', endsAt: '2026-09-18T00:30:00Z', sortOrder: 1000 }),
      segment({ id: 'early', title: 'Room setup', startsAt: '2026-09-17T22:00:00Z', endsAt: '2026-09-17T23:00:00Z', sortOrder: 2000 }),
    ]
    await render()
    expect([...host.querySelectorAll('.ros-row-title')].map((item) => item.textContent)).toEqual(['Edit Room setup', 'Edit Doors open'])
    expect(host.textContent).toContain('6 PM – 7 PM')
    expect(host.textContent).toContain('1 hr gap before')
  })

  it('opens one row for editing and cancels with Escape', async () => {
    state.segments = [segment({})]
    await render()
    await act(async () => { button('Edit Doors open')!.click() })
    expect(field('Start for Doors open').value).toBe('7:30 PM')
    expect(field('Length for Doors open').value).toBe('30 min')
    expect(document.activeElement).toBe(field('Activity for Doors open'))
    await press(field('Activity for Doors open'), 'Escape')
    expect(host.querySelector('[aria-label="Start for Doors open"]')).toBeNull()
  })

  it('saves an edited length against the same item and version', async () => {
    state.segments = [segment({})]
    await render()
    await act(async () => { button('Edit Doors open')!.click() })
    await type(field('Length for Doors open'), '45m')
    await press(field('Length for Doors open'), 'Enter')
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({
      segmentId: 'segment', expectedVersion: 3, endsAt: '2026-09-18T00:15:00.000Z',
    }))
  })

  it('shows members read-only rows with Everyone for unassigned items', async () => {
    state.role = 'member'
    state.segments = [segment({})]
    await render()
    expect(host.querySelector('input')).toBeNull()
    expect(host.querySelector('.ros-row-menu')).toBeNull()
    expect(host.textContent).toContain('Everyone')
    expect(host.textContent).toContain('Welcome guests.')
  })

  it('requires confirmation before removing an item', async () => {
    state.segments = [segment({})]
    await render()
    await act(async () => { host.querySelector<HTMLDetailsElement>('.ros-row-menu')!.open = true })
    await act(async () => { button('Remove')!.click() })
    expect(state.remove).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Remove “Doors open”?')
    await act(async () => { button('Remove item')!.click() })
    expect(state.remove).toHaveBeenCalledWith('workspace', 'segment', 3)
  })
})
