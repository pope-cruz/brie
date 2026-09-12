import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { getSupabase, isSupabaseConfigured } from '../../data/client'
import { Button, Field } from '../../components/ui'
import { safeReturnPath } from '../../lib/paths'
import { useSession } from './SessionProvider'

function authMessage(error: unknown, verifying: boolean) {
  const code = (error as { code?: string })?.code
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return 'Please wait a minute before requesting another code.'
  }
  if (code === 'otp_expired' || code === 'otp_disabled') {
    return 'That code is invalid or has expired. Try again or request a new code.'
  }
  return verifying
    ? 'Couldn’t verify your code. Check the code and your connection, then try again.'
    : 'Couldn’t send your code. Check your email and connection, then try again.'
}

export function SignInPage() {
  const { user, loading } = useSession()
  const [params] = useSearchParams()
  const returnTo = safeReturnPath(params.get('return'))
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now)
  const codeRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000))

  useEffect(() => {
    if (!resendAt) return
    const timer = window.setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= resendAt) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendAt])

  useEffect(() => {
    if (!loading) (sent ? codeRef : emailRef).current?.focus()
  }, [sent, loading])

  async function sendCode() {
    if (pending.current || Date.now() < resendAt) return
    pending.current = true
    setBusy('send')
    setError(null)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const { error: sendError } = await getSupabase().auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/app/sign-in?return=${encodeURIComponent(returnTo)}`,
        },
      })
      if (sendError) throw sendError
      setEmail(normalizedEmail)
      setCode('')
      setSent(true)
      setNow(Date.now())
      setResendAt(Date.now() + 60_000)
      codeRef.current?.focus()
    } catch (caught) {
      setError(authMessage(caught, false))
      if ((caught as { status?: number })?.status === 429) {
        setNow(Date.now())
        setResendAt(Date.now() + 60_000)
      }
    } finally {
      pending.current = false
      setBusy(null)
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    if (pending.current) return
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    pending.current = true
    setBusy('verify')
    setError(null)
    try {
      const { error: verifyError } = await getSupabase().auth.verifyOtp({
        email, token: code, type: 'email',
      })
      if (verifyError) throw verifyError
      // The session listener redirects only after the authenticated user is ready.
    } catch (caught) {
      setError(authMessage(caught, true))
      codeRef.current?.focus()
    } finally {
      pending.current = false
      setBusy(null)
    }
  }

  if (!isSupabaseConfigured()) return (
    <div className="app-entry"><div className="app-entry-card">
      <Link to="/" className="app-wordmark">brie</Link>
      <h1 className="app-h1">Sign-in isn’t available yet</h1>
      <p className="app-lede">This Brie installation still needs to be connected. Please contact the person setting up your workspace.</p>
    </div></div>
  )
  if (loading) return <div className="app-entry"><p role="status">Loading…</p></div>
  if (user) return <Navigate to={returnTo} replace />

  return (
    <div className="app-entry"><div className="app-entry-card">
      <Link to="/" className="app-wordmark">brie</Link>
      <h1 className="app-h1">{sent ? 'Enter your code' : 'Sign in'}</h1>
      <p className="app-lede" role="status">
        {sent ? `We sent a 6-digit code to ${email}. Use the most recent code.` : 'Use your email. We’ll send a one-time code.'}
      </p>
      {sent ? (
        <form onSubmit={verify}>
          <Field label="Code" error={error ?? undefined} hint="Check your spam folder if the email hasn’t arrived.">
            <input ref={codeRef} className="app-input" inputMode="numeric" autoComplete="one-time-code"
              value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              pattern="[0-9]{6}" required readOnly={Boolean(busy)} />
          </Field>
          <Button type="submit" busy={busy === 'verify'} disabled={Boolean(busy)} busyLabel="Verifying…">Verify</Button>
          <div className="app-toolbar">
            <Button type="button" variant="secondary" busy={busy === 'send'} busyLabel="Sending…"
              disabled={Boolean(busy) || remaining > 0} onClick={sendCode}>
              {remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}
            </Button>
            <Button type="button" variant="quiet" disabled={Boolean(busy)} onClick={() => {
              setSent(false); setCode(''); setError(null)
            }}>Change email</Button>
          </div>
        </form>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void sendCode() }}>
          <Field label="Email" error={error ?? undefined}>
            <input ref={emailRef} className="app-input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
              value={email} onChange={(event) => setEmail(event.target.value)} required readOnly={Boolean(busy)} />
          </Field>
          <Button type="submit" busy={busy === 'send'} busyLabel="Sending…" disabled={remaining > 0}>
            {remaining > 0 ? `Send code in ${remaining}s` : 'Send code'}
          </Button>
        </form>
      )}
    </div></div>
  )
}
