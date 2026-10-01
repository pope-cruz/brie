# Deployment plan and manual runbook

This is a manual path for a **Vercel static frontend + managed Supabase** installation. Brie serves the public page at `/` and the organizing app at `/app`. The browser calls Supabase directly; there is no Brie server or Edge Function to deploy. `vercel.json` makes direct visits and reloads of `/app/...` routes serve the React app.

No production project, domain, SMTP account, or deployment is configured by this repository. Record the actual project IDs, domains, owners, and backup policy in a private operator record, not in Git.

## Plan

| Stage | Owner action | Done when |
| --- | --- | --- |
| 1. Release check | Run the checks below and resolve the open release items | Local build, database tests, release browser flow, license and asset decision are recorded |
| 2. Staging | Create a separate Supabase project and stable staging site | A new user and an invited teammate can sign in by code and link, then complete the release demonstration |
| 3. Production backend | Create the production Supabase project, apply migrations, configure Auth/SMTP, backups and cleanup | Schema is current; real inbox receives the code; backup and restore procedure is rehearsed |
| 4. Production frontend | Import the repo into Vercel, set production browser values, attach the final domain | `/` and direct `/app/...` URLs load over HTTPS |
| 5. Go live | Repeat sign-in, invitation, permission and attendance checks on the final origin | The operator signs off and records the deployed commit and project settings |

Use separate Supabase projects for staging and production. If Vercel Preview deployments will run the app, point Preview variables at staging. A stable staging domain is easier to allowlist than every temporary preview URL. Do not let a preview build point at production data.

## 1. Prepare and check the release

From the repository root:

```bash
npm ci
npm run lint
npm test
npm run build
```

On a machine with Docker and the Supabase CLI, use a **disposable** local stack to replay every migration and run the database and browser checks in [SETUP.md](SETUP.md) and [TESTING.md](TESTING.md). `supabase db reset` erases that local stack's saved data:

```bash
supabase start
supabase db reset
supabase test db
npm run test:reliability
npm run test:e2e:release
```

The release browser suite requires Mailpit and may skip when the stack is unavailable. Confirm that it actually ran and passed. Finish the open acceptance work in [SLICE_STATUS.md](SLICE_STATUS.md), especially a full separate-instance restore with email-code sign-in, target-host import timing, and the license/asset decision. Do not mistake the local database-only restore rehearsal for a complete production recovery test.

## 2. Create the Supabase project and apply the schema

1. In the [Supabase dashboard](https://supabase.com/dashboard), create a project for the target environment. Save its project reference, database password, project URL, and **publishable** API key in the private operator record. The browser may use a publishable key even though the current variable is named `VITE_SUPABASE_ANON_KEY`; a legacy `anon` key also works. Never use a secret or `service_role` key in a `VITE_` variable.
2. Install or update the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). In this repo, sign in and link to the **target** project. Check the project reference before any push:

   ```bash
   supabase login
   supabase link --project-ref <target-project-ref>
   supabase migration list
   supabase db push --dry-run
   ```

3. Review the pending migration list. On a new project it should include this repo's `supabase/migrations/` files through `0024_shift_following_items.sql`. For an existing project, take a recoverable backup first. Apply only after confirming the target:

   ```bash
   supabase db push
   supabase migration list
   ```

4. Do not run `supabase db reset` against a hosted project. Do not use `--include-seed` for production. Do not edit the hosted schema by hand; add a migration to the repo for future changes. The local `supabase/config.toml` Auth settings and local HTML templates are **not** installed on a managed project by `db push`; configure them in the dashboard as described next.

If migration history differs from the repository, stop and compare it before using any repair command. One person should push migrations at a time.

## 3. Configure Auth and sign-in email

In the target Supabase project's **Authentication** settings:

1. Under **Providers → Email**, enable email sign-in and allow new users to sign up. Brie creates accounts through `signInWithOtp` and then creates a workspace in the app. Keep email verification enabled for production and test a brand-new account as well as a returning account. The local stack has different confirmation settings.
2. Under **URL Configuration**, set **Site URL** to `https://<exact-app-host>/app`. Add a redirect URL that matches `https://<exact-app-host>/app/sign-in?return=...`; the current local configuration uses `https://<exact-app-host>/app/sign-in?**`. Add the plain `/app/sign-in` URL if the dashboard requires it. Use the exact trusted host, including any staging host; avoid a broad wildcard over unrelated domains. The app constructs the redirect from `window.location.origin`, and the final route may include an invitation token or query string. Test an emailed link from a nested route to confirm the allowlist works.
3. Under **Emails → SMTP Settings**, connect a real sender, verify its sending domain with the provider, and set the sender address/name. New Free projects cannot edit hosted email templates while using Supabase's built-in sender. The built-in sender is restricted and unsuitable for real users. Store SMTP credentials in Supabase, never in Vercel or Git.
4. Under **Email Templates**, set both **Magic Link / OTP** and **Confirm signup** to the content of [`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html). It contains `{{ .Token }}` for the six-digit code and no clickable verification link, so email security scanners cannot consume the link before the user sees it. Set an appropriate subject such as “Your Brie sign-in code.” These dashboard changes are separate from the local template files. Set the hosted Email OTP length to six; `supabase db push` does not apply either setting. Review Auth email rate limits and expiry; the app waits 60 seconds before resend.
5. From the deployed origin, request a code at `/app/sign-in` and verify it in the form. Repeat for a newly invited address and confirm that sign-in returns to `/app/invite/<token>`.

After the first Vercel deployment gives you its assigned `*.vercel.app` origin, add that exact HTTPS origin to the Auth redirect list and use it for the first sign-in check. Before switching to a custom domain, add the final HTTPS origin to the redirect list, set Site URL to the final `/app` URL, and repeat the code/link checks on the final domain. Remove obsolete origins when no longer needed.

### Invitation email

Owners' invitations are emailed by the `send-invitation` Edge Function through Resend. It creates the invitation with the same `create_invitation` command the app uses, so only owners can send. Without it, the app still creates the invitation and asks the owner to copy the link.

1. Create a Resend API key with sending access only. Use a verified sending domain; Resend's `onboarding@resend.dev` sender only delivers to the Resend account's own address.
2. Set the function's secrets. `APP_ORIGIN` is the app's HTTPS origin used in the emailed link; the function never trusts a request's origin outside local development.

   ```bash
   supabase secrets set RESEND_API_KEY=<key> APP_ORIGIN=https://<exact-app-host> INVITE_FROM="Brie <invites@<verified-domain>>"
   ```

3. Deploy it with `supabase functions deploy send-invitation`.
4. Invite an address you can read and confirm the email arrives and its link opens `/app/invite/<token>` on the app host. The function skips email (but still returns the link) after 30 invitations from one owner in an hour; failures are logged under **Edge Functions → send-invitation → Logs**.

### Assistant (MCP) server

The `mcp` Edge Function lets assistants such as Claude read a workspace's plans with an assistant key created on the app's **Assistant access** page. It needs no secrets beyond the project's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and it can only call `assistant_check` and `assistant_call`. Set the optional `APP_ORIGIN` secret (the same value used for invitations) so a proposed draft comes back with a full review link. Apply migrations through `0063_event_plan_drafts.sql` first.

1. Deploy it without the gateway JWT check, because it authenticates Brie assistant keys, not Supabase sessions: `supabase functions deploy mcp --no-verify-jwt`.
2. Create a read-only key in the app, then from a terminal run the Claude Code command the app shows (`claude mcp add --transport http brie https://<project>.supabase.co/functions/v1/mcp --header "Authorization: Bearer brie_…"`). Ask it to list upcoming events. The call should appear under **Recent assistant activity**.
3. Revoke the test key and confirm the next request fails with 401. Calls are logged under **Edge Functions → mcp → Logs**. The function never logs keys or tool results.

## 4. Deploy the frontend with Vercel

1. In [Vercel](https://vercel.com/new), import this Git repository. Set **Framework Preset** to Vite and **Root Directory** to the repository root. Use `npm run build` as the build command and `dist` as the output directory. The repo's Node checks use Node 24; select Node 24 for the Vercel project as well.
2. Add these project environment variables for the **Production** environment before the build:

   | Name | Value | Exposure |
   | --- | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<target-project-ref>.supabase.co` | Public browser value |
   | `VITE_SUPABASE_ANON_KEY` | Target project's publishable key (`sb_publishable_...`) | Public browser value |

   Set Preview to the staging project's values if previews need working sign-in. Vite embeds `VITE_` values into the built JavaScript; changing them in Vercel requires a new deployment. Never add a Supabase secret/service-role key, database password, or SMTP credential to this frontend project.
3. Deploy the selected commit. Vercel's Git integration can deploy later commits automatically; that does **not** apply database migrations or copy Auth settings. Coordinate schema changes before merging frontend code that requires them.
4. Open the assigned HTTPS URL. Check `/` and `/app/sign-in`, then paste a nested app URL into a fresh tab and reload it. The rewrite in `vercel.json` must serve the SPA while preserving the URL.
5. Add the final domain under Vercel **Domains**, complete its DNS instructions, wait for HTTPS to work, and update Supabase Auth URLs as above. Recheck on the final host.

If you host the static `dist/` directory elsewhere, configure that host to serve `index.html` for `/app` and `/app/*`, retain the public `/` page, and set the two `VITE_` variables **at build time**. Do not copy the local `.env.local` into a deployed site.

## 5. Operate and verify

In the Supabase dashboard, create a daily **Integrations → Cron** SQL job that runs:

```sql
select public.purge_expired_previews();
select public.purge_expired_import_sources();
```

These functions are restricted from browser roles. Monitor job failures. Configure database backups and retention appropriate to the real data, and rehearse a restore into a separate project or instance with actual email-code sign-in. [OPERATIONS.md](OPERATIONS.md) has the data recovery and scoped erasure notes.

Before inviting real users, run the [release demonstration](TESTING.md) on the deployed origin with fictional data: new owner sign-in and workspace creation; organizer/member invitations; member permission boundaries; event/task/schedule; attendance import and reversion; direct deep links; sign-out and return. Verify the production SMTP sender and final domain, and record the deployed Git commit plus migration list. The local CI workflow checks code and migrations but does not deploy them.

For later releases: back up production, apply and verify new migrations, deploy the matching frontend build, then repeat the focused sign-in and workflow checks. If a frontend deployment fails, use Vercel's deployment history to return to the previous build. A frontend rollback does not roll back database migrations, so keep migrations compatible with the previous build until the release is stable.

## Catching production up (as of 2026-09-30)

On 2026-09-30 the hosted project had migrations only through `0025`, while the repository had `0026`–`0063` (attendance export and mixed imports, attendance history, venues, venue comparison, planning contract, assistant keys, and draft plans). If Vercel deploys `main`, screens that call the newer RPCs fail until the schema catches up. Order matters, because a frontend rollback does not undo migrations:

1. Back up production. Then run `supabase migration list --linked` and confirm that only `0026`–`0063` are pending.
2. `supabase db push`, then run `supabase migration list --linked` again.
3. Add `select public.purge_expired_import_sources();` to the daily cron job (section 5) if it isn't there yet.
4. Deploy the assistant server with `supabase functions deploy mcp --no-verify-jwt`, and optionally set the `APP_ORIGIN` secret for review links.
5. Deploy or promote the matching frontend. Then, with fictional data, sign in, open Venues, Drafts, and Assistant access, create and revoke a key, and check that a revoked key gets 401.

## References

- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations) and [deployment environment management](https://supabase.com/docs/guides/deployment)
- [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), and [API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Cron](https://supabase.com/docs/guides/cron) and [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Vercel Vite SPA routing](https://vercel.com/docs/frameworks/frontend/vite), [Git deployments](https://vercel.com/docs/git), and [environment variables](https://vercel.com/docs/environment-variables)
