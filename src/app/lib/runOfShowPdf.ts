import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { EventRecord, SegmentRecord } from '../data/types'
import { eventDateLabel, eventTimeLabel, ownerLabel, rowTimeLabel } from './scheduleView'
import { timeZoneLabel } from './timezone'

type MemberName = { id: string; displayName: string }

export type RunOfShowPdfInput = {
  event: Pick<EventRecord, 'title' | 'startsAt' | 'endsAt' | 'timezone' | 'location' | 'teamBriefing'>
  /** Already filtered and in time order, exactly as the list shows them. */
  items: SegmentRecord[]
  members: MemberName[]
  /** "Everyone", "Mine: Sam", or a person's name. */
  whoLabel: string
  showDates: boolean
  generatedAt: Date
}

const INK = '#202020'
const MUTED = '#626262'
const RULE = '#d8d8d8'
// An item longer than a page can't stay on one; let only those break.
const UNBREAKABLE_NOTES = 1800

function rule(): Content {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 0.5, lineColor: RULE }] }
}

function generatedLabel(at: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(at)
}

export function buildRunOfShowDoc(input: RunOfShowPdfInput): TDocumentDefinitions {
  const { event, items, members, whoLabel, showDates, generatedAt } = input
  const zone = timeZoneLabel(event.timezone, event.startsAt).split(' · ').at(-1)
  const footerText = (page: number, pages: number) =>
    `${event.title} · ${whoLabel} · page ${page} of ${pages} · generated ${generatedLabel(generatedAt, event.timezone)}`

  const list: Content[] = items.length === 0
    ? [{ text: whoLabel === 'Everyone' ? 'The schedule hasn’t been added yet.' : `Nothing on the schedule for ${whoLabel.replace(/^Mine: /, '')}.`, color: MUTED, margin: [0, 8, 0, 0] }]
    : [
        { columns: [{ width: 120, text: 'Time' }, { width: '*', text: 'Activity' }, { width: 110, text: 'Person' }], columnGap: 12, fontSize: 8, color: MUTED, margin: [0, 0, 0, 4] },
        rule(),
        ...items.map((item) => {
          const time = rowTimeLabel(item, event, showDates)
          const owner = ownerLabel(item, members)
          // `id` works on any node at runtime (tests use it to find each item); the types only allow it on some.
          return {
            id: `item-${item.id}`,
            unbreakable: item.instructions.length <= UNBREAKABLE_NOTES,
            stack: [
              {
                columns: [
                  { width: 120, stack: [...(time.date ? [{ text: time.date, fontSize: 8, color: MUTED }] : []), { text: time.range }] },
                  { width: '*', stack: [{ text: item.title, bold: true }, ...(item.instructions ? [{ text: item.instructions, margin: [0, 2, 0, 0] as [number, number, number, number] }] : [])] },
                  { width: 110, text: owner ?? 'Everyone', italics: !owner, color: owner ? INK : MUTED },
                ],
                columnGap: 12,
                margin: [0, 7, 0, 7],
              },
              rule(),
            ],
          } as Content
        }),
      ]

  return {
    pageSize: 'LETTER',
    pageMargins: [40, 48, 40, 48],
    info: { title: `${event.title} run of show`, subject: whoLabel },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.25, color: INK },
    header: (page) => (page > 1 ? { text: event.title, fontSize: 8, color: MUTED, margin: [40, 24, 40, 0] } : null),
    footer: (page, pages) => ({ text: footerText(page, pages), fontSize: 8, color: MUTED, margin: [40, 16, 40, 0] }),
    content: [
      { text: `Run of show · ${whoLabel}`, fontSize: 9, color: MUTED },
      { text: event.title, fontSize: 20, bold: true, margin: [0, 2, 0, 8] },
      {
        columns: [
          { width: '*', stack: [{ text: 'Date', fontSize: 8, color: MUTED }, `${eventDateLabel(event)} · ${eventTimeLabel(event)}`] },
          { width: '*', stack: [{ text: 'Venue', fontSize: 8, color: MUTED }, event.location || 'Venue not set'] },
          { width: '*', stack: [{ text: 'Timezone', fontSize: 8, color: MUTED }, `${event.timezone} · ${zone}`] },
        ],
        columnGap: 16,
        margin: [0, 0, 0, 14],
      },
      { text: 'Team briefing', bold: true, fontSize: 11, margin: [0, 0, 0, 4] },
      { text: event.teamBriefing || 'No team briefing added.', color: event.teamBriefing ? INK : MUTED, margin: [0, 0, 0, 16] },
      ...list,
    ],
  }
}

export function pdfFileName(eventTitle: string, whoLabel: string) {
  const slug = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${slug(eventTitle) || 'event'}-run-of-show-${slug(whoLabel.replace(/^Mine: /, '')) || 'person'}.pdf`
}

/** Loads the PDF library and its fonts only when someone downloads. Nothing leaves the browser. */
export async function downloadRunOfShowPdf(doc: TDocumentDefinitions, fileName: string) {
  const [pdfModule, vfsModule] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
  const pdfMake = ((pdfModule as { default?: unknown }).default ?? pdfModule) as typeof import('pdfmake/build/pdfmake')
  const vfs = ((vfsModule as { default?: unknown }).default ?? vfsModule) as Record<string, string>
  pdfMake.addVirtualFileSystem(vfs)
  await pdfMake.createPdf(doc).download(fileName)
}
