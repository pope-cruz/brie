# Local setup

The public landing page at `/` is unchanged. The application lives under `/app`.

## Prerequisites

- Node 20+
- A local Docker engine. This repo is set up with **Colima** + the Docker CLI (not Docker Desktop). `supabase start` needs that engine running.
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

You do **not** need a project on supabase.com for local development.

## Install (first time on this Mac)

```bash
brew tap supabase/tap
brew install docker colima supabase/tap/supabase
colima start --cpu 4 --memory 8
docker context use colima
```

## Start the local stack

From the repo root, with Colima already running:

```bash
cp .env.example .env.local   # only if .env.local does not exist
npm install
supabase start
```

Copy the printed `API_URL` and `ANON_KEY` into `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in Vite variables.

If Colima was stopped (reboot), start it first:

```bash
colima start
docker context use colima
supabase start
```

```bash
supabase db reset
npm run dev
```

Open [http://127.0.0.1:5199](http://127.0.0.1:5199) for the landing page and [http://127.0.0.1:5199/app/sign-in](http://127.0.0.1:5199/app/sign-in) for the app. Use that IPv4 address; the dev server binds `127.0.0.1` on port 5199. If the port is already taken, stop the old `npm run dev` first.

Sign-in uses a 6-digit email code. Local messages appear in Mailpit at [http://127.0.0.1:54324](http://127.0.0.1:54324). The message also includes a one-time link; it must land on `/app` so the session can be stored. Do not use the landing page (`/`) as the auth redirect.

## Commands

| Purpose | Command |
| --- | --- |
| App | `npm run dev` |
| Typecheck and production build | `npm run build` |
| Lint | `npm run lint` |
| Unit tests | `npm test` |
| Recreate the database | `supabase db reset` |
| Generate types (optional) | `supabase gen types typescript --local` |
| Database tests | `supabase test db` |
| Simultaneous writes, rollback, import timing and disposable restore | `npm run test:reliability` (Python 3 required) |
| Apply pending migrations without resetting saved data | `supabase migration up --local` |
| Browser checks that need no database (viewports, keyboard, contrast) | `npx playwright install chromium` once, then `npm run test:e2e:public` |
| Multi-account release demonstration in a browser (needs the local stack) | `npm run test:e2e:release` |
| Purge expired import previews | `select public.purge_expired_previews();` |

## First-use path

1. Sign in with a fictional email and the Mailpit code.
2. Create a workspace.
3. Invite a teammate by copying the link (Brie does not send invitation email).
4. Create an event, assign a task, add a run of show, then import `supabase/sample-attendance.csv`.

## Updated sign-in redirects

The code flow returns to the original application route, including invitations and filters. Email links now target `/app/sign-in?return=…`; the local redirect allowlist includes this pattern. To apply changes to `supabase/config.toml`, restart the local stack with `supabase stop` followed by `supabase start` (do not use `db reset` for this). For a hosted installation, allow the equivalent sign-in URL on your exact trusted app origin. Verify both email-code and email-link returns after changing auth settings.

For the recommended first complete test run and expected outcomes, see [TESTING.md](TESTING.md).
