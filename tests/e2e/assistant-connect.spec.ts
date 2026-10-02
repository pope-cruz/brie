import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { mailpitReachable, waitForSignInCode } from './helpers/mailpit'

for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 640 }]) {
  test(`assistant sign-in and workspace approval at ${viewport.width}px`, async ({ page }) => {
    test.skip(!(await mailpitReachable()), 'Requires the local Supabase mailbox')
    await page.setViewportSize(viewport)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    const api = status.API_URL as string
    const email = `browser-oauth-${randomUUID()}@example.test`
    const app = createClient(api, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const signup = await app.auth.signUp({ email, password: randomBytes(24).toString('hex') })
    expect(signup.error).toBeNull()
    const workspace = await app.rpc('create_workspace', { p_name: 'Campus Dinner Club', p_timezone: 'America/New_York',
      p_display_name: 'Olive Organizer', p_request_key: randomUUID() })
    expect(workspace.error).toBeNull()
    const registration = await fetch(`${api}/auth/v1/oauth/clients/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Cloud Assistant', redirect_uris: ['https://assistant.example.test/callback'],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) })
    const registered = await registration.json()
    const proof = randomBytes(32).toString('base64url')
    const authorize = new URL(`${api}/auth/v1/oauth/authorize`)
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: registered.client_id,
      redirect_uri: 'https://assistant.example.test/callback', code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(proof).digest('base64url'), scope: 'openid', state: 'browser-test' }).toString()
    const response = await fetch(authorize, { redirect: 'manual' })
    const consentUrl = response.headers.get('location')!
    await page.route('https://assistant.example.test/callback**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Connected to assistant</h1>' }))
    await page.goto(consentUrl)
    await expect(page.getByRole('heading', { name: 'Sign in to connect your assistant' })).toBeVisible()
    await page.screenshot({ path: `test-results/oauth-sign-in-${viewport.width}.png`, fullPage: true })
    await page.getByLabel('Email', { exact: true }).fill(email)
    const since = Date.now()
    await page.getByRole('button', { name: 'Send code' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    const code = await waitForSignInCode(email, since)
    await page.getByLabel('Code', { exact: true }).fill(code)
    await page.getByRole('button', { name: 'Verify', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Connect your assistant' })).toBeVisible()
    await expect(page.getByText('Cloud Assistant', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Workspace')).toHaveValue(workspace.data.workspace.id)
    await expect(page.getByLabel('Allow this assistant to')).toHaveValue('read')
    if (viewport.width === 320) await page.getByLabel('Allow this assistant to').selectOption('read_draft')
    await expect(page.getByRole('button', { name: 'Connect assistant', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/oauth-approval-${viewport.width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Connect assistant', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Connected to assistant' })).toBeVisible()
    const callback = new URL(page.url())
    expect(callback.searchParams.get('state')).toBe('browser-test')
    const exchange = await fetch(`${api}/auth/v1/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: registered.client_id, redirect_uri: 'https://assistant.example.test/callback',
        code: callback.searchParams.get('code')!, code_verifier: proof }) })
    expect(exchange.status).toBe(200)
    const connections = await app.rpc('list_assistant_tokens', { p_workspace_id: workspace.data.workspace.id })
    expect(connections.data[0].scope).toBe(viewport.width === 320 ? 'read_draft' : 'read')
    expect(connections.data[0].oauthClientId).toBe(registered.client_id)
    expect(errors).toEqual([])
    await app.rpc('revoke_assistant_token', { p_workspace_id: workspace.data.workspace.id, p_token_id: connections.data[0].id })
    await app.auth.oauth.revokeGrant({ clientId: registered.client_id })
  })
}
