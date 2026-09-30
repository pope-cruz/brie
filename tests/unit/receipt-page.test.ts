// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiptPage } from '../../src/app/features/attendance/ReceiptPage'

const api = vi.hoisted(() => ({
  getImportReceipt: vi.fn(),
  getImportSource: vi.fn(),
  deleteImportSource: vi.fn(),
  previewRevertImport: vi.fn(),
  revertAttendanceImport: vi.fn(),
}))
vi.mock('../../src/app/data/api', () => api)

const receipt = {
  id: 'batch',
  eventId: 'event',
  fileLabel: 'luma-guests.csv',
  committedAt: '2026-09-30T12:00:00Z',
  importedBy: 'Organizer',
  added: 3,
  alreadyRecorded: 0,
  skipped: 5,
  status: 'active',
  revertedAt: null,
  sourceRowCount: 8,
  sourceDeleteAfter: '2027-03-29T12:00:00Z',
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

async function mount() {
  router = createMemoryRouter(
    [
      {
        path: '/imports/:batchId',
        element: createElement(Outlet, { context: { workspace: { id: 'workspace', role: 'organizer' }, event: { id: 'event' } } }),
        children: [{ index: true, element: createElement(ReceiptPage) }],
      },
    ],
    { initialEntries: ['/imports/batch'] },
  )
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }))))
  await flush()
}

function button(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll('button')].find((el) => el.textContent === text)
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.values(api).forEach((fn) => fn.mockReset())
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

describe('kept original rows on the receipt', () => {
  it('downloads the kept rows as CSV', async () => {
    api.getImportReceipt.mockResolvedValue(receipt)
    api.getImportSource.mockResolvedValue({ headers: ['name', 'email'], rows: [['Mira', 'mira@example.test']], deleteAfter: receipt.sourceDeleteAfter })
    const created: Blob[] = []
    vi.stubGlobal('URL', { ...URL, createObjectURL: (blob: Blob) => { created.push(blob); return 'blob:kept' }, revokeObjectURL: () => undefined })
    await mount()
    expect(host.textContent).toContain('8 original rows kept until')
    await act(async () => button('Download original rows')!.click())
    await flush()
    expect(api.getImportSource).toHaveBeenCalledWith('workspace', 'batch')
    expect(await created[0].text()).toContain('"Mira","mira@example.test"')
  })

  it('deletes the kept rows after confirmation', async () => {
    api.getImportReceipt.mockResolvedValue(receipt)
    api.deleteImportSource.mockResolvedValue({ ...receipt, sourceRowCount: null, sourceDeleteAfter: null })
    await mount()
    await act(async () => button('Delete original rows')!.click())
    await flush()
    expect(document.body.textContent).toContain('Attendance and this receipt don’t change.')
    api.getImportReceipt.mockResolvedValue({ ...receipt, sourceRowCount: null, sourceDeleteAfter: null })
    const dialog = document.querySelector('[role="dialog"]')!
    await act(async () => button('Delete original rows', dialog)!.click())
    await flush()
    expect(api.deleteImportSource).toHaveBeenCalledWith('workspace', 'batch')
    expect(host.textContent).not.toContain('original rows kept')
  })

  it('shows nothing about original rows when none are kept', async () => {
    api.getImportReceipt.mockResolvedValue({ ...receipt, sourceRowCount: null, sourceDeleteAfter: null })
    await mount()
    expect(button('Download original rows')).toBeUndefined()
  })
})
