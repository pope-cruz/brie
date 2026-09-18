# Front-end redesign slices

Implements the 2026-09-18 direction in [PRODUCT.md](../PRODUCT.md#product-shape) and [MVP.md](../MVP.md) sections 4A–4F. The execution contract in [IMPLEMENTATION.md](IMPLEMENTATION.md) still applies: one slice at a time, each a working user outcome with empty/loading/error/mobile states, verified before the next.

Slices R1–R7 use the existing database and RPCs. Anything that needs a migration is collected under "Needs data changes" and is not started until those decisions in MVP.md section 5 are confirmed.

## Status

| Slice | State | Evidence |
| --- | --- | --- |
| R1 One event page | Done 2026-09-18 | Unit tests (`event-phase`, `event-page`); release browser suite 15/16 — test 13 fails on local Supabase clock skew (“JWT issued at future”), unrelated to R1; desktop and 375px screenshots reviewed |
| R5 Day of list | Done 2026-09-18 | Editing: read-only rows, click to edit in place, Start + Length entry with typed shortcuts (`timeInput.ts`), always-present add row, time order. Now/Next labels and Everyone/Mine/person filter (`scheduleView.ts`; URL `?who=`, remembered per workspace, members default to Mine). Unit tests (`time-input`, `schedule`, `schedule-view`); release suite 16/16 including the member Mine/Everyone check at 375px; desktop and 375px screenshots reviewed. Now/Next checked by unit tests only, since the demo event is not today |
| N6 Drop `sort_order` | Done 2026-09-18 | `0018_drop_schedule_sort_order.sql` drops the column and `reorder_segments` (0017 had already merged); list and duplicate order by start, end, creation. 125 pgTAP checks and the from-scratch reliability replay pass |

## Slices on existing data

### R1 — One event page

**Outcome:** an event is one page with Before / Day of / After sections instead of Overview / Tasks / Run of show / Attendance tabs.

**Build:** `EventLayout` renders the header (title, one metadata line, Edit details link, overflow) and the three sections; remove the tab strip and the Overview page. Before embeds the existing event task list; Day of embeds the existing run of show; After shows the attendance summary with Import attendance, View attendees, and View imports links (organizers) or the aggregate line (members). Attendance subpages keep a backlink to the event page. Redirect `.../tasks` and `.../run-of-show` to `#before` and `#day-of`. Phase default scroll (MVP 4D) and the sticky jump bar.

**Acceptance:** every former tab's actions remain reachable; member sees no organizer actions; old URLs land on the right section; each section fails and loads independently; 375px shows one column with only the current phase expanded.

### R2 — Home and navigation

**Outcome:** the sidebar reads Home, Events, People, Settings, and members land on their own to-dos.

**Build:** `/app/w/:w/home` with "Your to-dos" grouped by event (existing workspace task query with assignee = me, status = open), in-place check-off, and "Upcoming events" for organizers. Rename Attendance navigation to People at `/app/w/:w/people` with redirects from `/attendance`. `/app` redirects to Home. Remove workspace Tasks navigation and redirect `/tasks` to Home.

**Acceptance:** Home is scoped to the current user and workspace; empty state links to Events; old bookmarks redirect; mobile drawer shows the new items.

### R3 — Quick create and details panel

**Outcome:** a new event takes a title, date, and times, then opens the event page.

**Build:** New event popover (sheet on mobile) calling the existing `create_event`; Edit details side panel reusing the existing event form fields and validation. Keep the full-page duplicate route. After a start/zone change, offer to shift the schedule only if slice N3 has shipped; otherwise keep the existing "Schedule times stay fixed" note.

**Acceptance:** Enter submits, Escape confirms discard, DST ambiguity still resolved explicitly, focus lands in the first Before row after create.

### R4 — Before as sheet-style rows

**Outcome:** organizers type to-dos like spreadsheet rows; everyone can filter to Mine.

**Build:** rows of checkbox, title, date, person, with notes expanding beneath; persistent add row (Enter saves and starts the next); Tab across cells; save on row blur with Saving/Saved status; typed date shortcuts; paste multiple lines into one confirmed batch of saves; Done collapsed at the end; Everyone/Mine filter. Checkbox maps to Done/Todo; an existing In progress to-do shows unchecked and is not rewritten until N1. Mobile uses a full-screen sheet for editing.

**Acceptance:** ten to-dos entered with the keyboard only; a failed save keeps input with Retry; stale version offers Reload latest; member can check off only their own.

### R5 — Day of list

**Outcome:** the run of show reads as a clean time-ordered list and is entered When / Title / People / Notes.

**Build:** read-first list (time range, title with full notes, person or Everyone); Now/Next labels; overlap and gap text; Everyone/Mine/person filter (members default to Mine) kept in the URL; persistent add row with start prefilled from the previous end and a 30-minute duration; duration and time shortcuts; item panel for edits, duplicate, and remove with Undo and Removed items. Order by start, end, then creation, ignoring `sort_order`; remove Move up/down. People is a single person until N2.

**Acceptance:** ten items entered with the keyboard only; overnight and DST items show correct dates; member reads full notes at 375px; no horizontal scrolling.

### R6 — Day of calendar

**Outcome:** organizers see the day as a time grid, optionally with a column per person.

**Build:** List/Calendar control (hidden below 768px) stored in the URL; grid hours from the earliest to latest item; block height is duration; overlapping blocks share width; Everyone items repeat in each person column; buffers dashed; click block opens the item panel; click empty time opens a new item at that time. No drag.

**Acceptance:** keyboard users can reach every block in time order; same filter as the list; 200 items render without jank.

### R7 — Download PDF

**Outcome:** anyone downloads the run of show for everyone or one person.

**Build:** Download PDF with Everyone or a person (default: current filter); generated in the browser with a PDF library loaded only when used; header, briefing, list, page footers per MVP 4F; items never split across pages. Remove `window.print()` and the print stylesheet once parity is confirmed.

**Acceptance:** same content as the on-screen list for the same filter; identical file in Chrome, Safari, and iOS Safari; no request leaves the browser.

## Needs data changes

Start only after MVP.md section 5 is confirmed.

- **N1 — Two-state to-dos.** Migrate In progress to Todo; simplify status commands and filters.
- **N2 — Several people per schedule item.** Join table replacing `owner_membership_id`, RPC changes, privilege tests; then R5/R6/R7 switch from one person to many.
- **N3 — Shift later items.** One atomic RPC that moves an item and every later item by the same amount; "Also shift later items" on save and after event start changes.
- **N4 — Home schedule.** Query for the signed-in person's schedule items (plus Everyone items) in events over the next 7 days; add "Your schedule" to Home.
- **N5 — Paste schedule rows.** Batch-create RPC with one idempotency key so a pasted schedule is all-or-nothing.
- **N6 — Drop `sort_order`.** Done; see Status.
