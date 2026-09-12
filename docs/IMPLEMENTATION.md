# Brie implementation plan for GPT-5.6 Sol

## Execution contract

Implement one slice at a time in the order below. Each slice includes its minimal schema/policy, query/command, screen, states, and verification. Do not build the whole database first or a frontend made of permanent mocks. Keep unrelated refactors out of the slice. This is a plan for Sol to execute later; no tasks, deployments, or coding agents have been started.

Read [PRODUCT.md](../PRODUCT.md), [MVP.md](../MVP.md), [DESIGN.md](../DESIGN.md), and [ARCHITECTURE.md](ARCHITECTURE.md) first. Inspect actual current code and repository instructions before changing files. Existing `src/App.tsx`, marketing components, assets, and typography are protected. If routing requires a new entry, mount the existing landing unchanged at `/`.

For every slice:

1. State its user-visible outcome, dependencies, bounded changes, and acceptance checks. Reuse prior primitives; add only what the slice needs.
2. Make additive migrations, explicit authorization, and typed command/query wrappers. Regenerate database types. Avoid shared schema changes unrelated to this outcome.
3. Complete hierarchy, layout, actions, empty/loading/error states, and mobile behavior from the screen specification. No unexplained disabled buttons or dead-end links to unbuilt features: omit navigation until its destination is ready.
4. Run existing build/lint, targeted database tests, and the relevant browser flow. Use real local data for permissions and import tests. Record actual evidence and any unverified limitation.
5. Inspect a desktop and 375px mobile rendering; check keyboard focus for new controls. Broaden viewport checks at the release slice. Keep landing screenshots unchanged after shell/routing/style work.
6. Hand off a concise summary: changed behavior, migration/setup steps, checks and results, remaining limitations, next slice. Do not claim a passing check that was not run. Do not add deployment, integrations, extra views, or a redesign without a new scope decision.

If a slice cannot fit in one focused change, split it at a working user outcome (for example save one segment before adding restore), not “all backend” and “all frontend.” Intermediate slices may expose a smaller coherent feature set. By release, every specification is complete.

## Ordered slices

### 01 — Enter Brie and create a workspace

**Depends on:** none. **User outcome:** verified email-code sign-in → workspace creation → real empty Events page.

**Build:** separate lazy `/app` entry; scoped tokens and minimal shell; Supabase local configuration, SMTP development mailbox, profiles/workspaces/memberships migration; owner creation RPC with request idempotency; auth guard and sign-out. Keep routing at `/` visually unchanged. Only Events navigation is needed now. Write local environment/setup instructions.

**Acceptance:** fresh account creates exactly one workspace/owner even on retry; sign-out clears data; unauthenticated direct workspace route redirects safely; owner lookup cannot see a second workspace. Sign-in, verification, and empty list work on phone. Existing landing build and desktop/mobile reference comparison pass.

### 02 — Invite and switch workspaces

**Depends on:** 01. **User outcome:** owner creates email-bound Member invitation; matching teammate joins and can switch between accessible workspaces.

**Build:** invitation table/RPCs, acceptance route, copy link and expiration states, Team settings minimal list, workspace switcher and return-path handling. Reveal offered Organizer/Member roles; authorize invitations only for owner. Revoke/recreate tokens without storing plaintext.

**Acceptance:** wrong email, expired/revoked token, repeated accept, existing membership, and concurrent accept are handled; no double membership or role replacement. Switching clears workspace cache before next workspace paints. Member cannot create an invitation through a direct request.

### 03 — Create and find an event

**Depends on:** 02. **User outcome:** organizer creates an event and sees its persisted overview and event-list row.

**Build:** events table, create RPC, query, New event form, title/metadata overview, list sorting/search/pagination and Upcoming/Past/All filters. Zone-aware start/end validation and optional active lead. Add primitives for fields, buttons, tables, and state regions as used.

**Acceptance:** valid event survives reload; end-before-start and DST-invalid times rejected; events from another workspace remain unavailable; member sees no New event action and direct create is denied. Long titles and empty filters fit mobile. Test dates straddling midnight.

### 04 — Edit event lifecycle safely

**Depends on:** 03. **User outcome:** organizer edits details/status, archives, and restores an event.

**Build:** edit form with expected version, archive/restore commands, Archived list, status labels/banners, audit entries, permissions. Retain stale draft on conflict. Add proper menu/confirmation primitives.

**Acceptance:** concurrent editing cannot silently overwrite; archive changes default visibility and blocks mutations until restore; completed/canceled filter rules match spec. Date changes do not move future schedule data implicitly. Restore returns event without losing metadata. Member direct updates denied.

### 05 — Assign work and complete it

**Depends on:** 04. **User outcome:** organizer creates a task, assigns teammate; that member marks it done from the event on a phone.

**Build:** tasks table, narrow save/status commands, Tasks event tab, single-assignee picker, due date, three statuses, detail panel and event overview task preview/counts. Handle unassigned and failed status rollback. Task creation request key prevents retry duplicates.

**Acceptance:** assigned member changes only status; changing someone else’s task or smuggling title/assignee changes is denied. Done state survives reload and totals update. Two edits conflict visibly. Empty/overdue/undated task states and full-screen mobile editor work.

### 06 — Find my work and recover removed tasks

**Depends on:** 05. **User outcome:** teammate finds own open work across events; organizer can remove and restore an erroneous task.

**Build:** workspace Tasks route/navigation using shared task component; event column/picker; filters, 50-row server pagination, closed-event toggle; soft removal, Undo, Removed items disclosure and restore. Saved filters in URL.

**Acceptance:** Me filter is scoped to current user/workspace; closed events excluded by default; removal adjusts counts without destroying restore capability. Empty Me view offers Show all. Browser Back preserves filters; mobile filters/rows remain readable.

### 07 — Prepare the run of show

**Depends on:** 06. **User outcome:** organizer creates and edits timed segments; teammates read a chronological mobile schedule.

**Build:** schedule table and commands, tab/list/panel, owner selection, instructions, expansion, deterministic time sorting, overlap/out-of-range warning acknowledgement, removal/restore. Overview gets schedule preview. Refetch-on-focus and manual Refresh with update timestamp.

**Acceptance:** overnight and DST cases show dates/zones correctly; overlapping segments are possible after warning; editing one does not shift another; concurrent save conflict retained. Member can read full instructions but cannot mutate. No drag-only actions or horizontal mobile table.

### 08 — Review a CSV before recording attendance

**Depends on:** 07. **User outcome:** organizer picks a local CSV, maps columns, and gets a trustworthy server-validated preview.

**Build:** attendee/preview/batch/contribution/revision schema with read-denying defaults, preview RPC and creator-only access, CSV parser, Choose/Map/Review workflow, row outcomes, limits, expiry. Introduce Attendance tab only when this flow has a working preview; do not claim records are saved until slice 09.

**Acceptance:** fixture cases reconcile totals; no raw file or ignored columns transmitted/stored; invalid UTF-8/malformed quotes/oversize/header-only data get actionable errors. Member and other-workspace organizer cannot preview/read PII. Preview does not change actual attendance. Mapping and review work on mobile. Document this temporary preview-only checkpoint clearly in development.

### 09 — Commit reviewed attendance exactly once

**Depends on:** 08. **User outcome:** organizer confirms a preview, receives a receipt, and sees people recorded for the event.

**Build:** transactional commit, idempotency/preview uniqueness, membership/event locking and revision check, unique attendee normalization, contribution writes, receipt route, event People and Imports views, safe aggregate for members. Remove preview-only limitation. Purge consumed preview payloads, not receipt IDs.

**Acceptance:** new/already-recorded/duplicate/invalid counts match committed effects; skipped invalids require acknowledgment. Retry, concurrent import, stale preview, forced transaction failure, and timeout recovery cannot double count or partially commit. Member can see scalar overview count but cannot access names/emails/contributions. Seeded 5,000-row run meets measured budget or limits are adjusted transparently.

### 10 — Correct an import without losing other evidence

**Depends on:** 09. **User outcome:** organizer reviews an import’s impact and reverts it; overlapping batches retain their attendance.

**Build:** reversion impact query/command, receipt confirmation, Active/Reverted status and audit entry; event revision increment; invalidation of related counts and future history queries. Draft cleanup command and expired preview recovery.

**Acceptance:** A={Ana,Bo}, B={Bo,Cy}; reverting A leaves {Bo,Cy}. Repeat reversion no-ops. Stale impact preview requires renewed review. Archived event rejects reversion until restore. Failed reversion changes nothing. UI accurately distinguishes no imports from only reverted imports.

### 11 — Review attendance across events

**Depends on:** 10. **User outcome:** organizer searches workspace history and opens a person’s attended events.

**Build:** permission-scoped history/person queries, date filters, prefix search, stable pagination, detail route, counts from active distinct contributions, history sidebar item for privileged roles. Show email beside name; no ranking or CSV export.

**Acceptance:** same person in two events counts twice; repeated batches for one event count once; reversion updates detail/list; archived and canceled records remain visible. Filters use event-local date rather than import timestamp. Ordinary member/other workspace cannot query detail or totals. Long emails and filtered empty states work on phone.

### 12 — Reuse an event plan

**Depends on:** 11. **User outcome:** organizer duplicates an existing event into a clean draft for another date.

**Build:** duplicate form/transaction and event menu action; elapsed schedule offsets, durations, copied instructions and tasks, ownership/date/status resets. Source may be archived since this is reading a plan and creating a new event; new copy is unarchived. Snapshot source version for consistent copying.

**Acceptance:** no copied attendance/batches/audit entries; task status Todo, assignee/lead Unassigned, due dates cleared; schedule follows new start with explicit zone/date labels. Out-of-range segments warn. Retry creates one copy; source event remains unchanged.

### 13 — Hand over workspace administration

**Depends on:** 12. **User outcome:** owner updates workspace settings, removes a departing teammate, and transfers ownership safely.

**Build:** full General/Team settings, role changes/removal, atomic ownership transfer, former-member labels and Unassigned filter semantics, cache clearing on revoked access. Protect last owner. Document exactly which teammate fields each role can read.

**Acceptance:** concurrent transfers leave one owner; former owner becomes organizer; removed member loses queries/mutations immediately; assignment during removal cannot grant access. Historic attribution remains; rejoin does not reclaim assignments. Zone-default change leaves existing event instants/zones unchanged. Copy-link failure and long emails handled.

### 14 — Make the complete MVP releasable

**Depends on:** 13. **User outcome:** a new operator can run Brie and a team can complete the entire workflow using persistent data.

**Build:** production/self-host instructions, SMTP/redirect setup, migration/upgrade instructions, fictional seed fixtures, sample CSV, preview cleanup schedule, backup/restore and scoped erasure runbooks, license decision checklist, accessible unavailable/offline-error states, complete responsive/keyboard pass. Keep telemetry off by default. This slice verifies and fixes; it must not introduce a second product scope.

**Acceptance:** clean environment setup, migration replay, backup restore demonstrated; all build/lint/targeted integration/E2E checks pass. Run MVP release demonstration with two workspaces and three roles. Inspect five DESIGN.md viewports, 200% zoom, reduced motion, contrast, stale save, empty states, slow network and expired session. Compare landing baseline. Record actual performance for fixture scale and any constraints. No deployment or publication unless separately authorized.

## Suggested first execution prompt

> Use GPT-5.6 Sol to implement only slice 01 in docs/IMPLEMENTATION.md. Read PRODUCT.md, MVP.md, DESIGN.md, and docs/ARCHITECTURE.md first. Preserve the approved landing exactly. Deliver a working email-code sign-in and atomic workspace creation flow under /app with a real empty Events page, scoped styling, authorization tests, and desktop/mobile verification. Report what passed, anything blocked, and the next slice. Do not implement slice 02 or deploy.

## Completion ledger

At implementation time, maintain a small table in the task handoff or a dedicated status file: slice, state, migration IDs, verification evidence, remaining blockers. A slice is done only when its user outcome and security/data invariants work. Do not mark the overall MVP done while any route is a mock, attendance totals are client-only, role checks are UI-only, or deployment setup cannot be reproduced.
