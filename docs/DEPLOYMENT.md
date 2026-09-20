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
3. Under **Email Templates**, set both **Magic Link / OTP** and **Confirm signup** to the content of [`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html). It contains `{{ .Token }}` for the six-digit code and `{{ .ConfirmationURL }}` for the one-time link. Set an appropriate subject such as “Your Brie sign-in code.” These dashboard changes are separate from the local template files.
4. Under **Emails → SMTP Settings**, connect a real sender, verify its sending domain with the provider, and set the sender address/name. The built-in Supabase mailer is restricted and is unsuitable for real users. Store SMTP credentials in Supabase, never in Vercel or Git. Review Auth email rate limits and OTP expiry; the app waits 60 seconds before resend, while the local OTP expiry is one hour.
5. From the deployed origin, request a code at `/app/sign-in`. Verify the code in the form. Sign out, request another code, and open the email link. Both must establish a session under `/app`. Repeat for a newly invited address and confirm that the link returns to `/app/invite/<token>` after sign-in. Brie invitation links are copied by the workspace owner; Brie does not email them.

After the first Vercel deployment gives you its assigned `*.vercel.app` origin, add that exact HTTPS origin to the Auth redirect list and use it for the first sign-in check. Before switching to a custom domain, add the final HTTPS origin to the redirect list, set Site URL to the final `/app` URL, and repeat the code/link checks on the final domain. Remove obsolete origins when no longer needed.

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
```

This function is restricted from browser roles. Monitor job failures. Configure database backups and retention appropriate to the real data, and rehearse a restore into a separate project or instance with actual email-code sign-in. [OPERATIONS.md](OPERATIONS.md) has the data recovery and scoped erasure notes.

Before inviting real users, run the [release demonstration](TESTING.md) on the deployed origin with fictional data: new owner sign-in and workspace creation; organizer/member invitations; member permission boundaries; event/task/schedule; attendance import and reversion; direct deep links; sign-out and return. Verify the production SMTP sender and final domain, and record the deployed Git commit plus migration list. The local CI workflow checks code and migrations but does not deploy them.

For later releases: back up production, apply and verify new migrations, deploy the matching frontend build, then repeat the focused sign-in and workflow checks. If a frontend deployment fails, use Vercel's deployment history to return to the previous build. A frontend rollback does not roll back database migrations, so keep migrations compatible with the previous build until the release is stable.

## References

- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations) and [deployment environment management](https://supabase.com/docs/guides/deployment)
- [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), and [API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Cron](https://supabase.com/docs/guides/cron) and [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Vercel Vite SPA routing](https://vercel.com/docs/frameworks/frontend/vite), [Git deployments](https://vercel.com/docs/git), and [environment variables](https://vercel.com/docs/environment-variables)
