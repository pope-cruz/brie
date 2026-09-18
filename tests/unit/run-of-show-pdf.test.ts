import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { describe, expect, it } from 'vitest'
import { buildRunOfShowDoc, pdfFileName, type RunOfShowPdfInput } from '../../src/app/lib/runOfShowPdf'
import { filterSchedule } from '../../src/app/lib/scheduleView'

const require = createRequire(import.meta.url)
const fonts = join(dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto')
const pdfmake = require('pdfmake') as {
  addFonts: (fonts: Record<string, Record<string, string>>) => void
  setLocalAccessPolicy: (callback: (path: string) => boolean) => void
  setUrlAccessPolicy: (callback: (url: string) => boolean) => void
  createPdf: (doc: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> }
}
pdfmake.addFonts({ Roboto: {
  normal: join(fonts, 'Roboto-Regular.ttf'), bold: join(fonts, 'Roboto-Medium.ttf'),
  italics: join(fonts, 'Roboto-Italic.ttf'), bolditalics: join(fonts, 'Roboto-MediumItalic.ttf'),
} })
pdfmake.setLocalAccessPolicy((path) => path.startsWith(fonts))
pdfmake.setUrlAccessPolicy(() => false)

// 6–10 PM EDT on Tuesday, Oct 20.
const event = {
  title: 'Welcome night', startsAt: '2026-10-20T22:00:00Z', endsAt: '2026-10-21T02:00:00Z', timezone: 'America/New_York',
  location: 'East lobby', teamBriefing: 'Volunteer call is 4:45 PM.\nPick up a badge.',
}
const members = [{ id: 'me', displayName: 'Sam' }, { id: 'ana', displayName: 'Ana' }]
function item(index: number, overrides: Record<string, unknown> = {}) {
  const start = new Date(Date.parse(event.startsAt) + index * 15 * 60_000)
  return {
    id: `s${index}`, workspaceId: 'w', eventId: 'e', title: `Item ${index}`, startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 15 * 60_000).toISOString(), ownerMembershipId: null, ownerName: null, ownerFormer: false,
    instructions: '', removedAt: null, version: 1, overlaps: false, outOfRange: false, ...overrides,
  }
}
const input = (overrides: Partial<RunOfShowPdfInput> = {}): RunOfShowPdfInput => ({
  event, items: [], members, whoLabel: 'Everyone', showDates: false, generatedAt: new Date('2026-10-18T20:05:00Z'), ...overrides,
})
const texts = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(texts)
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => (['text', 'stack', 'columns', 'content'].includes(key) || typeof key === 'number' ? texts(child) : []))
  return []
}

/** Lays out the document and records which pages each schedule item landed on. */
async function render(doc: TDocumentDefinitions) {
  const pages = new Map<string, number[]>()
  doc.pageBreakBefore = (node) => {
    if (node.id?.startsWith('item-')) pages.set(node.id, node.pageNumbers)
    return false
  }
  const buffer = await pdfmake.createPdf(doc).getBuffer()
  return { buffer, pages }
}

describe('buildRunOfShowDoc', () => {
  it('has the event facts, briefing, and the same items the list shows for that filter', () => {
    const items = [item(0), item(1, { ownerMembershipId: 'me', ownerName: 'Sam', instructions: 'Bring the sign-in sheet.\nGreet people.' }), item(2, { ownerMembershipId: 'ana', ownerName: 'Ana' })]
    const doc = buildRunOfShowDoc(input({ items: filterSchedule(items, 'mine', 'me'), whoLabel: 'Mine: Sam' }))
    const all = texts(doc.content).join('\n')
    expect(all).toContain('Run of show · Mine: Sam')
    expect(all).toContain('Tuesday, October 20, 2026 · 6:00 PM–10:00 PM')
    expect(all).toContain('East lobby')
    expect(all).toContain('America/New_York · Eastern Daylight Time')
    expect(all).toContain('Volunteer call is 4:45 PM.\nPick up a badge.')
    expect(all).toContain('6 PM – 6:15 PM')
    expect(all).toContain('Item 0')
    expect(all).toContain('Bring the sign-in sheet.\nGreet people.')
    expect(all).not.toContain('Item 2')
  })

  it('puts the title, filter, page count, and time generated in every footer', () => {
    const doc = buildRunOfShowDoc(input({ whoLabel: 'Mine: Sam' }))
    const footer = (doc.footer as (page: number, pages: number) => { text: string })(2, 3)
    expect(footer.text).toBe('Welcome night · Mine: Sam · page 2 of 3 · generated Oct 18, 4:05 PM EDT')
  })

  it('says when a person has nothing on the schedule', () => {
    expect(texts(buildRunOfShowDoc(input({ whoLabel: 'Ana' })).content)).toContain('Nothing on the schedule for Ana.')
  })

  it('names the file after the event and the filter', () => {
    expect(pdfFileName('Welcome night', 'Everyone')).toBe('welcome-night-run-of-show-everyone.pdf')
    expect(pdfFileName('Café Night!', 'Mine: José')).toBe('cafe-night-run-of-show-jose.pdf')
  })
})

describe('generated PDF', () => {
  it('spans several pages without splitting any item', async () => {
    const notes = 'Cue the lights. Check the microphone and the captions. '.repeat(12)
    const items = Array.from({ length: 40 }, (_, index) => item(index, { instructions: index % 3 === 0 ? notes : 'Short note.' }))
    const { buffer, pages } = await render(buildRunOfShowDoc(input({ items })))
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    const pageCount = (buffer.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length
    expect(pageCount).toBeGreaterThan(2)
    expect(pages.size).toBe(40)
    for (const [id, numbers] of pages) expect({ id, pages: numbers.length }).toEqual({ id, pages: 1 })
  })

  it('renders accented, Greek, and Cyrillic names', async () => {
    const items = [item(0, { title: 'Überraschung für Zoë', ownerMembershipId: 'x', ownerName: 'Αλέξανδρος Дмитрий' })]
    const { buffer } = await render(buildRunOfShowDoc(input({ items })))
    expect(buffer.length).toBeGreaterThan(1000)
  })
})
