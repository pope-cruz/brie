import { describe, expect, it } from 'vitest'
import { prefixMatch } from '../../src/app/lib/search'

describe('prefixMatch', () => {
  it('matches the start of either field', () => {
    expect(prefixMatch('spr', 'Spring Mixer', 'Campus Hall')).toBe(true)
    expect(prefixMatch('cam', 'Spring Mixer', 'Campus Hall')).toBe(true)
  })

  it('does not match substrings', () => {
    expect(prefixMatch('mix', 'Spring Mixer', 'Campus Hall')).toBe(false)
  })
})
