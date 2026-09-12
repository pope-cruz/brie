import { useId, useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { format, parse, isValid } from 'date-fns'
import { Button } from './shadcn/button'
import { Calendar } from './shadcn/calendar'
import { Input } from './shadcn/input'
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './shadcn/select'
import { Field } from './ui'
import { resolveLocalDateTime } from '../lib/timezone'

export function DateTimeField({ label, date, time, timezone, offset, onDate, onTime, onOffset, error, sameDate = false }: {
  sameDate?: boolean
  label: string; date: string; time: string; timezone: string; offset?: string
  onDate: (value: string) => void; onTime: (value: string) => void; onOffset: (value: string) => void; error?: string
}) {
  const errorId = useId()
  const [open, setOpen] = useState(false)
  // A calendar date is a wall date, never a UTC instant. Only resolve it on save.
  const parsed = date ? parse(date, 'yyyy-MM-dd', new Date()) : undefined
  const selected = parsed && isValid(parsed) ? parsed : undefined
  const resolution = resolveLocalDateTime(date, time, timezone)
  const invalid = date && time && !resolution.ok && resolution.reason === 'nonexistent'
  return <fieldset className="mb-5 min-w-0">
    <legend className="mb-2 font-medium">{label}</legend>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_145px]">
      <div className="flex min-w-0 gap-2">
        <Input type="date" value={date} required disabled={sameDate} aria-label={`${label} date`}
          aria-describedby={error || invalid ? errorId : undefined}
          onChange={(event) => { onDate(event.target.value); onOffset('') }} />
        {!sameDate ? <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label={`Choose ${label.toLowerCase()} date from calendar`}>
              <CalendarIcon className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={(value) => {
              if (value) { onDate(format(value, 'yyyy-MM-dd')); onOffset(''); setOpen(false) }
            }} />
          </PopoverContent>
        </Popover> : null}
      </div>
      <Input type="time" aria-label={`${label} time`} value={time} required step={60} aria-invalid={Boolean(error || invalid)} aria-describedby={error || invalid ? errorId : undefined}
        onChange={(event) => { onTime(event.target.value); onOffset('') }} />
    </div>
    {!resolution.ok && resolution.reason === 'ambiguous' ? <Field label={`${label}: daylight-saving time choice`}
      hint="This clock time occurs twice. Choose the first or second occurrence.">
      <Select value={offset || ''} onValueChange={onOffset}>
        <SelectTrigger className="w-full" aria-label={`${label} time occurrence`}><SelectValue placeholder="Choose occurrence" /></SelectTrigger>
        <SelectContent>{resolution.options.map((option, index) => <SelectItem value={option.offset} key={option.iso}>
          {index === 0 ? 'First' : 'Second'} occurrence · UTC{option.offset}
        </SelectItem>)}</SelectContent>
      </Select>
    </Field> : null}
    {error || invalid ? <p id={errorId} role="alert" className="app-field-error">{error || 'This time is skipped by daylight saving. Choose another time.'}</p> : null}
  </fieldset>
}
