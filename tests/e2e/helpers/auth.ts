import { expect, type Page } from '@playwright/test'
import { waitForSignInCode } from './mailpit'

// Local Auth allows one code per address per minute (`max_frequency` in supabase/config.toml).
const lastCodeAt = new Map<string, number>()

export function uniqueEmail(role: string) {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
  return `brie-e2e-${stamp}-${role}@example.test`
}

/** Requests a code on the sign-in page, reads it from Mailpit, and verifies it. */
export async function signIn(page: Page, email: string, returnTo = '/app') {
  const waitUntil = (lastCodeAt.get(email) ?? 0) + 61_000
  if (Date.now() < waitUntil) await page.waitForTimeout(waitUntil - Date.now())

  await page.goto(`/app/sign-in?return=${encodeURIComponent(returnTo)}`)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  const since = Date.now()
  await page.getByRole('button', { name: 'Send code' }).click()
  lastCodeAt.set(email, since)
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible()

  const code = await waitForSignInCode(email, since)
  await page.getByLabel('Code').fill(code)
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page).not.toHaveURL(/\/app\/sign-in/, { timeout: 20_000 })
}

/** Signs out through the shell so the app clears its session and query caches. */
export async function signOut(page: Page) {
  const signOutButton = page.getByRole('button', { name: 'Sign out' })
  if (!(await signOutButton.isVisible())) {
    await page.getByRole('button', { name: 'Menu' }).click()
  }
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/app\/sign-in/)
}
