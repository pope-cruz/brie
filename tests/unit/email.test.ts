import { describe, expect, it } from 'vitest'
import { isValidEmail, maskEmail, normalizeEmail } from '../../src/app/lib/email'

describe('email', () => {
  it('normalizes trim and case only', () => {
    expect(normalizeEmail('  Alex+Lead@Example.EDU ')).toBe('alex+lead@example.edu')
  })

  it('keeps plus tags and dots', () => {
    expect(isValidEmail('jordan.lee+volunteer@example.edu')).toBe(true)
  })

  it('rejects invalid emails', () => {
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })

  it('masks local part', () => {
    expect(maskEmail('alex.rivera@example.edu')).toBe('al***@example.edu')
  })
})
