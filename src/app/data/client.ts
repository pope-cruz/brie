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

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) throw toAppError(error)
  return data as T
}

export async function requireUserId(): Promise<string> {
  const { data, error } = await getSupabase().auth.getUser()
  if (error || !data.user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.')
  return data.user.id
}
