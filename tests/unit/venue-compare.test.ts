// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VenueListPage } from '../../src/app/features/venues/VenueListPage'
import { VenueComparePage } from '../../src/app/features/venues/VenueComparePage'

const api = vi.hoisted(() => ({
  compareVenues: vi.fn(),
  getEvent: vi.fn(),
  getEventVenue: vi.fn(),
  setEventVenue: vi.fn(),
}))
vi.mock('../../src/app/data/api', () => api)

const base = {
  workspaceId: 'workspace', address: '', costNotes: '', accessibility: '', equipment: '',
  bookingContact: '', bookingLink: '', restrictions: '', notes: '', removedAt: null, version: 1,
  usage: { pastEventCount: 0, lastUsedOn: null, largestAttendance: null },
}
const fit = { requestBy: '2026-11-01', requestByPassed: false, linkedToEvent: false, conflicts: [] }
const venues = [
  { ...base, id: 'atrium', name: 'Atrium', venueType: 'nyu_room', capacity: 80, leadTimeDays: 14, costNotes: 'Free for clubs', fit },
  { ...base, id: 'back', name: 'Back room', venueType: 'outside', capacity: 20, leadTimeDays: 0, costNotes: '$200 minimum', fit },
  { ...base, id: 'loft', name: 'Loft', venueType: 'outside', capacity: 60, leadTimeDays: 0,
    fit: { ...fit, conflicts: [{ id: 'mixer', title: 'Mixer', startsAt: '', endsAt: '', timezone: 'UTC' }] } },
]

let host: HTMLDivElement
let root: Root
let client: QueryClient
let router: ReturnType<typeof createMemoryRouter>

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

async function mount(path: string, role = 'organizer') {
  router = createMemoryRouter(
    [{
      path: '/app/w/workspace',
      element: createElement(Outlet, { context: { id: 'workspace', role } }),
      children: [
        { path: 'venues', element: createElement(VenueListPage) },
        { path: 'venues/compare', element: createElement(VenueComparePage) },
      ],
    }],
    { initialEntries: [path] },
  )
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}

const mobileList = () => host.querySelector('.app-stack-mobile')!
const cardNames = () => [...mobileList().querySelectorAll('.app-venue-card-head a')].map((link) => link.textContent)

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.values(api).forEach((fn) => fn.mockReset())
  api.compareVenues.mockResolvedValue(venues)
  api.getEvent.mockResolvedValue({ id: 'dinner', title: 'Founder dinner', startsAt: '2026-11-15T23:00:00Z', endsAt: '2026-11-16T02:00:00Z', timezone: 'America/New_York', archivedAt: null })
  api.getEventVenue.mockResolvedValue({ venueId: null, venueName: null, version: 7 })
  api.setEventVenue.mockResolvedValue({ venueId: 'atrium', version: 8 })
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
})

describe('venue list', () => {
  it('filters by minimum capacity from the URL', async () => {
    await mount('/app/w/workspace/venues?min=50')
    expect(api.compareVenues).toHaveBeenCalledWith('workspace', false, null)
    expect(cardNames()).toEqual(['Atrium', 'Loft'])
  })

  it('offers comparison only once two venues are selected, carrying the selection in the link', async () => {
    await mount('/app/w/workspace/venues')
    const box = (name: string) => mobileList().querySelector<HTMLInputElement>(`input[aria-label="Compare ${name}"]`)!
    await act(async () => box('Atrium').click())
    expect(host.textContent).not.toContain('Compare 1 venues')
    await act(async () => box('Loft').click())
    const link = [...host.querySelectorAll('a')].find((el) => el.textContent === 'Compare 2 venues')!
    expect(link.getAttribute('href')).toBe('/app/w/workspace/venues/compare?ids=atrium,loft')
  })

  it('ranks venues for an event, keeps unsuitable ones with reasons, and links the chosen venue', async () => {
    await mount('/app/w/workspace/venues?event=dinner')
    expect(api.compareVenues).toHaveBeenCalledWith('workspace', false, 'dinner')
    expect(host.querySelector('h1')?.textContent).toBe('Find a venue')
    await type(host.querySelector<HTMLInputElement>('input[placeholder="e.g. 40"]')!, '40')
    expect(cardNames()).toEqual(['Atrium', 'Back room', 'Loft'])
    const cards = [...mobileList().querySelectorAll('.app-venue-card')]
    expect(cards[0].textContent).toContain('Suitable')
    expect(cards[0].textContent).toContain('Request by Nov 1, 2026')
    expect(cards[1].textContent).toContain('Too small: holds 20, need 40')
    expect(cards[2].textContent).toContain('Also linked to Mixer at the same time')
    await act(async () => cards[0].querySelector<HTMLButtonElement>('button[aria-label="Use Atrium for this event"]')!.click())
    await flush()
    expect(api.setEventVenue).toHaveBeenCalledWith('workspace', 'dinner', 'atrium', 7)
  })

  it('does not offer linking to members', async () => {
    await mount('/app/w/workspace/venues?event=dinner', 'member')
    expect(host.querySelector('button[aria-label^="Use "]')).toBeNull()
    expect(cardNames()).toHaveLength(3)
  })
})

describe('venue comparison', () => {
  it('aligns the chosen venues detail by detail', async () => {
    await mount('/app/w/workspace/venues/compare?ids=atrium,back')
    expect(api.compareVenues).toHaveBeenCalledWith('workspace', true, null)
    const table = host.querySelector('.app-venue-compare table')!
    expect([...table.querySelectorAll('thead th a')].map((el) => el.textContent)).toEqual(['Atrium', 'Back room'])
    const cost = [...table.querySelectorAll('tbody tr')].find((row) => row.querySelector('th')?.textContent === 'Cost')!
    expect([...cost.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['Free for clubs', '$200 minimum'])
  })

  it('adds the event fit row when comparing for an event', async () => {
    await mount('/app/w/workspace/venues/compare?ids=atrium,back&event=dinner&people=40')
    const table = host.querySelector('.app-venue-compare table')!
    const first = table.querySelector('tbody tr')!
    expect(first.querySelector('th')?.textContent).toBe('For this event')
    expect(first.textContent).toContain('Too small: holds 20, need 40')
    expect(host.textContent).toContain('Earliest: Nov 1, 2026')
  })

  it('asks for at least two venues', async () => {
    await mount('/app/w/workspace/venues/compare?ids=atrium')
    expect(host.textContent).toContain('Choose at least two venues')
  })
})
