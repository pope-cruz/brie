# Browser QA checkpoint — 2026-09-15

Paused to conserve the user's usage. This is partial browser testing, not release acceptance.

## Saved fictional data

- Account: `brie-seed-owner@example.test`, display name Alex Morgan (QA). Sign in using the local Mailpit code.
- Workspace: Campus Collective · QA Seed (`5681bd9f-19f7-43c9-9b8d-967ce7e8cd8f`).
- Fall Welcome Night: September 25, 2026, 18:00–20:00 America/New_York; Draft. Event `dd968101-5ecf-4c9a-a5f3-5dd6e038b2c5`.
- Community Project Showcase: October 2, 2026, 18:00–20:00 America/New_York; Planned. Event `92ed462f-0259-401d-bfed-7383407f2bc7`.
- Six tasks per event (12 total); original includes Todo/In progress/Done and owner assignment. Duplicate resets to Todo/unassigned.
- Two schedule segments per event (four total), with multiline instructions; intentional parallel quiet-room support.
- Showcase attendance receipt verified Active: 8 added, 0 already recorded, 0 skipped.
- Three reusable fictional CSV files in `tests/fixtures/qa-seed/`. Only showcase.csv has been imported.

## Browser checks performed

- Fresh email-code sign-in, onboarding, workspace creation.
- Invalid event end-before-start rejected without losing draft; corrected event saved.
- Task creation with notes, assignment and different statuses; saved data survived reopening the browser.
- Schedule defaults use event dates/times; overlap requires explicit acknowledgment.
- Duplicate shifted schedule dates and reset task states/ownership; no attendance copied.
- Event edit persisted Planned after reload.
- CSV mapping, preview of eight rows, commit and matching receipt.

## Findings to investigate

Update 2026-09-15: findings 1–3 are fixed in `EventFormPage.tsx` with regression tests in `tests/unit/event-form.test.ts` (see [SLICE_STATUS.md](SLICE_STATUS.md)). Finding 4 stays unreproduced. The "Next browser work" list below is now automated in `tests/e2e/release-demo.spec.ts`, pending a run on a machine with the local stack.

1. Duplicate form allowed editing Description, but the created copy retained the source description. Later ordinary edit corrected it. Reproduce and check other editable duplicate fields.
2. After ordinary event edit, overview and attendance header still showed Draft; reload showed Planned. Check query invalidation and whether stale display persists beyond refetch.
3. Empty start fields produced a misleading nonexistent-local-time message rather than required-fields guidance.
4. In-app browser native date/time automation was unreliable; a tab crashed while manipulating a schedule time stepper. Do not attribute the browser crash to application code without reproduction. A fresh tab recovered saved data.

## Next browser work

1. Import welcome-a.csv into Welcome Night: expect 8 accepted, 1 duplicate, 1 invalid requiring acknowledgment.
2. Import welcome-b.csv: expect 4 new and 4 already recorded, 12 distinct total. Revert A: expect 8 remain (Eli through Lina). Verify cross-event history.
3. Exercise fictional member/organizer invitation flows, assignment completion, ownership transition, and workspace isolation.
4. Test archive/restore, removed task/segment recovery, stale saves, and draft discard.
5. Complete responsive/keyboard acceptance; no mobile viewport checks performed in this pass.

Existing user workspaces were not modified. No application code changes or database resets were performed.
