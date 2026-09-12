import { useMemo, useState, type ComponentProps } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from './shadcn/button'
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './shadcn/command'
import { listTimeZones, timeZoneLabel } from '../lib/timezone'

type Props = Omit<ComponentProps<'button'>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  at?: string
}
export function TimeZonePicker({ value, onChange, at, ...props }: Props) {
  const [open, setOpen] = useState(false)
  const zones = useMemo(() => [...new Set([value, ...listTimeZones()])].map((zone) => ({
    zone, label: timeZoneLabel(zone, at),
  })), [value, at])
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button {...props} type="button" variant="outline" role="combobox" aria-expanded={open}
        className="h-auto min-h-11 w-full justify-between whitespace-normal text-left font-normal">
        <span>{timeZoneLabel(value, at)}</span><ChevronsUpDown className="size-4 shrink-0" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[400px] p-0">
      <Command filter={(value, search) => value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0}>
        <CommandInput placeholder="Search city or time zone…" aria-label="Search time zones" />
        <CommandList>
          <CommandEmpty>No time zones found.</CommandEmpty>
          <CommandGroup>
            {zones.map(({ zone, label }) => <CommandItem key={zone} value={`${zone} ${label}`} onSelect={() => {
              onChange(zone); setOpen(false)
            }}>
              <Check className={value === zone ? 'size-4' : 'size-4 invisible'} />
              <span>{label}<span className="block text-xs text-muted-foreground">{zone}</span></span>
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}
