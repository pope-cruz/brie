// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportPage } from '../../src/app/features/attendance/ImportPage'

const api = vi.hoisted(() => ({
  prepareAttendanceImport: vi.fn(),
  prepareMixedAttendanceImport: vi.fn(),
  getImportPreview: vi.fn(),
  commitAttendanceImport: vi.fn(),
  lookupImportReceipt: vi.fn(),
}))
vi.mock('../../src/app/data/api', () => api)

const workspace = { id: 'workspace', role: 'organizer', membershipId: 'm', name: 'Test', timezone: 'UTC', version: 1 }
const event = { id: 'event', title: 'Luma night' }

let host: HTMLDivElement
let root: Root
let router: ReturnType<typeof createMemoryRouter>

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

async function mount() {
  router = createMemoryRouter(
    [
      {
        path: '/',
        element: createElement(Outlet, { context: { workspace, event } }),
        children: [{ index: true, element: createElement(ImportPage) }],
      },
      { path: '*', element: createElement('p', null, 'Receipt') },
    ],
    { initialEntries: ['/'] },
  )
  await act(async () => root.render(createElement(RouterProvider, { router })))
  await flush()
}

async function upload(name: string, text: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
  const file = new File([text], name, { type: 'text/csv' })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}

function fixture(name: string) {
  return readFileSync(resolve('tests/fixtures', name), 'utf8')
}

function field(label: string) {
  const id = [...host.querySelectorAll('label')].find((el) => el.textContent === label)!.htmlFor
  return host.querySelector<HTMLSelectElement>(`[id="${id}"]`)!
}

function byAria(label: string) {
  return host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!
}

async function choose(element: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function click(text: string | RegExp) {
  const match = (el: Element) => (typeof text === 'string' ? el.textContent === text : text.test(el.textContent ?? ''))
  const button = [...host.querySelectorAll('button')].find(match)!
  await act(async () => button.click())
  await flush()
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.values(api).forEach((fn) => fn.mockReset())
  api.getImportPreview.mockResolvedValue(null)
  host = document.createElement('div')
  host.className = 'brie-app'
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  router?.dispose()
  host.remove()
})

const lumaPreview = {
  id: 'preview',
  eventId: 'event',
  expiresAt: '2026-10-01T00:00:00Z',
  attendanceVersion: 1,
  fileLabel: 'mixed-attendance-luma.csv',
  fileHash: 'hash',
  existingReceiptId: null,
  statusMap: { rsvp: null, attendance: { values: {}, otherNonBlank: 'attended' } },
  counts: { newAttendance: 3, alreadyRecorded: 0, duplicates: 1, invalid: 0, blank: 0, accepted: 3, notCounted: 3, unresolved: 1 },
  rows: [
    { rowNumber: 2, name: 'Mira Okonkwo', email: 'mira.okonkwo@example.test', outcome: 'new', group: 'will-count', rsvp: 'yes', attendance: 'attended', reason: 'New attendance for this event.' },
    { rowNumber: 3, name: 'Jules Navarro', email: 'jules.navarro@example.test', outcome: 'not_counted', group: 'wont-count', rsvp: 'yes', attendance: 'unknown', reason: 'RSVP yes, but attendance is unknown.' },
    { rowNumber: 7, name: 'Mira Okonkwo', email: 'mira.okonkwo@example.test', outcome: 'duplicate', group: 'duplicate', rsvp: 'yes', attendance: 'attended', reason: 'This email already appears earlier in the file.' },
    { rowNumber: 9, name: 'Sasha Quinn', email: '', outcome: 'unresolved', group: 'needs-review', rsvp: 'yes', attendance: 'attended', phone: '+12125550188', reason: 'No email. This row is not matched to anyone by name or phone.' },
  ],
}

describe('import mapping', () => {
  it('sends a Luma export through the mixed import with the organizer’s explicit map', async () => {
    api.prepareMixedAttendanceImport.mockResolvedValue(lumaPreview)
    await mount()
    expect(host.textContent).not.toContain('counts every valid row')
    await upload('mixed-attendance-luma.csv', fixture('mixed-attendance-luma.csv'))
    expect(field('Attendance').value).toBe('4')
    expect(field('RSVP').value).toBe('3')
    expect(host.textContent).toContain('No value is marked Attended yet')
    expect(host.textContent).toContain('0 counted as attended')

    await choose(byAria('What each attendance value means: any value'), 'attended')
    expect(host.textContent).toContain('3 counted as attended')
    await click('Review')

    const input = api.prepareMixedAttendanceImport.mock.calls[0][0]
    expect(input.statusMap).toEqual({
      rsvp: { values: { approved: 'yes', declined: 'no' }, otherNonBlank: null },
      attendance: { values: {}, otherNonBlank: 'attended' },
    })
    expect(input.rows[7]).toEqual({
      rowNumber: 9,
      email: '',
      name: 'Sasha Quinn',
      rsvp: 'approved',
      attendance: '2026-09-12 18:30:00',
      timestamp: '2026-09-06 10:05:00',
      phone: '+12125550188',
    })
    expect(api.prepareAttendanceImport).not.toHaveBeenCalled()
  })

  it('keeps a plain name and email list on the original import', async () => {
    api.prepareAttendanceImport.mockResolvedValue({ ...lumaPreview, statusMap: null, rows: [] })
    await mount()
    await upload('attendance.csv', 'name,email\nAna,ana@example.test\n')
    expect(field('Attendance').value).toBe('all')
    expect(host.textContent).not.toContain('RSVP')
    await click('Review')
    expect(api.prepareAttendanceImport).toHaveBeenCalledTimes(1)
    expect(api.prepareMixedAttendanceImport).not.toHaveBeenCalled()
  })

  it('makes the organizer decide when a file has an RSVP column but no attendance column', async () => {
    await mount()
    await upload('rsvps.csv', 'email,rsvp\nana@example.test,yes\n')
    expect(field('Attendance').value).toBe('')
    await click('Review')
    expect(host.textContent).toContain('Choose the attendance column, or confirm that everyone in this file attended.')
    expect(api.prepareAttendanceImport).not.toHaveBeenCalled()
    expect(api.prepareMixedAttendanceImport).not.toHaveBeenCalled()
  })
})

describe('import review groups', () => {
  it('groups rows and requires skipping rows that can’t be matched before recording', async () => {
    api.prepareMixedAttendanceImport.mockResolvedValue(lumaPreview)
    api.commitAttendanceImport.mockResolvedValue({ id: 'batch' })
    await mount()
    await upload('mixed-attendance-luma.csv', fixture('mixed-attendance-luma.csv'))
    await choose(byAria('What each attendance value means: any value'), 'attended')
    await click('Review')

    const headings = [...host.querySelectorAll('h3')].map((el) => el.textContent)
    expect(headings).toEqual(['Will count as attended 1', 'Won’t count 1', 'Can’t be matched 1', 'Duplicates 1'])
    expect(host.textContent).toContain('3 will count · 1 won’t count · 1 can’t be matched · 1 duplicates')
    expect(host.textContent).toContain('+12125550188')

    await click('Record attendance for 3 people')
    expect(api.commitAttendanceImport).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Acknowledge the rows that will be skipped')

    const skip = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(skip.parentElement?.textContent).toContain('Skip 1 row that can’t be matched')
    await act(async () => skip.click())
    await click('Record attendance for 3 people')
    expect(api.commitAttendanceImport).toHaveBeenCalledWith('preview', true, expect.any(String))
  })
})

describe('repeat import review', () => {
  it('lists differences from what is recorded without offering to apply them', async () => {
    api.prepareMixedAttendanceImport.mockResolvedValue({
      ...lumaPreview,
      existingReceiptId: 'batch',
      counts: { ...lumaPreview.counts, newAttendance: 0, alreadyRecorded: 3 },
      rows: [
        { ...lumaPreview.rows[0], outcome: 'already_recorded', changes: [{ field: 'name', from: 'Mira Okonkwo', to: 'Mira O.' }] },
        { ...lumaPreview.rows[1], outcome: 'not_counted', attendance: 'no_show', recordedAttended: true, changes: [{ field: 'attendance', from: 'attended', to: 'no_show' }] },
      ],
    })
    await mount()
    await upload('mixed-attendance-luma.csv', fixture('mixed-attendance-luma.csv'))
    await choose(byAria('What each attendance value means: any value'), 'attended')
    await click('Review')
    expect(host.textContent).toContain('0 new · 3 already recorded at this event')
    expect(host.textContent).toContain('Recording it again adds no attendance')
    expect(host.textContent).toContain('Differences from what’s recorded')
    expect(host.textContent).toContain('Name in file “Mira O.”, stored as “Mira Okonkwo”. The stored name is kept.')
    expect(host.textContent).toContain('This file says no-show, but an earlier import recorded this person as attended.')
    expect([...host.querySelectorAll('button')].map((el) => el.textContent)).not.toContain('Apply')
  })
})

describe('keeping original rows', () => {
  it('sends every cell and the original headers only when the organizer opts in', async () => {
    api.prepareMixedAttendanceImport.mockResolvedValue(lumaPreview)
    await mount()
    await upload('mixed-attendance-luma.csv', fixture('mixed-attendance-luma.csv'))
    await choose(byAria('What each attendance value means: any value'), 'attended')
    const keep = [...host.querySelectorAll('label')].find((el) => el.textContent?.startsWith('Keep the original rows'))!
      .querySelector('input')!
    expect(keep.checked).toBe(false)
    await click('Review')
    const plain = api.prepareMixedAttendanceImport.mock.calls[0][0]
    expect(plain.mapping.keepSource).toBeUndefined()
    expect(plain.mapping.headers).toBeUndefined()
    expect(plain.rows[0].values).toBeUndefined()

    await click('Back')
    const keepAgain = [...host.querySelectorAll('label')].find((el) => el.textContent?.startsWith('Keep the original rows'))!
      .querySelector('input')!
    await act(async () => keepAgain.click())
    await click('Review')
    const kept = api.prepareMixedAttendanceImport.mock.calls[1][0]
    expect(kept.mapping.keepSource).toBe(true)
    expect(kept.mapping.headers).toEqual(['name', 'email', 'phone_number', 'approval_status', 'checked_in_at', 'created_at'])
    expect(kept.rows[7].values).toEqual(['Sasha Quinn', '', '+12125550188', 'approved', '2026-09-12 18:30:00', '2026-09-06 10:05:00'])
  })
})
