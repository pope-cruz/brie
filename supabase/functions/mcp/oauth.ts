import { UnauthorizedError } from './protocol.ts'

export type OAuthIdentity = { p_user_id: string; p_client_id: string; p_connection_id: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Call only AFTER verifying the JWT signature and expiry with Supabase Auth. */
export function oauthIdentity(claims: Record<string, unknown>, issuer: string, resource: string): OAuthIdentity {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== issuer || !audiences.includes(resource) || claims.role !== 'brie_assistant'
    || typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000
    || ![claims.sub, claims.client_id, claims.brie_connection_id].every((value) => typeof value === 'string' && UUID.test(value))) {
    throw new UnauthorizedError('Sign in to Brie again to reconnect this assistant.')
  }
  return { p_user_id: claims.sub as string, p_client_id: claims.client_id as string, p_connection_id: claims.brie_connection_id as string }
}
