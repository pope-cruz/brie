import { describe, expect, it } from 'vitest'
import { toAppError } from '../../src/app/data/errors'

describe('toAppError', () => {
  it('maps PostgREST app errors', () => {
    const error = toAppError({
      message: 'VALIDATION',
      details: 'End must be after start.',
      hint: '{"endsAt":"End must be after start."}',
    })
    expect(error.code).toBe('VALIDATION')
    expect(error.fields.endsAt).toBe('End must be after start.')
  })
})
