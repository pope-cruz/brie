# Slice completion ledger

| Slice | State | Notes |
| --- | --- | --- |
| 01 Sign-in and workspace | Implemented; broader acceptance pending | `create_workspace`, `/app` shell, empty Events |
| 02 Invite and switch | Implemented; broader acceptance pending | Invitation RPCs, accept route, switcher |
| 03 Create event | Implemented; broader acceptance pending | `create_event`, list filters/search |
| 04 Edit / archive / restore | Implemented; broader acceptance pending | Versioned updates and audit entries |
| 05 Assign and complete tasks | Implemented; broader acceptance pending | `save_task`, `set_task_status` |
| 06 Workspace tasks and recover | Implemented; broader acceptance pending | Soft-delete and restore |
| 07 Run of show | Implemented; broader acceptance pending | Segment RPCs and warnings |
| 08 CSV preview | Implemented; broader acceptance pending | `prepare_attendance_import` |
| 09 Commit attendance | Implemented; broader acceptance pending | Idempotent commit and receipts |
| 10 Revert import | Implemented; broader acceptance pending | Overlapping-batch reversion |
| 11 Attendance history | Implemented; broader acceptance pending | History and person detail queries |
| 12 Duplicate event | Implemented; broader acceptance pending | Plan copy, no attendance |
| 13 Workspace admin | Implemented; broader acceptance pending | Settings, roles, transfer |
| 14 Release hardening | In progress | Docs, unit tests, sample CSV, automated public-surface and release-demo browser suites; separate-stack restore, production auth and license still open |

## Verification on 2026-09-12

- 34 unit/component tests pass, including sign-in cooldown, code validation, expired-code feedback, duplicate submissions, and safe return destinations.
- 18 local database checks pass: eight schema smoke checks plus ten real workspace creation, retry, validation, direct-write denial, cross-account isolation, and anonymous-access checks. Database tests roll back their fixtures.
- Production build and lint pass with existing Fast Refresh and bundle-size warnings.
- Live local email OTP, workspace creation, empty Events, sign-out, and signed-out task-link/filter preservation verified in a browser. Desktop and 375px code-entry views inspected without browser errors; mobile Events has no horizontal overflow. Fixed primary link-button text contrast discovered during inspection. A fictional `Brie QA workspace` remains in the local database under `brie-check-20260912@example.test`.
- Sign-in improvements: resend countdown, paste support and focus, actionable errors, safe deep-link return, invitation account switching, cache clearing across auth changes, failed-session retry, and workspace-load error recovery.

Full MVP release acceptance is still pending. The prior “Done” labels overstated verification: table-existence checks are not authorization coverage. See [TESTING.md](TESTING.md) for the initial manual flow, expected results, and remaining release priorities. No migrations were added in this hardening pass; redirect configuration was updated.

## shadcn scheduling and timezone follow-up

- Installed official shadcn Button, Calendar, Popover, Command, Input, Select, Sheet, Checkbox, and Dialog sources. Application actions now use the shadcn button through the existing wrapper. Component tokens/portals stay scoped to Brie; public landing styles are unchanged apart from importing the scoped token file.
- Event create/edit/duplicate and schedule forms share a calendar/time field. Workspace creation/settings and event forms use a searchable timezone picker. Schedule editing uses an accessible Sheet.
- New segments default to the event's local date/start/end. DST choices preserve saved offsets; half-hour transitions and ranges crossing a clock change are handled. Warning acknowledgment is explicit, with an advance warning for times outside the event.
- Verification: 46 tests pass; build and lint pass with Fast Refresh and bundle-size warnings. Browser checked actual Clubfest page, new segment defaults, calendar date selection, timezone search/selection, and 375px layout. No saved user event, segment, or settings data changed in browser verification.
- Ran `npx shadcn@latest mcp init --client codex` and added the suggested MCP entry to Codex's config. Restart Codex to load it. Installed source components work immediately without that restart.

## Edit entry and date entry follow-up

- Edit event is available from the shared event header on every tab and from the event list (desktop and mobile).
- "Ends on the same day" keeps the end date on the typed start date. Changing the start time moves the end time by the same duration, unless that would cross midnight; an end at or before the start suggests unchecking same day.
- Fixed task lists failing once an event had tasks (`0014_task_list_records.sql`): sorting columns were passed into `task_to_json`. Covered by `supabase/tests/task_lists.sql`.
- Verification: 52 unit/component tests and 22 database checks pass; build and lint pass with the existing warnings.

## Permission tests and hardening

- Added database tests: `invitations.sql`, `task_permissions.sql`, `membership_removal.sql`, `attendance.sql`, `function_privileges.sql`.
- Fixed accepting an invitation as a new member, which always failed with "column reference display_name is ambiguous" (`0015_permission_hardening.sql`).
- Revoked execute on internal security-definer helpers (`write_audit`, `event_attendance_count`, `*_to_json`, `require_*`, `remember_request`, and others) from `anon` and `authenticated`. Signed-out visitors could previously write audit entries for any workspace. `function_privileges.sql` fails if a new privileged function is callable without being added to the RPC allowlist. New migrations that add functions must revoke execute from `public, anon, authenticated` before granting it.
- Phones: the event list now has Duplicate and Archive/Restore. Failed archive/restore, segment remove/restore, task restore/remove, and task status changes now show an error instead of failing silently.
- CI (`.github/workflows/ci.yml`) runs lint, unit tests, build, and every migration plus database test on each pull request.
- Verification: 52 unit/component tests and 110 database checks pass; build and lint pass with the existing warnings.

## MVP assessment and editor recovery — 2026-09-13

Rough engineering estimate: **80% toward a release-ready MVP** (judgment, not a measured completion metric). All 13 functional slices have implementations. Release hardening is the remaining slice, and its acceptance work is substantial: full multi-account browser flow, responsive/keyboard checks, concurrent writes and rollback behavior, import capacity, backup restoration, and production auth/setup validation. This estimate is not a claim that 80% of acceptance criteria have passed.

- Pulled and fast-forwarded the working branch to latest main, `68b3c64` (merged permission-hardening PR).
- Fixed failed event loads opening empty edit/duplicate forms. The page now offers retry and a route back to Events; successful retry initializes the form with actual server values.
- Switching between cached event routes now resets the form to the selected event. Background refresh failures preserve unsaved input.
- Added five component regression cases for failed edit/duplicate loads and retries, initial loading, cached-event navigation, and preserving drafts after a failed refresh.
- Verification: 57 app tests and 110 local database checks pass; build and lint pass with existing Fast Refresh and bundle-size warnings. Inspected the unavailable-event editor at desktop and 375px; keyboard activation triggers retry and returns to Events. The browser check used an absent event ID without changing saved event data. The full multi-account browser demonstration remains unautomated.

Next work, in order:
1. Automate the multi-account release demonstration in `TESTING.md`, including mobile task completion and overlapping attendance imports/reversion.
2. Complete the remaining viewport/keyboard acceptance checks and fix failures.
3. Measure 5,000-row imports; exercise simultaneous writes, transaction rollback, clean setup and backup restoration in an isolated stack.
4. Finish production email/redirect setup and the maintainer license decision before release.

## Team workflow and usability — 2026-09-14

Priority agreed with the user: improve team workflows and usability first. Data reliability and release preparation remain separate follow-up work; no database migrations or infrastructure changes were made in this pass.

Implemented:
- Assigned members save task status through the member-permitted command instead of the organizer-only task editor. Other members’ tasks and archived tasks are read-only, with an explanation and fully readable notes.
- Task details use an accessible sheet with keyboard focus containment, Escape/Close handling, return focus, and explicit discard of unsaved changes. Deep-linked tasks close correctly without losing filters. Status controls and filters have accessible names. Long titles and instructions wrap on phones.
- Task saves, removal/restoration, and status changes refresh related lists and overview data. Success feedback no longer covers mobile Save buttons. Empty states reflect filters; Show all tasks clears both personal/status filters. Completed task lists no longer appear as never-created lists.
- Invitation creation explains manual sharing and role capabilities, identifies the recipient, and reports clipboard success/failure with a selectable fallback link. Team loading failures are recoverable instead of showing a false empty list. Role changes/revocation/removal/ownership transfer report results and errors; removal explains consequences before confirmation.
- Confirmation dialogs and mobile navigation trap focus, support Escape, and restore focus; choosing a navigation destination closes the mobile menu. Workspace creation and invitation acceptance refresh the switcher. The current workspace remains selectable while that list refreshes. Workspace creation now explains that display names are shared across workspaces.
- Schedule loading/error states are distinct from an empty schedule. Instructions preserve line breaks and wrap, expansion is exposed to assistive technology, and archived schedules omit editing actions.

Verification:
- 69 app tests pass, including 12 new team-workflow regressions covering member status saves, read-only/archived tasks, retry, deep links, draft protection, filter reset, invitation sharing failure, role-change failure, team-load failure, and removal confirmation/retry.
- Lint and production build pass with existing Fast Refresh and bundle-size warnings.
- Live local owner flow: created a separate QA workspace/event, added an assigned task from the overview shortcut, saved Done and reloaded, created/copied a fictional member invitation. Inspected desktop and 375px task/sheet/team layouts.
- Live local member flow: switched account through the invitation, verified a Mailpit email code, returned to and accepted the invitation; verified member navigation excludes attendance/admin; completed an assigned task in the detail sheet at 375px; reloaded Done filter and confirmed persistence; read full multiline schedule instructions; overview reported no open tasks. Member task and schedule fixtures were prepared through the existing organizer RPCs in the QA workspace, not through a second organizer browser session.
- Mobile menu: Shift+Tab wraps inside it, Escape restores Menu focus, selecting Settings closes it.
- QA fixtures remain in local workspace `Brie workflow QA · Sep 13` (`69423870-4794-4a91-a5aa-540f291ec0c9`), with `Workflow rehearsal`, test tasks/schedule, and fictional member `brie-workflow-member@example.test`. The original display name changed during workspace setup was restored. Browser approval review timed out while restoring the original sign-in; its completion could not be verified.

Remaining team/usability work: a repeatable automated multi-account browser suite; full organizer-role/ownership-transition browser coverage; all five viewports, 200% zoom, reduced-motion and landing baseline checks; remaining attendance screens’ interaction acceptance. These are not marked complete by the passing component suite.

Separate backlogs retained:
- Data reliability: the database-level items below are now verified; full-instance restore/sign-in and target-host capacity remain release checks.
- Release preparation: isolated clean setup, production email/redirect configuration, deployment readiness, and license/asset review.

## Data reliability — 2026-09-14

- Added and locally applied `0016_data_reliability.sql` after taking a database backup. It serializes workspace writes before authorization/version/assignment checks, optimizes attendance preview processing, and allows authorized receipt recovery after preview expiry or event archive. Missing previews no longer bypass receipt authorization. No RPC signature/type changes or frontend changes were needed in this pass.
- Added a repeatable isolated database harness (`npm run test:reliability`) to CI. It replays migrations from scratch using only the local Auth schema and fictional rows. Separate sessions prove overlapping commits, retries, edits, task status saves, archive/demotion/removal races, ownership transfer and reversion.
- Terminated a connection after the second contribution was inserted; every application row matched the pre-commit snapshot afterward. Injected a failure at the final audit write and verified the same rollback, including preview purge and revision updates. Same-preview/key recovery succeeds.
- A 5,000-row overlapping preview previously took 25.458 seconds. Set-based processing reduced the measured new/overlapping previews to 0.223/0.278 seconds and commits to 0.242/0.349 seconds, below the 10-second local target. These are local database measurements, not remote HTTP or browser timings.
- Restored fictional fixtures into a second empty database. Every application row and fictional Auth account matched; owner RPC access and member attendance denial passed; reverted overlapping evidence retained the correct active count.
- Verification: 125 pgTAP checks and 39 additional reliability assertions pass; all 69 app tests, lint and production build pass with existing warnings. The harness cleans up its databases and fixtures. Existing local workspace data was not reset.

Remaining: a full separate-instance Supabase restore including email-code sign-in, target-host HTTP/capacity measurements, and the other release/browser acceptance items above. Database-level restore success is not full disaster-recovery acceptance. Reproduction, hardware, timings and limits are in [DATA_RELIABILITY.md](DATA_RELIABILITY.md).

## Release hardening — 2026-09-15

Worked on a Mac without Docker, Homebrew or the Supabase CLI, so nothing below that needs the database was executed here. Everything that does not need it was run and is reported with its actual result.

Fixed the three application findings from [QA_SEED_CHECKPOINT.md](QA_SEED_CHECKPOINT.md), each with a component regression test that fails on the previous code:
- Duplicate event no longer offers Description and Location fields that `duplicate_event` ignored. The copy explains that description, location, tasks and schedule come from the original and can be edited afterwards. No migration; the RPC contract is unchanged.
- Saving an event (create, edit, duplicate) now seeds the `['event', workspace, id]` cache with the returned record and invalidates the event list, so the header, overview and attendance pages show the new status immediately instead of a stale Draft until refetch.
- Blank start or end fields now say "Enter a start date and time." / "Enter an end date and time." instead of the daylight-saving "does not exist" message.

Added browser automation with Playwright (`@playwright/test` devDependency, `playwright.config.ts`, `tests/e2e/`):
- `npm run test:e2e:public` — landing and sign-in at 1440×900, 1024×768, 768×1024, 375×812 and 320×640 with no horizontal overflow; DESIGN.md control heights (36px desktop, 44px below 768px); 200% zoom; reduced motion disables transitions; keyboard-only submit with focus on the email field and a retained address on failure; visible focus and ≥4.5:1 contrast on the primary control, lede and heading; unauthenticated deep links return to sign-in with the same-origin path; unknown app routes show the unavailable state; foreign return URLs never leave the origin. **Executed here: 18 passed.** Screenshots for each viewport were captured as evidence.
- `npm run test:e2e:release` — the multi-account demonstration from [TESTING.md](TESTING.md) in sixteen serial steps: wrong code, owner workspace creation and reload, event validation and creation, task and segment creation, status edit reflected without reload, organizer and member invitations, member acceptance on a 375px viewport with no privileged navigation and a denied direct `create_event` RPC, assignment and phone completion persisting across reload, full run-of-show reading, organizer capabilities, overlapping imports A/B with receipt totals, reversion keeping Bo and Cy, member seeing only the scalar count, duplicate as a clean draft, cross-event history counting each event once, two-tab conflict, archive/restore, filtered deep link across sign-out, cross-workspace isolation, member removal with revoked access and "Former member" attribution, and a backend outage on reload showing Retry rather than onboarding. Sign-in codes are read from Mailpit's API. **Not executed here: it needs `supabase start`.** It skips itself when Mailpit is unreachable. Its selectors were written from the current component source, and the file type-checks, but the first run on a database-capable machine may still need selector adjustments.
- CI now runs the public suite in the app job and the release suite in a new `browser` job that starts the full local stack.

Verification actually run on this pass:
- 72 unit/component tests pass (69 existing + 3 new); lint and production build pass with the existing Fast Refresh and bundle-size warnings.
- 18 public-surface browser checks pass against the Vite dev server.
- The three new component tests were confirmed to fail against the previous `EventFormPage.tsx` and pass with the fix.

Documented production sign-in email and redirect configuration in [OPERATIONS.md](OPERATIONS.md). No deployment was performed.

Still open for release acceptance, in order:
1. Run `npm run test:e2e:release` on a machine with Docker and the Supabase CLI (or let the new CI job run it) and fix any selector or behavior failures it surfaces.
2. Full separate-instance Supabase restore including email-code sign-in, and HTTP/capacity measurements through the intended host.
3. Configure production SMTP and redirect URLs on the real origin, then verify both the code and link returns.
4. Maintainer license decision and asset/dependency audit (checklist in OPERATIONS.md).

## N1–N5 product follow-up — 2026-09-19

Implemented migrations 0019–0024 and the matching app changes: two-state to-dos; several people per schedule item; opt-in atomic shifts on item and event-start edits; Home schedule; and previewed, atomic schedule paste. N6 had already shipped in 0018. The local stack was backed up to `/private/tmp/brie-before-n-slices-20260919.dump` before applying these migrations. No production migration or deployment was performed.

Verification: 206 unit/component tests pass; lint and production build pass with existing warnings. A fresh migration replay plus pgTAP and 58 isolated reliability assertions pass, including legacy-data backfill, assignment privacy, shift behavior, paste retries/rollback, and Home member scoping. The 17-step local multi-account release browser suite passes, including a new paste/shared-person/shift/Home flow; all 18 public-surface browser checks pass. Production deployment and its separate release checks remain open.
