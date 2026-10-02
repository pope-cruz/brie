import { describe, expect, it } from 'vitest'
import { oauthIdentity } from '../../supabase/functions/mcp/oauth'
import { handleMcpRequest } from '../../supabase/functions/mcp/protocol'

const resource = 'https://project.supabase.co/functions/v1/mcp'
const issuer = 'https://project.supabase.co/auth/v1'
const claims = { iss: issuer, aud: resource, role: 'brie_assistant', exp: Date.now() / 1000 + 3600,
  sub: '10000000-0000-4000-8000-000000000001', client_id: '10000000-0000-4000-8000-000000000002',
  brie_connection_id: '10000000-0000-4000-8000-000000000003' }

describe('assistant OAuth boundary', () => {
  it('extracts an identity from verified claims with the dedicated role and audience', () => {
    expect(oauthIdentity(claims, issuer, resource)).toEqual({ p_user_id: claims.sub,
      p_client_id: claims.client_id, p_connection_id: claims.brie_connection_id })
  })
  it.each([
    { aud: 'authenticated' }, { aud: 'https://other.example/mcp' }, { iss: 'https://other.example/auth/v1' },
    { role: 'authenticated' }, { client_id: undefined }, { brie_connection_id: undefined },
    { sub: 'invalid' }, { exp: 0 },
  ])('rejects normal app tokens, foreign audiences, expired and incomplete identities: %j', (changes) => {
    expect(() => oauthIdentity({ ...claims, ...changes }, issuer, resource)).toThrow()
  })
  it('advertises resource metadata from canonical configuration on POST and GET', async () => {
    const deps = { oauth: { resource, issuer }, check: async () => { throw new Error('must not be called') },
      call: async () => ({ ok: true as const, result: {} }) }
    for (const method of ['GET', 'POST']) {
      const response = await handleMcpRequest(new Request('https://untrusted.example/mcp', { method }), deps)
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${resource}?metadata=resource"`)
    }
    const metadata = await handleMcpRequest(new Request(`${resource}?metadata=resource`), deps)
    expect(await metadata.json()).toEqual({ resource, authorization_servers: [issuer],
      bearer_methods_supported: ['header'], resource_name: 'Brie' })
  })
})
