// Pure helpers for the invitation email, kept free of Deno APIs so unit tests can import them.

export type InvitationEmailInput = {
  inviterName: string
  workspaceName: string
  role: 'organizer' | 'member'
  link: string
  expiresAt: string
}

const ROLE_COPY = {
  organizer: 'an organizer, so you can manage events, tasks, schedules, and attendance',
  member: 'a member, so you can read event plans and check off the tasks assigned to you',
} as const

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Only https links, or http on a loopback host for local development, may appear in an email. */
export function resolveAppOrigin(configured: string | undefined, requestOrigin: string | null): string | null {
  const configuredUrl = parseUrl(configured)
  if (configuredUrl && (configuredUrl.protocol === 'https:' || isLoopback(configuredUrl))) return configuredUrl.origin
  // A request's own Origin is trusted only for local development.
  const requestUrl = parseUrl(requestOrigin)
  if (requestUrl && isLoopback(requestUrl)) return requestUrl.origin
  return null
}

function parseUrl(value: string | null | undefined): URL | null {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isLoopback(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

export function buildInvitationEmail(input: InvitationEmailInput) {
  const inviter = input.inviterName.trim() || 'A teammate'
  const workspace = input.workspaceName.trim() || 'their team'
  const expires = new Date(input.expiresAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const subject = `${inviter} invited you to ${workspace} on Brie`
  const text = [
    `${inviter} invited you to join ${workspace} on Brie as ${ROLE_COPY[input.role]}.`,
    '',
    `Accept the invitation: ${input.link}`,
    '',
    `Sign in with this email address to join. The link expires on ${expires}.`,
    'If you weren’t expecting this, you can ignore this email.',
  ].join('\n')
  const html = `<h2>${escapeHtml(inviter)} invited you to ${escapeHtml(workspace)}</h2>
<p>You’re invited to join ${escapeHtml(workspace)} on Brie as ${escapeHtml(ROLE_COPY[input.role])}.</p>
<p><a href="${escapeHtml(input.link)}" style="display:inline-block;padding:10px 16px;background:#1f1f1f;color:#ffffff;border-radius:6px;text-decoration:none;">Accept invitation</a></p>
<p>Sign in with this email address to join. The link expires on ${escapeHtml(expires)}.</p>
<p style="color:#6b6b6b;">If the button doesn’t work, paste this link into your browser:<br>${escapeHtml(input.link)}</p>
<p style="color:#6b6b6b;">If you weren’t expecting this, you can ignore this email.</p>`
  return { subject, text, html }
}
