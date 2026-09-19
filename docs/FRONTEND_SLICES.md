# Front-end redesign slices

Implements the 2026-09-18 direction in [PRODUCT.md](../PRODUCT.md#product-shape) and [MVP.md](../MVP.md) sections 4A–4F. The execution contract in [IMPLEMENTATION.md](IMPLEMENTATION.md) still applies: one slice at a time, each a working user outcome with empty/loading/error/mobile states, verified before the next.

Slices R1–R7 use the original database and RPCs. The data changes N1–N6 follow the decisions in MVP.md section 5.

## Status

| Slice | State | Evidence |
| --- | --- | --- |
| R1 One event page | Done 2026-09-18 | Unit tests (`event-phase`, `event-page`); release browser suite 15/16 — test 13 fails on local Supabase clock skew (“JWT issued at future”), unrelated to R1; desktop and 375px screenshots reviewed |
| R2 Home and navigation | Done 2026-09-18 | Sidebar is Home, Events, People (organizers), Settings (owner). `/app` and workspace switches land on Home: “Your to-dos” (open, assigned to me, unclosed events, overdue first) grouped by event with in-place check-off, row Retry, and refresh on conflict; organizers also see the next five upcoming events. Events opened from Home return there. `/tasks` redirects to Home, `/attendance` to `/people` with the query kept. Unit tests (`home`); release suite 16/16 and public suite 18/18; desktop and 375px screenshots reviewed. “Your schedule” waits on N4; the workspace Tasks page component is no longer routed |
| R3 Quick create and details panel | Done 2026-09-18 | New event on the event list opens a popover (bottom sheet on phones) with title, zone as text with Change, and the start/end range; Enter submits, Escape closes or asks before discarding typed input, and repeated fall-back times still need an explicit choice. Creating opens the event with focus in the Before add row. `/events/new` shows the same short form as a page. Edit details opens a 400px side panel (full screen on phones) with every field, saved against the version that was opened; `/events/:e/edit` redirects to `?details=1`. A removed lead shows as Former member and can't be picked again. The schedule note stays until N3. Unit tests (`event-panels`, `before-list`); release 16/16 and public 18/18 (with #9's retry applied locally); popover and panel screenshots reviewed |
| R4 Before as sheet-style rows | Done 2026-09-18 | Organizers on desktop edit rows in place (checkbox, To-do, Date, Person, Notes beneath); a row saves when focus leaves it, on Enter, or when a person is picked, with Saving/Saved, Retry that keeps input, and Reload latest on conflict. Typed dates (`dateInput.ts`: fri, 10/17, Oct 17, tomorrow). Add row keeps date and person and refocuses; pasting several lines confirms one batch with per-line request keys and Retry remaining. Done collapses at the end; Everyone/Mine in `?todos=`; Remove with Undo. Members and archived events get read rows, checking off only their own. Phones: read rows and a full-screen sheet for organizers. The old task sheet and workspace Tasks page are removed. Unit tests (`date-input`, `before-list`); release suite 16/16 including ten keyboard-only to-dos; public 18/18; desktop screenshot reviewed. In progress to-dos show unchecked and keep their status until N1 |
| R6 Day of calendar | Done 2026-09-18 | List/Calendar switch in `?view=calendar` (hidden below 768px, where the list always shows) and “Column per person” in `?cols=people`. The grid runs from the earliest item's hour to the latest's, 96px an hour; block height is duration; overlapping blocks share width (`calendarLayout.ts`); Everyone items repeat in each person column; a former member gets their own column; multi-day events get a column per day; overnight items run past midnight; items named Buffer are dashed; Now/Next show on blocks. Blocks sit in one layer in time order so Tab walks the day in order. Clicking a block opens an item panel (editor for organizers, full notes for members) that shares the list row's editing logic (`useSegmentEditor`); clicking empty time or Add item opens a new item there. Unit tests (`calendar-layout`, including 200 items; `schedule` calendar cases); release 16/16 and public 18/18 with #9 applied locally; desktop screenshot reviewed. No drag, per MVP |
| R7 Download PDF | Done 2026-09-18 | Download PDF (every role) asks Everyone, Mine, or a person, defaulting to the current filter, and builds the file in the browser with pdfmake (MIT; Roboto covers accented Latin, Greek, Cyrillic), loaded only on first use. Title, date, venue, zone, briefing, then the same rows as the list (shared label helpers in `scheduleView.ts`), a header on later pages, and the footer “Welcome night · Mine: Sam · page 2 of 3 · generated …”. Items stay on one page unless their notes are longer than a page. `window.print()` and the print stylesheet are removed. Unit tests (`run-of-show-pdf`, including a 40-item layout that checks every item lands on one page); release suite checks both downloads send nothing to the backend; PDFs reviewed as images. Not yet opened on Safari or iOS |
| R5 Day of list | Done 2026-09-18 | Editing: read-only rows, click to edit in place, Start + Length entry with typed shortcuts (`timeInput.ts`), always-present add row, time order. Now/Next labels and Everyone/Mine/person filter (`scheduleView.ts`; URL `?who=`, remembered per workspace, members default to Mine). Unit tests (`time-input`, `schedule`, `schedule-view`); release suite 16/16 including the member Mine/Everyone check at 375px; desktop and 375px screenshots reviewed. Now/Next checked by unit tests only, since the demo event is not today |
| N6 Drop `sort_order` | Done 2026-09-18 | `0018_drop_schedule_sort_order.sql` drops the column and `reorder_segments` (0017 had already merged); list and duplicate order by start, end, creation. 125 pgTAP checks and the from-scratch reliability replay pass |
| N1 Two-state to-dos | Done 2026-09-19 | `0019_two_state_tasks.sql` converts In progress to Todo and rejects the retired value at the table boundary. The client presents only Todo/Done. |
| N2 Several people per item | Done 2026-09-19 | `0020_schedule_people.sql` migrates the former owner to a private join table, validates each person in the new save command, and returns all people in schedule reads. List, Mine, calendar columns, and PDF show shared assignments. |
| N3 Shift later items | Done 2026-09-19 | `0021_shift_schedule.sql` adds atomic, opt-in commands to shift later items by an edited item's end-time change and to shift the full schedule by an event start change. `0024_shift_following_items.sql` includes later overlapping items in time order. Both editors offer an unchecked choice. |
| N4 Home schedule | Done 2026-09-19 | `0022_home_schedule.sql` returns Everyone and the caller's items from unclosed events in the next seven days. Home groups them by event and shows Now/Next from the event-zone clock. |
| N5 Paste schedule rows | Done 2026-09-19 | `0023_paste_schedule.sql` saves up to 200 validated rows in one idempotent transaction. The sheet previews tab/CSV rows, people matches, overlaps, and outside-hours warnings before confirmation. Fresh migration replay, 58 reliability assertions, 206 app tests, and 17 release browser steps passed across N1–N5. |

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

The decisions in MVP.md section 5 are confirmed. N1–N5 were implemented in migrations 0019–0024; N6 was completed in 0018.

- **N1 — Two-state to-dos.** Existing In progress rows become Todo; the retired enum label remains only for compatibility with existing RPC signatures and is rejected by a table constraint.
- **N2 — Several people per schedule item.** `schedule_segment_people` replaces `owner_membership_id`; an empty set means Everyone.
- **N3 — Shift later items.** The checkbox is opt-in on each item-time or event-start save.
- **N4 — Home schedule.** Member-scoped schedule for the next seven days.
- **N5 — Paste schedule rows.** Preview and atomic save with one batch request key.
- **N6 — Drop `sort_order`.** Done; see Status.
