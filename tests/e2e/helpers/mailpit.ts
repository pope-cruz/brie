// Reads sign-in codes from the local Mailpit mailbox that `supabase start` runs.
// Local emails never leave the machine; this is not usable against production SMTP.
const MAILPIT_URL = process.env.BRIE_MAILPIT_URL || 'http://127.0.0.1:54324'

type MailpitSummary = { ID: string; Created: string; To: Array<{ Address: string }> }

async function json<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`)
  if (!response.ok) throw new Error(`Mailpit ${path} responded ${response.status}`)
  return (await response.json()) as T
}

/**
 * Waits for a Brie sign-in email addressed to `email` that arrived after `since`
 * and returns its six-digit code. Uses the newest matching message so a resend wins.
 */
export async function waitForSignInCode(email: string, since: number, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  const wanted = email.toLowerCase()
  while (Date.now() < deadline) {
    const result = await json<{ messages: MailpitSummary[] }>(
      `/api/v1/search?query=${encodeURIComponent(`to:${wanted}`)}&limit=10`,
    )
    const fresh = (result.messages ?? [])
      .filter((message) => message.To?.some((to) => to.Address.toLowerCase() === wanted))
      .filter((message) => new Date(message.Created).getTime() >= since - 5_000)
      .sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime())
    if (fresh[0]) {
      const message = await json<{ Text: string; HTML: string }>(`/api/v1/message/${fresh[0].ID}`)
      const match = /\b(\d{6})\b/.exec(message.Text || message.HTML.replace(/<[^>]+>/g, ' '))
      if (match) return match[1]
    }
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  throw new Error(`No sign-in code for ${email} arrived in Mailpit within ${timeoutMs} ms`)
}

export async function mailpitReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${MAILPIT_URL}/api/v1/info`)
    return response.ok
  } catch {
    return false
  }
}
