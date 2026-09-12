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
| 14 Release hardening | In progress | Setup/ops docs, unit tests, sample CSV |

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
