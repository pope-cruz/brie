import { useState } from 'react'
import { DateTimeField } from './DateTimeField'
import { Checkbox } from './shadcn/checkbox'

function toMinutes(time: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function fromMinutes(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function DateTimeRange({ startDate, endDate, startTime, endTime, timezone, startOffset, endOffset,
  onStartDate, onEndDate, onStartTime, onEndTime, onStartOffset, onEndOffset, startError, endError }: {
  startDate: string; endDate: string; startTime: string; endTime: string; timezone: string
  startOffset?: string; endOffset?: string; startError?: string; endError?: string
  onStartDate: (value: string) => void; onEndDate: (value: string) => void
  onStartTime: (value: string) => void; onEndTime: (value: string) => void
  onStartOffset: (value: string) => void; onEndOffset: (value: string) => void
}) {
  const [sameDay, setSameDay] = useState(!endDate || startDate === endDate)
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  const endsBeforeStart = sameDay && start !== null && end !== null && end <= start
  return <>
    <DateTimeField label="Start" date={startDate} time={startTime} timezone={timezone} offset={startOffset}
      onDate={(value) => {
        onStartDate(value)
        if (sameDay) { onEndDate(value); onEndOffset('') }
      }} onTime={(value) => {
        onStartTime(value)
        // Keep the same duration when the start moves, as long as the end stays on that day.
        const next = toMinutes(value)
        if (sameDay && start !== null && end !== null && next !== null && end > start && next + end - start < 24 * 60) {
          onEndTime(fromMinutes(next + end - start)); onEndOffset('')
        }
      }} onOffset={onStartOffset} error={startError} />
    <label className="mb-3 flex items-center gap-2">
      <Checkbox checked={sameDay} onCheckedChange={(checked) => {
        setSameDay(checked === true)
        if (checked === true) { onEndDate(startDate); onEndOffset('') }
      }} />Ends on the same day
    </label>
    <DateTimeField label="End" date={endDate} time={endTime} timezone={timezone} offset={endOffset}
      sameDate={sameDay} onDate={onEndDate} onTime={onEndTime} onOffset={onEndOffset} error={endError} />
    {endsBeforeStart && !endError ? <p className="app-meta">Ends after midnight? Uncheck “Ends on the same day.”</p> : null}
  </>
}
