// Loose, typed time and duration entry for schedule rows: "6:30p", "18:30",
// "45m", "1h30". Minutes-of-day values are local to the event's zone.

const DAY = 24 * 60

function circularDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % DAY
  return Math.min(diff, DAY - diff)
}

/**
 * Parses a clock time into minutes after midnight. A bare hour from 1–12
 * ("6", "6:30") picks AM or PM by whichever is closer to `referenceMinutes`,
 * so "6" after a 5:30 PM item means 6 PM. Ties go to PM.
 */
export function parseTimeInput(text: string, referenceMinutes = 12 * 60): number | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, '').replaceAll('.', '')
  if (!value) return null
  if (value === 'noon') return 12 * 60
  if (value === 'midnight') return 0
  const match = /^(\d{1,2}):?(\d{2})?(am|pm|a|p)?$/.exec(value)
  if (!match) return null
  const [, hourText, minuteText = '00', suffix] = match
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (minute > 59) return null
  if (suffix) {
    if (hour < 1 || hour > 12) return null
    return ((hour % 12) + (suffix.startsWith('p') ? 12 : 0)) * 60 + minute
  }
  if (hour > 23) return null
  // "0:30", "06:00", and "13:00" are unambiguous 24-hour times.
  if (hour === 0 || hour > 12 || hourText.startsWith('0')) return hour * 60 + minute
  const morning = (hour % 12) * 60 + minute
  const evening = morning + 12 * 60
  return circularDistance(morning, referenceMinutes) < circularDistance(evening, referenceMinutes) ? morning : evening
}

/** Parses a length: "30" and "30m" are minutes; "1h", "1h30", "1:30", and "1.5h" are hours. */
export function parseDurationInput(text: string): number | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!value) return null
  let minutes: number | null = null
  let match: RegExpExecArray | null
  if ((match = /^(\d+)(m|min|mins|minute|minutes)?$/.exec(value))) minutes = Number(match[1])
  else if ((match = /^(\d+):(\d{2})$/.exec(value))) minutes = Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null
  else if ((match = /^(\d+(?:\.\d+)?)(h|hr|hrs|hour|hours)$/.exec(value))) minutes = Math.round(Number(match[1]) * 60)
  else if ((match = /^(\d+)(?:h|hr|hrs|hour|hours)(\d+)(m|min|mins|minute|minutes)?$/.exec(value))) {
    minutes = Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null
  } else if ((match = /^(\d+\.\d+)$/.exec(value))) minutes = Math.round(Number(match[1]) * 60)
  if (minutes === null || minutes <= 0 || minutes > 2 * DAY) return null
  return minutes
}

/** 18:30 → "6:30 PM"; 18:00 → "6 PM". */
export function formatClock(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24
  const minute = minutes % 60
  const suffix = hour < 12 ? 'AM' : 'PM'
  const clock = hour % 12 || 12
  return minute ? `${clock}:${String(minute).padStart(2, '0')} ${suffix}` : `${clock} ${suffix}`
}

/** 90 → "1 hr 30 min". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} min`
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

/** "18:30" → 1110. */
export function clockToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

/** 1110 → "18:30". */
export function minutesToClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
