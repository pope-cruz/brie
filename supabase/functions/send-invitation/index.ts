// Creates an invitation as the signed-in owner, then emails the link through Resend.
// The invitation is created by the same `create_invitation` command the app uses, so
// authorization stays in the database. Email is best effort: the response always carries
// the token so the owner can copy the link when delivery is skipped or fails.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { buildInvitationEmail, resolveAppOrigin } from './email.ts'

type Delivery = 'sent' | 'not_configured' | 'rate_limited' | 'failed'

const HOURLY_EMAIL_LIMIT = 30

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Mirrors the PostgREST error shape so the app's toAppError reads it unchanged.
function appError(code: string, message: string, status = 400) {
  return json({ error: { message: code, details: message } }, status)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return appError('VALIDATION', 'Use POST.', 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return appError('UNAUTHENTICATED', 'Sign in to continue.', 401)

  let input: { workspaceId?: unknown; email?: unknown; role?: unknown }
  try {
    input = await request.json()
  } catch {
    return appError('VALIDATION', 'Enter a valid email address.')
  }
  if (typeof input.workspaceId !== 'string' || typeof input.email !== 'string' || typeof input.role !== 'string') {
    return appError('VALIDATION', 'Enter a valid email address.')
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const created = await userClient.rpc('create_invitation', {
    p_workspace_id: input.workspaceId,
    p_email: input.email,
    p_role: input.role,
  })
  if (created.error) return json({ error: created.error }, 400)
  const invite = created.data as { id: string; email: string; role: 'organizer' | 'member'; expiresAt: string; token: string }

  const delivery = await deliver(request, userClient, supabaseUrl, input.workspaceId, invite)
  return json({ ...invite, delivery })
})

async function deliver(
  request: Request,
  userClient: SupabaseClient,
  supabaseUrl: string,
  workspaceId: string,
  invite: { id: string; email: string; role: 'organizer' | 'member'; expiresAt: string; token: string },
): Promise<Delivery> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const origin = resolveAppOrigin(Deno.env.get('APP_ORIGIN'), request.headers.get('Origin'))
  if (!apiKey || !origin) return 'not_configured'

  try {
    const { data: user } = await userClient.auth.getUser()
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (user.user && serviceKey) {
      const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const { count } = await admin
        .from('invitations')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', user.user.id)
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      if ((count ?? 0) > HOURLY_EMAIL_LIMIT) return 'rate_limited'
    }

    const workspace = await userClient.rpc('get_workspace', { p_workspace_id: workspaceId })
    const summary = (workspace.data ?? {}) as { name?: string; displayName?: string }
    const email = buildInvitationEmail({
      inviterName: summary.displayName ?? '',
      workspaceName: summary.name ?? '',
      role: invite.role,
      link: `${origin}/app/invite/${invite.token}`,
      expiresAt: invite.expiresAt,
    })

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `invitation-${invite.id}`,
      },
      body: JSON.stringify({
        from: Deno.env.get('INVITE_FROM') ?? 'Brie <onboarding@resend.dev>',
        to: [invite.email],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    })
    if (!response.ok) {
      console.error('Resend rejected invitation email', response.status, await response.text())
      return 'failed'
    }
    return 'sent'
  } catch (error) {
    console.error('Invitation email failed', error)
    return 'failed'
  }
}
