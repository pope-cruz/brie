// @vitest-environment jsdom
import { createElement, act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DateTimeRange } from '../../src/app/components/DateTimeRange'

let host: HTMLDivElement
let root: Root

function Harness({ initial }: { initial: { startDate: string; endDate: string; startTime: string; endTime: string } }) {
  const [state, setState] = useState({ ...initial, startOffset: '', endOffset: '' })
  const set = (key: keyof typeof state) => (value: string) => setState((current) => ({ ...current, [key]: value }))
  return createElement(DateTimeRange, {
    ...state, timezone: 'America/New_York',
    onStartDate: set('startDate'), onEndDate: set('endDate'), onStartTime: set('startTime'), onEndTime: set('endTime'),
    onStartOffset: set('startOffset'), onEndOffset: set('endOffset'),
  })
}

function field(label: string) { return host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)! }
async function type(label: string, value: string) {
  await act(async () => {
    const element = field(label)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function render(initial: { startDate: string; endDate: string; startTime: string; endTime: string }) {
  await act(async () => { root.render(createElement(Harness, { initial })) })
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('date and time range entry', () => {
  it('keeps the end date on the typed start date by default', async () => {
    await render({ startDate: '', endDate: '', startTime: '', endTime: '' })
    await type('Start date', '2026-10-03')
    expect(field('End date').value).toBe('2026-10-03')
    expect(field('End date').disabled).toBe(true)
  })

  it('moves the end time with the start time, keeping the duration', async () => {
    await render({ startDate: '2026-10-03', endDate: '2026-10-03', startTime: '18:00', endTime: '20:30' })
    await type('Start time', '19:15')
    expect(field('End time').value).toBe('21:45')
  })

  it('leaves the end time alone when the duration would cross midnight', async () => {
    await render({ startDate: '2026-10-03', endDate: '2026-10-03', startTime: '18:00', endTime: '22:00' })
    await type('Start time', '21:00')
    expect(field('End time').value).toBe('22:00')
  })

  it('suggests unchecking same day when the end is not after the start', async () => {
    await render({ startDate: '2026-10-03', endDate: '2026-10-03', startTime: '22:00', endTime: '20:00' })
    expect(host.textContent).toContain('Ends after midnight?')
  })

  it('does not tie multi-day events to the start date', async () => {
    await render({ startDate: '2026-10-03', endDate: '2026-10-04', startTime: '22:00', endTime: '02:00' })
    await type('Start date', '2026-10-10')
    expect(field('End date').value).toBe('2026-10-04')
    expect(host.textContent).not.toContain('Ends after midnight?')
  })
})
