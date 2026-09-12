export type LocalTimeResolution =
  | { ok: true; iso: string; offset: string }
  | { ok: false; reason: 'nonexistent' }
  | { ok: false; reason: 'ambiguous'; options: Array<{ iso: string; offset: string }> }

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function utcMilliseconds(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const instant = new Date(0)
  instant.setUTCFullYear(year, month - 1, day)
  instant.setUTCHours(hour, minute, 0, 0)
  const milliseconds = instant.getTime()

  if (
    !Number.isFinite(milliseconds) ||
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day ||
    instant.getUTCHours() !== hour ||
    instant.getUTCMinutes() !== minute
  ) {
    return null
  }

  return milliseconds
}

function tzOffset(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
    hour: '2-digit',
  }).formatToParts(date)
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  if (raw === 'GMT' || raw === 'UTC') return '+00:00'
  const match = raw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
  if (!match) return '+00:00'
  return `${match[1]}${pad(Number(match[2]))}:${match[3] ?? '00'}`
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour') === '24' ? '0' : read('hour')),
    minute: Number(read('minute')),
  }
}

function matchesLocal(
  date: Date,
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): boolean {
  const parts = localParts(date, timeZone)
  return (
    parts.year === year &&
    parts.month === month &&
    parts.day === day &&
    parts.hour === hour &&
    parts.minute === minute
  )
}

export function resolveLocalDateTime(
  date: string,
  time: string,
  timeZone: string,
  preferredOffset?: string,
): LocalTimeResolution {
  const dateMatch = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) {
    return { ok: false, reason: 'nonexistent' }
  }

  const [, yearPart, monthPart, dayPart] = dateMatch
  const [, hourPart, minutePart] = timeMatch
  const year = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)
  const hour = Number(hourPart)
  const minute = Number(minutePart)
  const desired = utcMilliseconds(year, month, day, hour, minute)
  if (desired === null) return { ok: false, reason: 'nonexistent' }

  // Sample nearby offsets, then round-trip each candidate. DST shifts are not
  // always an hour (Lord Howe changes by 30 minutes).
  const offsets = new Set<string>()
  try {
    for (let hours = -48; hours <= 48; hours += 6) {
      offsets.add(tzOffset(new Date(desired + hours * 3_600_000), timeZone))
    }
  } catch { return { ok: false, reason: 'nonexistent' } }
  const options = [...offsets].flatMap((offset) => {
    const sign = offset[0] === '-' ? -1 : 1
    const minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)))
    const instant = new Date(desired - minutes * 60_000)
    return matchesLocal(instant, timeZone, year, month, day, hour, minute)
      ? [{ offset, iso: instant.toISOString() }] : []
  }).sort((a, b) => a.iso.localeCompare(b.iso))

  if (options.length === 0) return { ok: false, reason: 'nonexistent' }
  if (options.length === 1) return { ok: true, iso: options[0].iso, offset: options[0].offset }
  if (preferredOffset) {
    const chosen = options.find((option) => option.offset === preferredOffset)
    if (chosen) return { ok: true, iso: chosen.iso, offset: chosen.offset }
  }
  return { ok: false, reason: 'ambiguous', options }
}

export function formatInZone(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options,
  }).format(new Date(iso))
}

export function formatTimeRange(startsAt: string, endsAt: string, timeZone: string): string {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  const startDate = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(start)
  const endDate = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(end)
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  })
  const zoneFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  })
  const startZone = zoneFmt.formatToParts(start).find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  const endZone = zoneFmt.formatToParts(end).find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  if (startZone !== endZone || tzOffset(start, timeZone) !== tzOffset(end, timeZone)) {
    return `${startDate}, ${timeFmt.format(start)} ${startZone} (UTC${tzOffset(start, timeZone)}) – ${endDate}, ${timeFmt.format(end)} ${endZone} (UTC${tzOffset(end, timeZone)})`
  }
  if (eventLocalDate(startsAt, timeZone) === eventLocalDate(endsAt, timeZone)) {
    return `${startDate}, ${timeFmt.format(start)}–${timeFmt.format(end)} ${startZone}`
  }
  return `${startDate}, ${timeFmt.format(start)} – ${endDate}, ${timeFmt.format(end)} ${startZone}`
}

export function eventLocalDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}-${read('day')}`
}

export function todayInZone(timeZone: string): string {
  return eventLocalDate(new Date().toISOString(), timeZone)
}

export function splitInZone(iso: string, timeZone: string): { date: string; time: string; offset: string } {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(date)
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const hour = read('hour') === '24' ? '00' : read('hour')
  const rawOffset = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = rawOffset.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
  const offset = match ? `${match[1]}${String(Number(match[2])).padStart(2, '0')}:${match[3] ?? '00'}` : '+00:00'
  return { date: `${read('year')}-${read('month')}-${read('day')}`, time: `${hour}:${read('minute')}`, offset }
}

export function listTimeZones(): string[] {
  if ('supportedValuesOf' in Intl) {
    return [...new Set(['UTC', defaultTimeZone(), ...Intl.supportedValuesOf('timeZone')])].sort()
  }
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Toronto',
    'Europe/London',
    'Europe/Paris',
    'Asia/Tokyo',
  ]
}

export function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function elapsedMs(fromIso: string, toIso: string): number {
  return new Date(toIso).getTime() - new Date(fromIso).getTime()
}

export function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString()
}

export function timeZoneLabel(timeZone: string, at: string = new Date().toISOString()): string {
  const city = timeZone.split('/').slice(1).join(' / ').replaceAll('_', ' ') || timeZone
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' })
    .formatToParts(new Date(at)).find((part) => part.type === 'timeZoneName')?.value ?? timeZone
  return `${city} · ${name}`
}
