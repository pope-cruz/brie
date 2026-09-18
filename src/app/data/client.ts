import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AppError, toAppError } from './errors'

let client: SupabaseClient | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new AppError(
      'UNAVAILABLE',
      'Supabase is not configured. Copy .env.example to .env.local and start the local stack.',
    )
  }
  if (!client) {
    client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}

/**
 * PostgREST reads the time from a clock it refreshes about once a second, so a token
 * signed in the current second can look "issued at future" for up to a second right after
 * sign-in or refresh. The token is rejected before any SQL runs, so retrying is safe for writes.
 */
const CLOCK_SKEW = /JWT issued at future/i
export const CLOCK_SKEW_RETRY_MS = 1100

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const { data, error } = await getSupabase().rpc(fn, args)
    if (!error) return data as T
    if (attempt < 2 && CLOCK_SKEW.test(error.message ?? '')) {
      await new Promise((resolve) => setTimeout(resolve, CLOCK_SKEW_RETRY_MS))
      continue
    }
    throw toAppError(error)
  }
}

export async function requireUserId(): Promise<string> {
  const { data, error } = await getSupabase().auth.getUser()
  if (error || !data.user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.')
  return data.user.id
}
