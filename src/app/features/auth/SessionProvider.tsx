import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabase, isSupabaseConfigured } from '../../data/client'
import { ErrorRetry } from '../../components/ui'

type SessionValue = {
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const configured = isSupabaseConfigured()
  const [loading, setLoading] = useState(configured)
  const [session, setSession] = useState<Session | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!configured) return
    const client = getSupabase()
    let active = true
    let receivedEvent = false
    let currentUserId: string | null | undefined
    function applySession(next: Session | null) {
      if (!active) return
      if (currentUserId !== (next?.user.id ?? null) || !next) queryClient.clear()
      if (!next || (currentUserId !== undefined && currentUserId !== next.user.id)) {
        localStorage.removeItem('brie:last-workspace')
      }
      currentUserId = next?.user.id ?? null
      setSession(next)
      setFailed(false)
      setLoading(false)
    }
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      receivedEvent = true
      applySession(next)
    })
    client.auth.getSession().then(({ data, error }) => {
      if (!active || receivedEvent) return
      if (error) throw error
      applySession(data.session)
    }).catch(() => {
      if (active && !receivedEvent) {
        setFailed(true)
        setLoading(false)
      }
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [configured, queryClient, attempt])

  const value = useMemo<SessionValue>(
    () => ({
      configured,
      loading,
      session,
      user: session?.user ?? null,
      signOut: async () => {
        if (configured) {
          const { error } = await getSupabase().auth.signOut({ scope: 'local' })
          if (error) throw error
        }
        queryClient.clear()
        localStorage.removeItem('brie:last-workspace')
      },
    }),
    [configured, loading, queryClient, session],
  )

  if (failed) return <div className="app-entry"><ErrorRetry
    message="Couldn’t restore your session. Check your connection and try again."
    onRetry={() => { setFailed(false); setLoading(true); setAttempt((value) => value + 1) }}
  /></div>

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used within SessionProvider')
  return value
}
