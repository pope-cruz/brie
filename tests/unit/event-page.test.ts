// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventPage } from '../../src/app/features/events/EventPage'

const state = vi.hoisted(() => ({
  role: 'owner' as string,
  hash: '',
  event: {} as Record<string, unknown>,
}))

vi.mock('react-router-dom', () => ({
  useOutletContext: () => ({ workspace: { id: 'workspace', role: state.role }, event: state.event }),
  useLocation: () => ({ hash: state.hash, pathname: '/app/w/workspace/events/event', search: '' }),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) =>
    createElement('a', { href: to, className }, children),
}))
vi.mock('../../src/app/features/tasks/TasksPage', () => ({ EventTasksPage: () => createElement('p', null, 'to-do list') }))
vi.mock('../../src/app/features/schedule/RunOfShowPage', () => ({ RunOfShowPage: () => createElement('p', null, 'run of show') }))

let host: HTMLDivElement
let root: Root

async function render() {
  await act(async () => { root.render(createElement(EventPage)) })
}

const text = (selector: string) => host.querySelector(selector)?.textContent ?? ''
const links = () => [...host.querySelectorAll('.event-after a')].map((link) => link.textContent)

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  state.role = 'owner'
  state.hash = ''
  // Far enough ahead that the page opens on Before.
  state.event = {
    id: 'event', title: 'Welcome night', status: 'planned', archivedAt: null,
    startsAt: '2099-10-20T22:00:00Z', endsAt: '2099-10-21T01:00:00Z', timezone: 'America/New_York',
    taskDone: 3, taskTotal: 5, attendanceCount: 0,
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('event page', () => {
  it('shows Before, Day of, and After in order with their summaries', async () => {
    await render()
    expect([...host.querySelectorAll('section h2')].map((heading) => heading.textContent)).toEqual(['Before', 'Day of', 'After'])
    expect(text('#before .event-section-summary')).toBe('3 of 5 done')
    expect(text('#day-of .event-section-summary')).toMatch(/^Tue, Oct 20 · /)
    expect(text('#before .event-section-body')).toBe('to-do list')
    expect(text('#day-of .event-section-body')).toBe('run of show')
  })

  it('expands only the current phase for mobile collapsing', async () => {
    await render()
    expect(host.querySelector('#before')?.hasAttribute('data-collapsed')).toBe(false)
    expect(host.querySelector('#day-of')?.hasAttribute('data-collapsed')).toBe(true)
    expect(host.querySelector('#after')?.hasAttribute('data-collapsed')).toBe(true)
  })

  it('opens the section named in the URL and scrolls to it', async () => {
    state.hash = '#day-of'
    await render()
    expect(host.querySelector('#day-of')?.hasAttribute('data-collapsed')).toBe(false)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('gives organizers attendance actions', async () => {
    await render()
    expect(links()).toEqual(['Import attendance', 'View imports'])
    state.event = { ...state.event, attendanceCount: 84 }
    await render()
    expect(text('#after .event-section-summary')).toBe('84 attendees recorded')
    expect(links()).toEqual(['Import attendance', 'View attendees', 'View imports'])
  })

  it('does not offer imports for canceled events', async () => {
    state.event = { ...state.event, status: 'canceled' }
    await render()
    expect(links()).toEqual(['View imports'])
  })

  it('shows members only the aggregate attendance line', async () => {
    state.role = 'member'
    state.event = { ...state.event, attendanceCount: 84 }
    await render()
    expect(host.querySelector('.event-after')).toBeNull()
    expect(text('#after .event-section-summary')).toBe('84 attendees recorded')
    expect(text('#after .event-section-body')).toBe('Organizers record attendance after the event.')
  })
})
