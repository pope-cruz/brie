// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInPage } from '../../src/app/features/auth/SignInPage'

const auth = vi.hoisted(() => ({ signInWithOtp: vi.fn(), verifyOtp: vi.fn() }))
vi.mock('../../src/app/data/client', () => ({ isSupabaseConfigured: () => true, getSupabase: () => ({ auth }) }))
vi.mock('../../src/app/features/auth/SessionProvider', () => ({ useSession: () => ({ user: null, loading: false }) }))

let host: HTMLDivElement
let root: Root
async function input(value: string) {
  await act(async () => {
    const element = host.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}
function button(label: string) { return [...host.querySelectorAll('button')].find((item) => item.textContent === label)! }

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  auth.signInWithOtp.mockReset().mockResolvedValue({ error: null })
  auth.verifyOtp.mockReset().mockResolvedValue({ error: null })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(createElement(MemoryRouter, { initialEntries: ['/app/sign-in?return=%2Fapp%2Finvite%2Fexample'] }, createElement(SignInPage))) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })

describe('email-code sign-in', () => {
  it('preserves the invite destination, normalizes email, and focuses the code field', async () => {
    await input('Owner@Example.test'); await submit()
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'owner@example.test', options: {
      shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/app/sign-in?return=%2Fapp%2Finvite%2Fexample`,
    } })
    expect(document.activeElement).toBe(host.querySelector('input'))
    expect(button('Resend in 60s').disabled).toBe(true)
    await act(async () => { vi.advanceTimersByTime(60_000) })
    await act(async () => button('Resend code').click())
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(2)
    expect(button('Resend in 60s').disabled).toBe(true)
  })
  it('validates codes, supports pasted spacing, and explains expired codes', async () => {
    await input('owner@example.test'); await submit()
    await input('12'); await submit()
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    auth.verifyOtp.mockResolvedValue({ error: { code: 'otp_expired' } })
    await input('123 456'); await submit()
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'owner@example.test', token: '123456', type: 'email' })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('invalid or has expired')
    await act(async () => button('Change email').click())
    expect(host.querySelector('input')?.value).toBe('owner@example.test')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
  it('prevents overlapping send requests and allows retry after failure', async () => {
    let resolve!: (value: unknown) => void
    auth.signInWithOtp.mockReturnValue(new Promise((done) => { resolve = done }))
    await input('owner@example.test'); await submit(); await submit()
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1)
    expect(button('Sending…').disabled).toBe(true)
    await act(async () => resolve({ error: { code: 'unexpected_failure' } }))
    expect(button('Send code').disabled).toBe(false)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t send')
  })
})
