# Autonomous session plan: finish venues, then the MCP planning surface

Drafted 2026-09-30 against `main` at `5f14b42`. This covers roadmap step 3's remaining gap and all of step 4 in [POST_MVP_ROADMAP.md](POST_MVP_ROADMAP.md).

## Where things stand

- Roadmap steps 1 (mixed attendance), 2 (history and export) and most of 3 (venue directory, booking tracker, request preparation) are merged. CI is green on `main`.
- **Step 3 gap:** its "done when" says an organizer can *compare suitable venues*. The venue list is a plain list of names, types, capacities and addresses (`src/app/features/venues/VenueListPage.tsx`), with no filtering, comparison, or fit against an event.
- **Step 4 has not started:** there is no Brie MCP server, no assistant-readable planning contract, no assistant credentials, and no draft-plan review.
- **Production is behind:** the hosted project `dqpsxgaempqylblujwvv` has migrations through `0025`. `0026`–`0052` (12 migrations) are applied locally only. If Vercel deploys `main`, the live attendance export, mixed import, and venue screens call RPCs that do not exist in production. This is **not** part of the autonomous session. The maintainer should back up production and run `supabase db push` first (see DEPLOYMENT.md).

## Session rules

1. One branch and one PR per slice: `claude/<slice-name>`, stacked on the previous slice when it depends on unmerged work. Open each PR and let CI run. **Do not merge.**
2. Every slice follows the established template: a numbered migration (`0060+` for this track), pgTAP tests in `supabase/tests/`, new RPCs revoked from `public, anon, authenticated` and added to the `function_privileges.sql` allowlist, `src/app/data/api.ts` and `types.ts`, UI, unit/component tests, and updated `SLICE_STATUS.md`, `POST_MVP_ROADMAP.md`, and `ARCHITECTURE.md`.
3. Gate before each PR: `npm run lint`, `npm test`, `npm run build`, `supabase test db`, `python3 tests/reliability/run.py`, and `npm run test:e2e:release` when a user flow changed. Report real results in the ledger. Do not claim anything you did not run.
4. Local stack only. Never run `supabase db push`, `supabase db reset` against the linked project, or change hosted Auth, Vercel, Resend, or DNS settings. Back up the local DB (`supabase db dump`) before applying new migrations to the stack with saved QA data, or use a disposable reset.
5. Fictional data only (`*@example.test`). Attendee contact data is never exposed to the assistant surface.
6. Stop and write a status note instead of guessing when: a design decision in "Open decisions" below lacks an answer, CI fails twice for the same unclear reason, or a slice needs a production or secret change.

## Slices

### S1 — Venue comparison (finishes roadmap step 3)

- The venue list gets filters for type, minimum capacity, accessibility, and an "include archived" toggle it already has, plus a sortable compact table on desktop and cards at 375px.
- "Compare" on 2–4 selected venues shows capacity, cost, lead time, accessibility, equipment, restrictions, and notes in aligned rows, with past-event count and last-used date.
- From an event, "Find a venue" checks each venue against an expected headcount entered on the page (not stored on the event: the smaller change), its lead time against the event date, and other events linked to it at the same time. Unsuitable venues show why instead of disappearing.
- DB: extend `list_venues` (or add `compare_venues`) to return usage counts and last-used date. Test that members can read and cross-workspace IDs are denied.
- **Done when:** the step 3 criteria in the roadmap can be demonstrated end to end, and step 3 is marked complete.

### S2 — Planning read contract

- A versioned JSON contract (`contract: "brie.event-plan/1"`) from security-definer RPCs: `get_event_plan(event_id)` (event, venue and booking status, to-dos without assignee emails, run of show, attendance totals and first-time/repeat counts only) and `search_prior_events(workspace_id, query, limit)` (title/description match plus venue and date filters, returning event summaries).
- No attendee names or emails. Members get the same read access they already have in the app (no attendance detail).
- Tests: stable key set (a unit test that locks the TypeScript type against a fixture), role matrix (owner, organizer, member, non-member), archived events, and cross-workspace denial.
- Document the contract in `docs/ARCHITECTURE.md`.

### S3 — Assistant access tokens

- `assistant_tokens` table: workspace, the member who created it, label, scope (`read` or `read_draft`), SHA-256 hash only, created/expires/last-used/revoked timestamps. Plaintext is shown once.
- Settings → Assistant access: owners and organizers create, list, and revoke their own tokens; owners can revoke any token in the workspace. Members cannot create tokens in the first version.
- Resolution RPC callable only by `service_role`: `resolve_assistant_token(hash)` returns workspace, user, scope, and **current** role. Demotion, removal, expiry, or revocation takes effect immediately.
- `assistant_actions` audit table: token, tool name, arguments summary (no contact data), result status, timestamp. Surfaced in Settings as recent activity.
- Tests: expired, revoked, demoted, removed, cross-workspace, and token hash never readable by `authenticated`.

### S4 — Read-only MCP server

- Supabase Edge Function `supabase/functions/mcp/` using the MCP TypeScript SDK's stateless Streamable HTTP transport. `Authorization: Bearer <assistant token>`.
- Tools: `list_events`, `get_event_plan`, `search_prior_events`, `list_venues`, `get_venue`, `get_attendance_summary` (totals only, owner/organizer tokens only). Each call resolves the token, checks scope and current role, calls the S2 RPCs, and writes an `assistant_actions` row.
- Tool descriptions state the workspace boundary and that contact data is unavailable.
- Tests: Deno tests for the handler (bad or missing token, scope denial, tool listing), plus an integration script that runs `supabase functions serve` against the local stack and calls each tool as owner/member/other-workspace tokens. Add it to the CI `browser` job (or a new `functions` job).
- Docs: connecting from Claude Code with `claude mcp add --transport http brie <url>/functions/v1/mcp --header "Authorization: Bearer …"`, and the Operations notes for deploying the function later (a maintainer step).

### S5 — Draft event plans and review

- `event_plan_drafts` table: workspace, token/user, status (`pending`, `accepted`, `discarded`), proposed event fields, proposed to-dos (no assignees, due dates as offsets), proposed run of show, **assumptions** (list of strings), **citations** (prior event IDs used), created/decided timestamps.
- MCP tool `create_event_plan_draft` (scope `read_draft`). It validates cited event IDs are in the same workspace and that nothing includes assignments, contacts, bookings, or publication.
- Brie UI: "Drafts from assistant" list and review page showing assumptions, citations linking to prior events, and the proposed plan. An organizer can edit before accepting. **Accept** creates a Draft-status event with its to-dos and schedule in one transaction through a new `accept_event_plan_draft` RPC (reusing existing task and segment validation), with an audit entry. **Discard** keeps the record.
- Tests: acceptance is atomic (late failure rolls back), idempotent on retry, denied to members and other workspaces, and never assigns people.

### S6 — Acceptance scenario and wrap-up

- Seed two fictional past "founder dinner" events with to-dos, run of show, venue, and attendance. A scripted MCP client asks for "Plan a 40-person founder dinner based on our last two dinners" by calling `search_prior_events`, `get_event_plan` ×2, then `create_event_plan_draft`. The release browser suite then reviews and accepts the draft and checks the resulting event, cited events, and activity log.
- Cross-workspace and member-role tests across the whole MCP surface.
- Mark roadmap step 4 complete, with the production deploy steps (migrations, function deploy, secrets) listed as maintainer actions.

## Decisions (confirmed by the maintainer on 2026-09-30)

| Decision | Choice |
| --- | --- |
| Credential model for the MCP server | Workspace-scoped assistant tokens (S3). OAuth can replace them later without changing the tools. |
| Who may create tokens | Owners and organizers; members later. |
| Where the server runs | Supabase Edge Function next to `send-invitation`. |
| Expected headcount for venue fit | A filter on the Find a venue page, not a stored event field (smaller change; S5 drafts record headcount as an assumption). |
| Merge policy | Open PRs only; the maintainer merges. |
| Scope if time runs short | S1–S4 are a complete read-only release; S5–S6 can follow. |

## Kickoff prompt

> Read `docs/AUTONOMOUS_PLAN_MCP.md` and follow its session rules. Start the local Supabase stack, confirm the gate passes on `main`, then implement slices S1 through S6 in order, one stacked PR each. Update the ledger after every slice. Stop and leave a status note in the ledger if you hit a stop condition.
