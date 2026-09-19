import Papa from 'papaparse'
import type { EventRecord, SegmentRecord } from '../data/types'
import { clockToMinutes, minutesToClock, parseDurationInput, parseTimeInput } from './timeInput'
import { addMs, resolveLocalDateTime, splitInZone } from './timezone'

type Member = { id: string; displayName: string }
export type PasteRow = {
  rowNumber: number
  time: string
  title: string
  peopleText: string
  instructions: string
  personIds: string[]
  startsAt: string | null
  endsAt: string | null
  errors: string[]
  warnings: string[]
}

/** Preview tab/CSV schedule rows before a single atomic save. */
export function parseSchedulePaste(text: string, event: Pick<EventRecord, 'startsAt' | 'endsAt' | 'timezone'>,
  members: Member[], existing: Pick<SegmentRecord, 'startsAt' | 'endsAt'>[]): { rows: PasteRow[]; error: string | null } {
  if (!text.trim()) return { rows: [], error: null }
  const parsed = Papa.parse<string[]>(text, { delimiter: text.includes('\t') ? '\t' : ',', skipEmptyLines: 'greedy' })
  if (parsed.errors.length) return { rows: [], error: 'Check the pasted rows and quotation marks.' }
  const records = parsed.data.filter((columns) => columns.some((value) => value.trim()))
  if (records.length > 200) return { rows: [], error: 'Paste at most 200 rows at once.' }
  const first = records[0]?.map((value) => value.trim().toLowerCase()) ?? []
  const offset = first[0] === 'time' && first[1] === 'title' ? 1 : 0
  const reference = clockToMinutes(splitInZone(event.startsAt, event.timezone).time)
  const defaultDate = splitInZone(event.startsAt, event.timezone).date
  const rows: PasteRow[] = []
  for (let index = offset; index < records.length; index += 1) {
    const columns = records[index]
    const [time = '', title = '', peopleText = '', instructions = ''] = columns.map((value) => value.trim())
    const errors: string[] = []
    const warnings: string[] = []
    if (columns.length > 4) errors.push('Use four columns: time, title, people, notes.')
    if (!title || title.length > 120) errors.push('Enter a title up to 120 characters.')
    if (instructions.length > 4000) errors.push('Notes must be 4,000 characters or fewer.')
    let personIds: string[] = []
    if (peopleText && peopleText.toLowerCase() !== 'everyone') {
      for (const name of peopleText.split(/\s*[;&]\s*/).filter(Boolean)) {
        const found = members.filter((member) => member.displayName.trim().toLowerCase() === name.trim().toLowerCase())
        if (found.length !== 1) errors.push(`Unmatched person: ${name}.`)
        else if (!personIds.includes(found[0].id)) personIds = [...personIds, found[0].id]
      }
    }
    const dateMatch = time.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/)
    const day = dateMatch?.[1] ?? defaultDate
    const timeAndLength = dateMatch?.[2] ?? time
    const [startText, lengthText] = timeAndLength.split(/\s+\+\s+/, 2)
    const startMinutes = parseTimeInput(startText, reference)
    const lengthMinutes = lengthText ? parseDurationInput(lengthText) : 30
    if (startMinutes === null) errors.push('Enter a start time like 6:30p.')
    if (lengthMinutes === null) errors.push('Enter a length like 45m after +, or omit it for 30 minutes.')
    const resolved = startMinutes === null ? null : resolveLocalDateTime(day, minutesToClock(startMinutes), event.timezone)
    if (resolved && !resolved.ok) errors.push(resolved.reason === 'ambiguous' ? 'Choose an unambiguous time for the clock change.' : 'This local time does not exist.')
    const startsAt = resolved?.ok ? resolved.iso : null
    const endsAt = startsAt && lengthMinutes ? addMs(startsAt, lengthMinutes * 60_000) : null
    if (startsAt && endsAt) {
      if (Date.parse(startsAt) < Date.parse(event.startsAt) || Date.parse(endsAt) > Date.parse(event.endsAt)) warnings.push('Outside event hours')
      if ([...existing, ...rows.filter((row) => row.startsAt && row.endsAt).map((row) => ({ startsAt: row.startsAt!, endsAt: row.endsAt! }))]
        .some((item) => Date.parse(item.startsAt) < Date.parse(endsAt) && Date.parse(item.endsAt) > Date.parse(startsAt))) warnings.push('Overlaps another item')
    }
    rows.push({ rowNumber: index + 1, time, title, peopleText, instructions, personIds, startsAt, endsAt, errors, warnings })
  }
  return { rows, error: null }
}
