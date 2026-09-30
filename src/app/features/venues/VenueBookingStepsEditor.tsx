import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ErrorRetry } from '../../components/ui'
import { getVenueBookingSteps, setVenueBookingSteps } from '../../data/api'
import { toAppError } from '../../data/errors'
import type { VenueBookingStepTemplate, VenueBookingSteps } from '../../data/types'

export function VenueBookingStepsEditor({ workspaceId, venueId, canEdit }: {
  workspaceId: string; venueId: string; canEdit: boolean
}) {
  const query = useQuery({
    queryKey: ['venue-booking-steps', workspaceId, venueId],
    queryFn: () => getVenueBookingSteps(workspaceId, venueId),
  })
  if (query.isLoading) return <p>Loading booking steps…</p>
  if (query.isError || !query.data) return <ErrorRetry message={toAppError(query.error).message} onRetry={() => query.refetch()} />
  return <BookingStepsForm key={query.data.version} workspaceId={workspaceId} venueId={venueId} data={query.data} canEdit={canEdit} />
}

function BookingStepsForm({ workspaceId, venueId, data, canEdit }: {
  workspaceId: string; venueId: string; data: VenueBookingSteps; canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const [steps, setSteps] = useState<VenueBookingStepTemplate[]>(data.steps)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(index: number, patch: Partial<VenueBookingStepTemplate>) {
    setSteps((current) => current.map((step, position) => position === index ? { ...step, ...patch } : step))
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await setVenueBookingSteps(workspaceId, venueId, steps, data.version)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['venue-booking-steps', workspaceId, venueId] }),
        queryClient.invalidateQueries({ queryKey: ['venue', workspaceId, venueId] }),
        queryClient.invalidateQueries({ queryKey: ['venues', workspaceId] }),
      ])
    } catch (caught) {
      setError(toAppError(caught).message)
    } finally {
      setBusy(false)
    }
  }

  return <section style={{ marginTop: 24 }}>
    <h2 className="app-section-title">Booking steps</h2>
    <p className="app-meta">Offsets are counted from the venue’s lead-time deadline. Changes apply to new bookings.</p>
    {steps.map((step, index) => <div className="app-toolbar" key={index} style={{ marginTop: 8 }}>
      {canEdit ? <>
        <input className="app-input" aria-label={`Step ${index + 1} name`} value={step.title} maxLength={80} onChange={(event) => update(index, { title: event.target.value })} />
        <label className="app-meta">Days after first deadline
          <input className="app-input" type="number" min="0" max="730" value={step.offsetDays} onChange={(event) => update(index, { offsetDays: Number(event.target.value) })} />
        </label>
        <Button variant="quiet" onClick={() => setSteps((current) => current.filter((_, position) => position !== index))}>Remove</Button>
      </> : <p>{index + 1}. {step.title} · {step.offsetDays} days after first deadline</p>}
    </div>)}
    {canEdit ? <div className="app-toolbar" style={{ marginTop: 12 }}>
      <Button variant="secondary" disabled={steps.length >= 10} onClick={() => setSteps((current) => [...current, { title: '', offsetDays: current.at(-1)?.offsetDays ?? 0 }])}>Add step</Button>
      <Button busy={busy} disabled={steps.length === 0} onClick={() => void save()}>Save steps</Button>
    </div> : null}
    {error ? <p className="app-error-text" role="alert">{error}</p> : null}
  </section>
}
