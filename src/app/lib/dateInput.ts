/**
 * Typed due dates. `today` is YYYY-MM-DD in the event's zone.
 * Accepts "", "today", "tomorrow"/"tmrw", weekday names ("fri", "friday", the next one on or
 * after today), "10/17", "10/17/26", "10/17/2026", "Oct 17", "17 Oct", and "2026-10-17".
 * A date without a year picks the year that puts it closest to today.
 * Returns '' for no date, the ISO date, or null when the text can't be read.
 */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function iso(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000)
}

function nearestYear(month: number, day: number, today: string) {
  const year = Number(today.slice(0, 4))
  const candidates = [year - 1, year, year + 1].map((y) => iso(y, month, day)).filter((value): value is string => Boolean(value))
  if (candidates.length === 0) return null
  return candidates.reduce((best, value) => (Math.abs(daysBetween(today, value)) < Math.abs(daysBetween(today, best)) ? value : best))
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function monthIndex(word: string) {
  if (word.length < 3) return null
  const index = MONTH_NAMES.findIndex((name) => name.startsWith(word))
  return index >= 0 ? index + 1 : null
}

export function parseDateInput(text: string, today: string): string | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/,/g, '')
  if (!value) return ''
  if (value === 'today') return today
  if (value === 'tomorrow' || value === 'tmrw' || value === 'tmr') return addDays(today, 1)

  // "Mon Oct 19" (how dates are shown): the weekday is decoration, read the rest.
  const leading = value.match(/^([a-z]+) (.+)$/)
  if (leading && leading[1].length >= 3 && WEEKDAYS.some((name) => name.startsWith(leading[1]))) return parseDateInput(leading[2], today)

  const weekday = value.length >= 3 ? WEEKDAYS.findIndex((name) => name.startsWith(value)) : -1
  if (weekday >= 0) {
    const current = new Date(`${today}T12:00:00Z`).getUTCDay()
    return addDays(today, (weekday - current + 7) % 7)
  }

  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]))

  match = value.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/)
  if (match) {
    const month = Number(match[1])
    const day = Number(match[2])
    if (!match[3]) return nearestYear(month, day, today)
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    return iso(year, month, day)
  }

  match = value.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/) ?? value.match(/^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/)
  if (match) {
    const [word, dayText] = /^\d/.test(match[1]) ? [match[2], match[1]] : [match[1], match[2]]
    const month = monthIndex(word)
    if (!month) return null
    return match[3] ? iso(Number(match[3]), month, Number(dayText)) : nearestYear(month, Number(dayText), today)
  }
  return null
}

/** "Fri, Oct 17", with the year only when it isn't this year. */
export function formatDueDate(date: string, today: string) {
  const sameYear = date.slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric',
  }).format(new Date(`${date}T12:00:00Z`))
}
