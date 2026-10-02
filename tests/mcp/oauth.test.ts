// Real Supabase OAuth exchange. Auth handles registration, PKCE and refresh;
// Brie consent binds the resulting JWT to one workspace and assistant scope.
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js'
import { requireServer, SERVER, structured } from './helpers'

let available = false
beforeAll(async () => { available = await requireServer() })
const verifier = () => randomBytes(32).toString('base64url')

describe('browser sign-in OAuth with Supabase Auth', () => {
  it('registers, approves one workspace, exchanges/refreshes, and revokes an issued token', async ({ skip }) => {
    if (!available) skip()
    const discovery = await discoverOAuthServerInfo(SERVER, { resourceMetadataUrl: new URL(`${SERVER}?metadata=resource`) })
    expect(discovery.resourceMetadata?.resource).toBe(SERVER.toString())
    expect(discovery.authorizationServerMetadata?.token_endpoint).toBe(`${SERVER.origin}/auth/v1/oauth/token`)
    const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    const app = createClient(SERVER.origin, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const signup = await app.auth.signUp({ email: `oauth-${randomUUID()}@example.test`, password: randomBytes(24).toString('hex') })
    expect(signup.error).toBeNull()
    expect(signup.data.session).toBeTruthy()
    const workspace = await app.rpc('create_workspace', { p_name: 'OAuth integration workspace', p_timezone: 'UTC', p_display_name: 'OAuth test organizer', p_request_key: randomUUID() })
    expect(workspace.error).toBeNull()
    const registration = await fetch(`${SERVER.origin}/auth/v1/oauth/clients/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        client_name: 'Brie OAuth integration', redirect_uris: ['https://assistant.example.test/callback'],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
      }),
    })
    expect(registration.status).toBe(201)
    const registered = await registration.json()
    const proof = verifier()
    const authorization = new URL(`${SERVER.origin}/auth/v1/oauth/authorize`)
    const state = randomUUID()
    authorization.search = new URLSearchParams({ response_type: 'code', client_id: registered.client_id,
      redirect_uri: 'https://assistant.example.test/callback', code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(proof).digest('base64url'), scope: 'openid', state,
      resource: SERVER.toString(), }).toString()
    const authorize = await fetch(authorization, { redirect: 'manual' })
    expect(authorize.status).toBe(302)
    const consent = new URL(authorize.headers.get('location')!)
    expect(consent.pathname).toBe('/app/connect-assistant')
    const authorizationId = consent.searchParams.get('authorization_id')!
    const details = await app.auth.oauth.getAuthorizationDetails(authorizationId)
    expect(details.error).toBeNull()
    expect(details.data && 'client' in details.data && details.data.client.id).toBe(registered.client_id)
    const grant = await app.rpc('connect_assistant', { p_workspace_id: workspace.data.workspace.id,
      p_client_id: registered.client_id, p_label: 'OAuth integration', p_scope: 'read' })
    expect(grant.error).toBeNull()
    const approval = await app.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    expect(approval.error).toBeNull()
    const callback = new URL(approval.data!.redirect_url)
    expect(callback.searchParams.get('state')).toBe(state)
    const tokenRequest = (params: Record<string, string>) => fetch(`${SERVER.origin}/auth/v1/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
    })
    const exchange = await tokenRequest({ grant_type: 'authorization_code', client_id: registered.client_id,
      redirect_uri: 'https://assistant.example.test/callback', code: callback.searchParams.get('code')!, code_verifier: proof,
      resource: SERVER.toString() })
    // Response diagnostics exclude credentials.
    if (!exchange.ok) throw new Error(`OAuth exchange failed: ${exchange.status} ${JSON.stringify(await exchange.json())}`)
    const tokens = await exchange.json()
    const client = new Client({ name: 'brie-oauth-test', version: '1' })
    try {
      await client.connect(new StreamableHTTPClientTransport(SERVER, { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }))
      expect(structured(await client.callTool({ name: 'get_workspace', arguments: {} })).id).toBe(workspace.data.workspace.id)
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).not.toContain('create_event_plan_draft')
      const direct = await fetch(`${SERVER.origin}/rest/v1/rpc/list_my_workspaces`, { method: 'POST', headers: {
        apikey: status.ANON_KEY, Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' }, body: '{}' })
      expect([401, 403]).toContain(direct.status)
      const refresh = await tokenRequest({ grant_type: 'refresh_token', client_id: registered.client_id, refresh_token: tokens.refresh_token })
      expect(refresh.status).toBe(200)
      const refreshed = await refresh.json()
      const refreshedCall = await fetch(SERVER, { method: 'POST', headers: { Authorization: `Bearer ${refreshed.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
      expect(refreshedCall.status).toBe(200)
      const revoked = await app.rpc('revoke_assistant_token', { p_workspace_id: workspace.data.workspace.id, p_token_id: grant.data.id })
      expect(revoked.error).toBeNull()
      const stopped = await fetch(SERVER, { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) })
      expect(stopped.status).toBe(401)
      const deniedRefresh = await tokenRequest({ grant_type: 'refresh_token', client_id: registered.client_id, refresh_token: refreshed.refresh_token })
      expect(deniedRefresh.ok).toBe(false)
      expect((await app.auth.oauth.revokeGrant({ clientId: registered.client_id })).error).toBeNull()
    } finally { await client.close() }
  })
})
