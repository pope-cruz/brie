import type { MouseEvent } from 'react'
import type { SegmentRecord } from '../../data/types'
import { isBuffer, type CalendarLayout } from '../../lib/calendarLayout'
import { formatClock } from '../../lib/timeInput'

/** 96px an hour. Blocks too short for two lines show the title first on one line. */
const PX_PER_MINUTE = 1.6
const MIN_BLOCK_PX = 22
const TWO_LINE_PX = 40

function hourLabel(minute: number) {
  return formatClock(minute % (24 * 60)) + (minute >= 24 * 60 ? ' +1' : '')
}

export type EmptySlot = { day: string; minute: number; personId: string | null }

/**
 * The Day of time grid. Blocks sit in one layer in time order, so Tab walks the day in order
 * even across person columns. Clicking empty time offers a new item there.
 */
export function CalendarView({ layout, showDayHeads, marks, ownerName, onOpen, onAddAt }: {
  layout: CalendarLayout
  showDayHeads: boolean
  marks: Map<string, 'now' | 'next'>
  ownerName: (segment: SegmentRecord) => string | null
  onOpen: (segment: SegmentRecord) => void
  onAddAt?: (slot: EmptySlot) => void
}) {
  const { columns, startMinute, endMinute } = layout
  const height = (endMinute - startMinute) * PX_PER_MINUTE
  const hours = Array.from({ length: (endMinute - startMinute) / 60 + 1 }, (_, index) => startMinute + index * 60)
  const showPeople = columns.some((column) => column.personId !== null)
  const blocks = columns
    .flatMap((column, columnIndex) => column.blocks.map((block) => ({ ...block, columnIndex, column })))
    .sort((a, b) => a.start - b.start || a.columnIndex - b.columnIndex || a.lane - b.lane)

  function emptyClick(click: MouseEvent<HTMLDivElement>, columnIndex: number) {
    if (!onAddAt) return
    const rect = click.currentTarget.getBoundingClientRect()
    const minute = startMinute + Math.floor((click.clientY - rect.top) / PX_PER_MINUTE / 15) * 15
    const column = columns[columnIndex]
    onAddAt({ day: column.day, minute, personId: column.personId })
  }

  return (
    <div className="cal" style={{ ['--cal-cols' as string]: columns.length }}>
      {showDayHeads || showPeople ? (
        <div className="cal-head" aria-hidden="true">
          <span />
          {columns.map((column) => (
            <span key={column.key} className="cal-col-head">
              {showDayHeads ? <span className="cal-col-day">{new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${column.day}T12:00:00Z`))}</span> : null}
              {showPeople ? <span className="cal-col-person">{column.label}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
      <div className="cal-body" style={{ height }}>
        <div className="cal-hours" aria-hidden="true">
          {hours.map((minute) => <span key={minute} style={{ top: (minute - startMinute) * PX_PER_MINUTE }}>{hourLabel(minute)}</span>)}
        </div>
        <div className="cal-grid">
          {columns.map((column, index) => (
            <div key={column.key} className={`cal-col${onAddAt ? ' cal-col-add' : ''}`} onClick={(click) => emptyClick(click, index)}
              title={onAddAt ? 'Click empty time to add an item' : undefined} />
          ))}
          <ol className="cal-blocks" aria-label="Schedule in time order">
            {blocks.map((block) => {
              const top = (block.start - startMinute) * PX_PER_MINUTE
              const blockHeight = Math.max(MIN_BLOCK_PX, (block.end - block.start) * PX_PER_MINUTE - 2)
              const width = 100 / columns.length / block.lanes
              const left = (100 / columns.length) * block.columnIndex + width * block.lane
              const owner = ownerName(block.segment)
              const mark = marks.get(block.segment.id)
              const time = `${hourLabel(block.start)} – ${hourLabel(block.end)}`
              const compact = blockHeight < TWO_LINE_PX
              return (
                <li key={`${block.column.key}:${block.segment.id}`} style={{ top, height: blockHeight, left: `${left}%`, width: `${width}%` }}>
                  <button type="button" className={`cal-block${compact ? ' cal-compact' : ''}${isBuffer(block.segment) ? ' cal-buffer' : ''}${mark === 'now' ? ' cal-now' : ''}`}
                    aria-label={`${block.segment.title}, ${time}${owner ? `, ${owner}` : ', everyone'}${mark ? `, ${mark}` : ''}`}
                    onClick={() => onOpen(block.segment)}>
                    {compact ? <>
                      <span className="cal-block-title">{block.segment.title}</span>
                      <span className="cal-block-time">{mark ? <strong>{mark === 'now' ? 'Now' : 'Next'} · </strong> : null}{time}</span>
                    </> : <>
                      <span className="cal-block-time">{mark ? <strong>{mark === 'now' ? 'Now' : 'Next'} · </strong> : null}{time}</span>
                      <span className="cal-block-title">{block.segment.title}</span>
                    </>}
                    {!showPeople && owner ? <span className="cal-block-owner">{owner}</span> : null}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}
