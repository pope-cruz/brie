import { describe, expect, it } from 'vitest'
import { buildInvitationEmail, resolveAppOrigin } from '../../supabase/functions/send-invitation/email'

describe('invitation email', () => {
  const base = {
    inviterName: 'Riley',
    workspaceName: 'Harvest Fest',
    role: 'member' as const,
    link: 'https://brie.pope.dev/app/invite/abc123',
    expiresAt: '2026-10-02T15:00:00Z',
  }

  it('names the inviter, workspace, role, link, and expiry', () => {
    const email = buildInvitationEmail(base)
    expect(email.subject).toBe('Riley invited you to Harvest Fest on Brie')
    expect(email.text).toContain('as a member, so you can read event plans')
    expect(email.text).toContain('https://brie.pope.dev/app/invite/abc123')
    expect(email.text).toContain('expires on October 2')
    expect(email.html).toContain('href="https://brie.pope.dev/app/invite/abc123"')
  })

  it('escapes names so a workspace cannot inject markup', () => {
    const email = buildInvitationEmail({ ...base, workspaceName: '<script>x</script> & co', inviterName: '"Q"' })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; co')
    expect(email.html).toContain('&quot;Q&quot;')
  })

  it('falls back when names are blank', () => {
    expect(buildInvitationEmail({ ...base, inviterName: ' ', workspaceName: '' }).subject).toBe('A teammate invited you to their team on Brie')
  })
})

describe('invitation link origin', () => {
  it('prefers the configured https origin and drops any path', () => {
    expect(resolveAppOrigin('https://brie.pope.dev/app', 'https://evil.example')).toBe('https://brie.pope.dev')
  })
  it('ignores a configured plain-http origin that is not local', () => {
    expect(resolveAppOrigin('http://brie.pope.dev', null)).toBeNull()
  })
  it('trusts the request origin only for local development', () => {
    expect(resolveAppOrigin(undefined, 'http://127.0.0.1:5199')).toBe('http://127.0.0.1:5199')
    expect(resolveAppOrigin(undefined, 'https://evil.example')).toBeNull()
    expect(resolveAppOrigin('not a url', null)).toBeNull()
  })
})
