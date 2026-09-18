# Brie MVP specification

Status: implementation-ready plan, 2026-09-12. Revised 2026-09-18 for the one-page event, Home, and run-of-show direction in [PRODUCT.md](PRODUCT.md#product-shape). Sections 4A–4I describe the revised structure; decisions still open are in section 5.

## 1. Scope and outcome

Brie lets a small organizing team create an event, assign the work before it, prepare the run of show for the day, import actual attendance from a CSV, and look up participation across past events. The organizing unit is a private workspace. Every event belongs to exactly one workspace; every active workspace member can see its operational plans.

**The release demonstration:** an owner creates a workspace and invites a teammate; an organizer quick-creates an event and assigns a to-do; the teammate checks it off from Home on a phone; the organizer adds a run of show, the teammate reads their own items under Mine and downloads their PDF, and the organizer imports an attendance file; a second event establishes repeat attendance; reverting the first import adjusts history correctly. A second workspace cannot access any of those records.

Design envelope, to validate with fixtures: 2–30 active teammates, up to 500 events and 10,000 attendee identities per workspace, 200 to-dos and 200 schedule items per event, 5,000 data rows / 2 MiB per CSV. These are explicit MVP limits, not measured capacity claims. UI queries paginate; do not fetch the entire workspace to render a screen.

### Included

- Email-code sign-in, workspace creation and switching, email-bound invitation links, and three roles.
- Event creation/editing, draft/planned/completed/canceled status, archive/restore, and duplication for reuse.
- One page per event with Before (to-dos), Day of (team briefing and run of show), and After (attendance) sections.
- To-dos with a title, optional date, one optional person, optional notes, and a done checkbox.
- Schedule items with a title, start and duration, any number of people (none means everyone), and optional notes; shown as a list or a one-day calendar, filterable to Mine, and downloadable as a PDF for everyone or one person.
- Home: each person's open to-dos and upcoming schedule items across events.
- Reviewed CSV import of people who actually attended, duplicate handling, import receipts, and whole-batch reversion.
- Event attendance list, workspace attendance history, and individual participation detail.
- Basic workspace name/time-zone settings and team membership administration.
- Self-host instructions, migrations, sample data, automated authorization/import tests, and a demonstrated backup restore.

### Excluded

Public event pages, RSVPs, ticketing/payments, QR scanning, live check-in, email campaigns, announcements, push notifications, calendar/chat/CRM integrations, native apps, offline writes, realtime co-editing, AI assistants, file attachments, rich-text editors, budgets, recurring-event engines, dependencies/Gantt/Kanban, custom roles, private subteams, custom fields, member rankings, analytics dashboards, a template library/editor, live show-calling or countdown timers, per-department schedule columns, and public share links for a run of show (share the PDF instead).

Existing landing copy mentions reusable templates. MVP reuse is **Duplicate event**, which copies the plan; a dedicated template system remains later work. Do not change the approved landing copy to resolve that distinction. Imported attendees do not become user accounts or workspace members.

### Roles

| Capability | Owner | Organizer | Member |
| --- | --- | --- | --- |
| Read events, all to-dos, run of show, team names; download any run-of-show PDF | Yes | Yes | Yes |
| Create/edit/archive/duplicate events; manage to-dos, schedule, and team briefing | Yes | Yes | No |
| Check off or reopen own to-dos | Yes | Yes | Yes |
| Import/revert attendance; see attendee names/emails/history | Yes | Yes | No |
| See aggregate attendance count on the event page | Yes | Yes | Yes |
| Invite/revoke/remove members, change roles, workspace settings | Yes | No | No |
| Transfer ownership | Yes | No | No |

Exactly one owner. Ownership transfer to an active teammate is atomic and demotes the former owner to organizer. A member cannot edit a to-do’s title, date, person, or notes. Authorization is enforced at the data boundary, including direct requests, not merely by hiding controls. Removed memberships immediately lose access on the next request. Members see “Ask an organizer” where an empty workflow requires privileged action.

### Product rules

- Default event status is Draft. Organizer explicitly chooses Planned, Completed, or Canceled. Time passing does not change status. Planned requires valid start/end; all events require title, start/end, and time zone at creation.
- Archive is separate from status, reversible, and hides an event from default lists. Archived events and their to-dos/schedule/attendance are read-only until restored. History still includes archived events with active attendance.
- Completed events remain editable for cleanup. Canceled events keep previously recorded attendance but reject new imports until moved to another status. Never infer absence or delete attendance when status changes.
- Event date/time uses the event’s IANA time zone; workspace time zone supplies the initial default. Show the zone wherever a person enters or reads schedule times. To-do dates are calendar dates interpreted in the event zone; no due time or reminders.
- A to-do is overdue when its date is before today in the event zone and it is not done; do not flag to-dos of completed/canceled/archived events as operationally overdue.
- Schedule order is time order: start, then end, then creation. There is no manual reordering; moving an item means changing its time. A new item starts where the item before it ends.
- Changing a schedule item’s start or duration moves only that item unless the organizer chooses “Also shift later items” when saving, which moves every later item by the same amount. The choice is offered per save and is never the default.
- Duplicate event requires a new title and start/end. Copy description/location, team briefing, to-do titles/notes, and schedule titles/notes/durations/offsets. Reset status to Draft, to-dos to not done, lead and all people to none, to-do dates to none; copy no attendance, imports, or audit records. New schedule times are calculated from the new start by elapsed offsets; show an out-of-range warning if the chosen event end is earlier than copied schedule items.
- No hard-delete event action in MVP. Individual to-dos and schedule items support reversible removal via Undo or a “Removed items” disclosure in their section; organizer restores them. Attendee identity correction uses batch reversion and corrected reimport; no fuzzy identity merge UI.

### Release criteria

- First-time organizer can create a usable event, to-do, and schedule without seed data or training, and can enter a ten-item schedule using only the keyboard.
- Import preview reconciles every nonblank row into one outcome; confirmed totals exactly match committed data.
- Two simultaneous saves cannot silently overwrite each other. Two retries cannot duplicate an import.
- A volunteer checks off an assigned to-do and reads all of their schedule notes at 375px width using touch, and at desktop using only a keyboard.
- The run-of-show PDF matches the on-screen list for the same filter, never splits an item across pages, and opens identically on desktop and phone.
- Every specified screen has implemented empty/loading/error/permission states. No sample numbers appear in real empty workspaces.
- Landing visuals and content are unchanged at agreed desktop/mobile screenshot baselines.

## 2. Core flows and inventory

Route convention: `w` and `e` below are immutable UUIDs, never trusted as authorization. Workspace and event titles are display labels. `/app` redirects to the last accessible workspace’s Home, or onboarding. Use browser history for back navigation; preserve filters in query parameters.

| Flow | Steps | Destination / success |
| --- | --- | --- |
| Start a workspace | Sign in → verify code → name workspace + choose zone | Home; owner membership created atomically |
| Join a team | Open invite → authenticate matching email → accept membership | Invited workspace Home, clear role label |
| Plan | Events → New event (title, date, times) → event page → Before → Day of | Persisted plan with people and a time-ordered schedule |
| Carry out assigned work | Home → check off to-do | Done persists; event progress updates |
| Follow event day | Home or event page → Day of → Mine | Own items with Now/Next; optional PDF |
| Share the schedule | Event page → Day of → Download PDF → Everyone or a person | PDF file generated in the browser |
| Record attendance | Event page → After → Import attendance → choose CSV → map → review → confirm | Import receipt and updated distinct attendance count |
| Correct a mistaken import | Event page → After → Imports → receipt → Revert → confirm impact | Active contribution removed; other batches preserved |
| Remember | People → search/date filter → person | List of distinct attended events with context |
| Reuse | Event menu → Duplicate → choose new dates → create | Draft with copied plan and reset ownership/status |

| Screen | Route |
| --- | --- |
| Sign-in and code verification | `/app/sign-in` |
| Onboarding / create workspace | `/app/new-workspace` |
| Invite acceptance | `/app/invite/:token` |
| Shared workspace shell/sidebar | Every authenticated workspace route |
| Home | `/app/w/:w/home` |
| Event list | `/app/w/:w/events` |
| Event quick create | Popover on the event list; no route |
| Event details edit / duplicate | Panel on the event page; `.../events/:e/duplicate` for duplication |
| Event page (Before / Day of / After) | `.../events/:e`, with `#before`, `#day-of`, `#after` anchors and `?view=list|calendar&who=all|me|:membership` for Day of |
| Event attendees; Imports subview | `.../events/:e/attendance?view=people|imports` |
| Attendance import / receipt | `.../events/:e/attendance/import`, `.../attendance/imports/:batch` |
| People (attendance history) | `/app/w/:w/people` |
| Attendee detail | `/app/w/:w/people/:person` |
| Workspace settings / team | `/app/w/:w/settings?tab=general|team` |
| Unavailable, forbidden, session expired | In-route state; unknown route gets app 404 |

No dashboard, inbox, or standalone attendee CRM screen. Home is a list of the signed-in person’s work, not a dashboard. The only calendar grid is the event-day view of the run of show. Old routes (`.../tasks`, `.../run-of-show`, `/app/w/:w/tasks`, `/app/w/:w/attendance`) redirect to their new location.

## 3. Shared screen contract

All screens below inherit this contract; per-screen states supplement it. Visual dimensions and state tokens are in [DESIGN.md](DESIGN.md).

- **Hierarchy:** one h1, optional single-line contextual description, one primary action for the current job, then filters and the working content. Event pages have no tabs. One page carries the title, metadata, and Before / Day of / After sections; attendance subpages keep the event title and a backlink to the event page.
- **Loading:** render the stable shell immediately after authentication; skeleton only the pending region with its eventual geometry and `aria-busy`. Never show a false zero or empty state before data resolves. Refetch preserves rows and labels them updating.
- **Errors:** inline explanation + Retry for failed reads; retain form values on failed writes. A session expiration returns to sign-in with a same-origin return path; do not persist attendance payloads in local storage. Show safe navigation when the record is inaccessible, without confirming another workspace’s record exists.
- **Save feedback:** ordinary forms explicitly Save/Cancel. Sheet-style rows on the event page save when focus leaves the row or on Enter, show “Saving…” then “Saved” beside the row, and keep failed input in place with Retry. Row status updates may be optimistic with rollback and inline error. Import, role changes, and reversion are pessimistic. Stale version errors offer Reload latest and retain the unsaved input for comparison; no silent last-write-wins.
- **Mobile:** 320px minimum width; below 768px replace sidebar with a labeled menu drawer, stack forms, and turn operational tables into labeled rows. Tables that truly need column comparison can scroll in a labeled region. Actions remain visible without hover; touch targets at least 44px.
- **Search:** all MVP search fields use case-insensitive prefix matching on the named fields (title/location, or name/email). A match at the start of either field qualifies; substring and fuzzy search are out of scope. Apply the query before pagination and distinguish filtered zero results from first-use emptiness.
- **Accessibility:** links navigate, buttons act, native labels precede fields, errors reference their fields, dialogs trap/restore focus, Escape closes dismissible overlays, and background content is inert while a drawer/dialog is open. Screen changes focus the h1; validation focuses the first error. Never use color alone for status.

## 4. Detailed screens

### A. Workspace sidebar and shell

**Hierarchy/layout:** fixed 224px desktop sidebar with pale neutral surface and 1px right border. Top 56px contains a small `brie` wordmark and workspace switcher. Middle navigation: Home, Events, People (owner/organizer only). Bottom: Settings (owner only), current user name, account menu. Inside event pages, retain workspace navigation; the event page uses sections, not tabs or a second event tree. No badge unless it carries a defined actionable count; MVP ships without sidebar counts.

**Actions:** switch to another accessible workspace; Create workspace; open nav destinations; sign out from account menu. Workspace switch clears prior-workspace query caches before painting the destination. Current item uses a filled neutral selection plus medium weight and `aria-current=page`; event child routes keep Events selected. An item opened from Home preserves Home as its return location.

**Empty:** user with no membership sees onboarding without a dummy workspace sidebar. Switcher with one workspace shows its name and Create workspace; no “no results” filler.

**Loading/error:** workspace name and nav skeleton until permissions resolve; never briefly flash owner controls. Failure offers Reload workspace and Sign out. Membership revoked routes to accessible workspace selection/onboarding.

**Mobile:** 56px top bar with Menu, workspace name, account action. Drawer is 280px or viewport minus 32px, whichever is smaller; closes after navigation, traps focus, restores it to Menu. No collapsed icon rail and no duplicate bottom navigation. Tablet 768–1023px uses a 200px sidebar; desktop content remains usable with wrapping controls.

### B. Event list

**Hierarchy/layout:** h1 “Events,” short workspace context, right-aligned New event, which opens quick create (section C). Segmented filters Upcoming / Past / All / Archived, then search. Flat table: Event (title + optional location), When (date/time + zone), Status, Lead, To-dos (done/total). Lead is optional active workspace teammate, not a separate permission role. Rows are 64px; title is a real link and trailing menu is a separate button. No hero stats.

**Behavior/actions:** Upcoming defaults to unarchived Draft/Planned with end at or after now, earliest start first. Past includes unarchived events ended before now or explicitly Completed/Canceled, latest start first. These tabs are intentionally disjoint; All includes every unarchived event. Archived is separate, latest start first. Search is case-insensitive title/location within current filter; URL stores query and page. Fifty results per page with total and previous/next. Menu: Edit details, Duplicate, Archive; archived menu: Restore. Member gets navigation only. Archive confirmation states read-only effect and history retention.

**Empty:** first workspace: “Plan your first event” + New event; member: “Your team hasn’t added an event yet.” Filter empty: “No upcoming events” or “No events match ‘…’” + Clear filters / All. Archived empty: “Archived events will appear here.”

**Loading/error:** six row skeletons under actual headers; keep filter toolbar stable. On failed pagination retain last successful rows with Retry. Archive/restore error stays beside the affected row.

**Mobile:** stacked rows show title, date/time, status, to-do fraction; lead/location in secondary line or row detail. Filters wrap; search fills width; New event becomes compact text button. Menus have visible 44px targets. No whole-page horizontal scroll.

### C. Event quick create, details, and duplication

**Quick create:** New event opens a small popover anchored to the button (a full-screen sheet on mobile) with three fields: title (required, 120 characters), date, and start–end time. Time zone shows as text with the workspace default and a Change link; lead, location, and description are not asked. Create event saves a Draft and opens the event page with focus in the first Before row. Enter submits; Escape closes after confirming discard of typed input.

**Details panel:** Edit details on the event page opens a 400px side panel (full-screen sheet on mobile) with title, description (plain text, 2,000), location (200), start/end, IANA time zone, lead, and status. Validate end after start; explicitly resolve ambiguous daylight-saving times by choosing offset and reject nonexistent local times. Changing event start or zone does not silently move schedule items: after saving, offer “Shift the schedule by the same amount” once, with the number of items affected. Removed lead remains labeled “Former member” but cannot be chosen for a new assignment.

**Duplicate:** full-page form at `.../events/:e/duplicate` asking a new title and start/end, pre-filled with the source title ending “copy.” Summarize what resets before Create copy (product rules). Prevent double submission; navigate only after transaction success; confirm discarding dirty input.

**Loading/error:** errors inline beside the field; preserve input after save failure. Not found returns a safe event-list link.

### D. Event page

**Hierarchy/layout:** breadcrumb Events / event; event title (wraps); one metadata line: status, date and time range with zone, location, lead; an Edit details button and an overflow menu (Duplicate, Archive). Below, three sections in fixed order, each with an h2 and a one-line summary:

- **Before** — “3 of 5 done.” To-dos (section E).
- **Day of** — event date and zone. Team briefing, then the run of show (section F).
- **After** — organizers see the distinct attendee count, Import attendance, View attendees, and View imports; members see the aggregate count only (“84 attendees recorded”) or “Attendance hasn’t been recorded.”

No tabs, preview widgets, or KPI tiles. A compact sticky jump bar (Before · Day of · After) appears after the header scrolls away; it contains links, not tabs.

**Phase default:** before the event day, open at the top. On the event day in the event zone, open scrolled to Day of. After the event ends, open scrolled to After for organizers and to Day of for members. Opening never moves focus except to the h1.

**Actions:** section-local only: add to-do, add schedule item, edit briefing, import attendance, download PDF. Archived events show a banner explaining Restore to edit; canceled events show the status without a destructive tone.

**Empty:** each section teaches locally: “Add the work your team needs to do before the event,” “Build the schedule for event day. Include setup, program, and cleanup,” “Attendance hasn’t been imported.” Members see explanatory text without unavailable actions.

**Loading/error:** header, and each section, load and fail independently; a failed section shows Retry and never a false zero.

**Mobile:** one column. The section for the current phase is expanded; the others collapse to their h2 and summary line and expand on tap. The metadata line wraps; Edit details sits in the title action row.

### E. Before (to-dos) and Home

**Before layout:** a sheet-style list with four columns: done checkbox, To-do (title, 200), Date (optional), Person (one optional active teammate). Notes (2,000 characters) expand beneath a row on click or Space on the row’s notes toggle. Order: not done with overdue dates first, then by date, then undated in creation order; done items collapse into “Done (3)” at the end. Filter: Everyone / Mine.

**Sheet-style entry (organizers, desktop):** the last row is always an empty “Add a to-do” row. Typing a title and pressing Enter saves it and starts another; Tab moves across fields; Escape reverts the current row. Date accepts typed shortcuts (“fri,” “10/17”) and shows the resolved date. Pasting several lines into a title cell creates one to-do per line after a confirmation that states the count. Remove is in the row menu with Undo; removed items stay restorable from “Removed items.”

**Members:** read-only rows; they can check off or reopen their own to-dos only. A removed person displays “Former member” and no longer counts as Mine.

**Home (`/app/w/:w/home`):** h1 “Home.” Two lists, each grouped by event with the event title as a link: “Your to-dos” (not done, across unarchived Draft/Planned events, overdue first, then by date) and “Your schedule” (your schedule items, plus items with no people, for events in the next 7 days, in time order, with Now/Next labels on the event day). Checking off a to-do works in place. Organizers additionally see “Upcoming events” (next 5 by start) as plain rows. No counts, charts, or greetings.

**Empty:** Before: “Add the work your team needs to do” for organizers. Mine filter: “Nothing assigned to you” + Show everyone. Home: “Nothing assigned to you yet” with a link to Events.

**Loading/error:** row skeletons; check-off is optimistic with rollback and inline Retry on that row. Concurrent reassignment while a member checks off rejects the change and refreshes. A row being typed in never loses input after a conflict; offer Reload latest beside it.

**Mobile:** rows show checkbox and title, then person and date as secondary text; notes expand beneath. Organizers edit through a full-screen sheet with the four fields; no inline cell editing below 768px. Targets at least 44px.

### F. Day of (team briefing and run of show)

**Team briefing:** plain text (4,000) above the schedule for arrival time, meeting point, contacts, and event-wide notes. Organizers edit in place with Save/Cancel; members read it. Included at the top of every PDF.

**Fields:** a schedule item has four fields only: When (start time and duration), Title (120), People, and Notes (4,000). End time is derived and shown. People is any number of active teammates; none means Everyone. The date is the event date and is not asked unless the event spans more than one day, when a day picker appears. There are no types, priorities, colors, or custom columns; a buffer is an item named “Buffer,” drawn dashed.

**List view (default):** time-ordered rows: time range (tabular numerals), title with notes shown in full beneath, people (“Everyone” when none). Overlaps and gaps show as text on the later row (“Overlaps Panel,” “10-minute gap before”). Items outside event hours are allowed and labeled. A “Now” label on the current item and “Next” on the following one derive from the wall clock in the event zone, never a live-sync claim; nothing auto-scrolls.

**Sheet-style entry (organizers, desktop):** the last row is an empty add row whose start is prefilled with the previous item’s end and duration with 30 minutes. Typing a title and pressing Enter saves and starts the next row; Tab moves across When, Title, People, Notes. Duration accepts “15,” “1h,” or “1:30.” Start accepts “6,” “6:30p,” or “18:30” and resolves in the event zone. Saving a changed start or duration offers “Also shift later items” (product rules). Pasting rows with tab- or comma-separated columns (time, title, person, notes) previews the parsed items and unmatched people before creating them.

**Calendar view:** a one-day time grid (one column per day for multi-day events) where block height is duration; hours run from the earliest item to the latest, not midnight to midnight. “Column per person” splits the grid into a column for each person with items, with Everyone items repeated in each column. Clicking a block opens the item panel; clicking empty time opens a new item at that time. Drag to move or resize is not in the MVP. Calendar is desktop and tablet only; below 768px the view control is hidden and the list is shown.

**Who filter:** Everyone / Mine / a named person. Mine shows items with you plus Everyone items. Members default to Mine; organizers default to Everyone. The choice is kept in the URL and in local storage per workspace.

**PDF:** Download PDF asks Everyone or a person (default: the current filter) and generates a PDF in the browser: event title, date, zone, location, the team briefing, then the list view for that filter with page headers and footers (“Welcome night · Mine: Sam · page 2 of 3 · generated Oct 18, 4:05 PM EDT”). Items never split across pages. Available to every role. No server storage and no share link.

**Editing an item:** rows are read-only. Clicking a row’s title (or a calendar block) turns that row into its editor with the same four fields and Save/Cancel; Enter saves, Escape cancels, and only one row is open at a time. The row menu offers Edit, Duplicate (prefills the add row to start when the original ends), and Remove. Removal is restorable from “Removed items.”

**Empty:** “Build the schedule for event day” + Add item, helper “Include setup, program, and cleanup.” Members see “The schedule hasn’t been added yet.” Mine with no items: “Nothing on the schedule for you” + Show everyone.

**Loading/error:** five fixed-height skeleton rows; refetch on focus with Last updated + Refresh; stale edits offer Reload latest while keeping input; no realtime or offline indicators.

**Mobile:** list only, one column: time range first, then title, people, and full notes. Who filter and Download PDF stay in the section header. Organizers add and edit through the full-screen item sheet. No horizontal scrolling.

### G. Event attendance and import receipts

**Hierarchy/layout:** the event page’s After section links to this subpage (`.../attendance`), which keeps the event title and a backlink to the event page: heading, distinct active attendee total, Import CSV. Local switch People / Imports. People columns Name, Email, Recorded in (latest active batch date); searchable by name/email, 50-row pagination. Imports columns file label, imported at, imported by, rows added, status Active/Reverted; latest first. Counts describe distinct people, not file rows.

**Actions:** People opens attendee detail; Imports opens receipt with totals and link back to people. Receipt lists aggregate accepted/skipped/duplicate outcomes and uploader/time; rejected row details are available only in the preview and are not retained after commit. Revert import is an explicit secondary destructive action, requiring confirmation with recalculated number of attendance records that disappear and number retained through other active batches. Reverted receipt remains visible, read-only. Correct mistakes with revert → corrected file → new import. No raw file download or individual attendance editing in MVP.

**Empty:** People: “No attendance recorded” + Import CSV. If only reverted imports exist: “No active attendance records” and View imports. Imports: “Your imports will appear here.” Search empty has Clear search.

**Loading/error:** independent count/list skeletons; batch reversion shows “Reverting…” and blocks repeat action. If confirmation impact is stale, refresh the impact and ask the product user to confirm the updated result. Failed receipt load preserves navigation. Receipt of an expired draft directs to restart import.

**Mobile:** People becomes name/email rows with secondary batch date; Imports becomes file/status rows with timestamp and added count. Receipt totals use a compact definition list, not cards. Reversion confirmation fills available width and explains consequences before its button.

### H. Attendance import

**Hierarchy/layout:** full-page workflow under the event, with a backlink to the event page, max 880px. Always show event title/date and “This file records people who attended.” Step indicator Choose file → Map columns → Review → Result. One primary continuation button per step; Back retains in-memory inputs. No upload modal.

**Actions:** Choose file, Download example, map/ignore columns, filter preview outcomes, acknowledge skipped invalid rows, Record attendance, and View receipt. Back is available before commit; Exit import confirms discarding local selection or the current draft. The step rules below define when each action is available.

**Choose file:** native file picker plus optional drop target; accept UTF-8 comma-delimited `.csv`, optional BOM, quoted fields and embedded newlines. Limits: 2 MiB and 5,000 nonblank data rows. Download example CSV with `name,email` and fictional example rows. Explain that email is required for matching across events and extra columns are ignored. File is parsed locally; raw file is not stored on the server.

**Map:** column-header dropdowns for required Email and optional Name, each showing sample values. Case-insensitive exact header matches may preselect; user can correct. Require unique mappings, explicit “Ignore” for unused data, and confirmation of the header row. Repeated/blank headers get stable numbered display labels. Do not guess that a numeric ID or phone column is an email. Optional Name defaults to empty and displays “Name not provided.”

**Review:** server-validated summary of new attendance, already recorded people, duplicates within file, invalid rows, and blank rows ignored. Preview table includes original row number, name, email, result/reason; filters by outcome and paginates. Normalize email by trim + lowercase only; never strip plus tags/dots or merge by name. First syntactically valid row for each normalized email is canonical; later occurrences are within-file duplicates. Existing identities keep their stored display name; conflicting imported names are a warning, not an overwrite. Invalid email is skipped only after explicit “Skip N invalid rows” acknowledgment; do not allow commit without it. Zero valid unique rows blocks commit. Button: “Record attendance for N people” where N includes already-recorded people receiving additional batch evidence; explanatory subtext gives the number of newly counted attendees.

**Confirm/result:** confirmation sends a preview ID and idempotency key, not arbitrary client totals. Save every accepted unique row as evidence for this batch, including people already present from another batch. Receipt says “X attendees added · Y already recorded · Z rows skipped.” Counts are server-calculated. Transaction is all-or-nothing for the accepted set. If attendance changed since preview, regenerate counts and require review again. On timeout, check receipt status before offering retry; do not assume failure. Browser reload can recover an unexpired server draft by ID after authentication; file selection/mapping before preview is not recoverable.

**Empty:** before selecting file, show instructions and sample download. Header-only/empty file: “This file has no attendance rows. Choose another file.” Missing mapping errors sit under fields. File with no Email column cannot continue until mapped or replaced.

**Loading/error:** “Reading file…” then “Checking rows…” within the step, retain title and controls; Cancel may stop parsing/preparation before commit. Row counts are not percentage progress. Commit says “Recording attendance…”; no cancel after request is accepted. Invalid encoding, malformed quoting, oversize and row-limit errors explain correction. Connectivity errors retain local input; drafts expire after 24 hours and require new review. Permission loss invalidates the draft action. No attendee data in logs/error telemetry.

**Mobile:** file picker is primary; mapping fields stack with visible sample text. Review rows become expandable outcome rows, with counts and outcome filter above. Sticky continuation button cannot cover the final row or errors. All review/confirm steps work on mobile; do not require desktop to finish a selected file.

### I. People (workspace attendance history)

**Hierarchy/layout:** h1 “People,” explanatory line “People recorded at your workspace’s events,” search and event-date From/To filters. Table: Person (name + email), Events attended, Last attended (event local date), Last event. Default last-attended descending then person ID; 50-row pagination. A short summary line may show distinct people and distinct attended events in the filtered result, never retention percentages or ranking charts.

**Rules/actions:** count distinct events with at least one active import contribution. Date filter compares each event’s start date in its own time zone, inclusive endpoints; this is event date, not import date. Include archived/completed/canceled events with recorded attendance and label their status. Person click opens detail and preserves history filters for Back. Search is case-insensitive name/email. No zero-attendance identities in the list. Names are not unique; email is always visible to distinguish them. No member access, bulk export, marketing action, or engagement score.

**Empty:** “Attendance history starts with your first import” + Browse events. Filtered empty: “No attendance matches these filters” + Clear filters. After reversion, history updates and no longer lists a person whose active attendance is zero.

**Loading/error:** skeleton rows and summary placeholders; refetch preserves prior query until new result succeeds, visibly marked updating. Failed summary never converts to zero. Access denied uses safe workspace navigation.

**Mobile:** list shows name/email, “3 events,” last event/date. Date inputs stack behind a visible Filters button with active-filter count. Person detail uses a route, not a tiny popover. No horizontal table scroll.

### J. Attendee detail

**Hierarchy/layout:** backlink to history (or originating event), h1 stored display name or “Name not provided,” email underneath. Definition line: distinct event count + first/last attended dates. Chronological list of attended events, newest first, each showing date/time zone, event title, status, and active source-batch links. No editable profile or speculative demographics.

**Actions:** open event; open an import receipt; back to filtered history. Only owner/organizer. Counts and list use the same active-contribution predicate.

**Empty:** identity with no remaining active evidence says “No active attendance records” + Back to history; do not return a misleading attendance list. Unknown/inaccessible identity uses safe unavailable state.

**Loading/error:** heading and event row skeletons; one Retry region on error; no stale identity header from previously viewed person.

**Mobile:** single column, wrapped email, full-width event rows; counts are inline text. Source batches expand beneath the event row.

### K. Sign-in, onboarding, and invitation acceptance

**Hierarchy/layout:** separate compact application entry surface, max 400px, small Brie wordmark, single heading. Sign-in asks email → six-digit email code. Onboarding asks workspace name (80 chars), zone, user display name if missing (80). Invite page identifies workspace and offered role only after validating the token safely; show the invite email masked until matching authenticated identity is established.

**Actions:** Send code, Verify, resend after cooldown, change email, create workspace, Accept invitation or Decline. Invitation creation is owner-only and creates a copyable email-bound link; Brie sends no invitation email in MVP. Email delivery is required for sign-in. Existing member accepting again receives “You already belong to this workspace” and Continue. An invitation cannot replace a current member’s role. Wrong-account acceptance offers Sign in with invited email.

**Empty:** first sign-in has only the email field and short instruction; no fake testimonials or marketing panel. No membership after sign-in routes to Create workspace, with note to use an invitation link if joining a team.

**Loading/error:** disable only submitted action, preserve email/name; code failures inline; expired/revoked/used invitation offers owner-contact instruction and workspace navigation where available. Invalid token response reveals no private workspace details. Creating workspace is atomic with owner membership; a failed attempt cannot strand a workspace.

**Mobile:** centered form becomes full-width with 24px margins; input text at least 16px, code input supports paste/autofill. Do not transplant the landing hero or Aside marketing art here.

### L. Workspace settings and team

**Hierarchy/layout:** owner-only Settings with General and Team tabs. General is a 640px form for name/default zone. Team is a flat list of display name/email, role, joined date, menu, followed by Pending invitations (email, offered role, expires, copy/revoke). Changing default zone only affects subsequently created events. Existing event zones do not change.

**Actions:** Save settings; invite email + role Organizer/Member → Create link → Copy; revoke link; remove teammate; change organizer/member role; transfer ownership with explicit confirmation. Owner cannot remove self or leave without transfer. Membership removal retains attribution as Former member and makes open assignments visibly unassigned for filtering (retain former member label in detail); a new membership does not silently restore old assignments. No workspace deletion screen in MVP.

**Empty:** owner-only list says “Add your organizing team” + Invite teammate; pending invitations absence uses a simple sentence. No “team growth” charts.

**Loading/error:** form/list skeletons; mutations await server confirmation. Duplicate pending invite offers existing link regeneration (revokes old token), not duplicate membership. Role/ownership conflict refetches current team and preserves proposed input. Copy failure exposes selectable link text. A role loss navigates out on the next request.

**Mobile:** stacked person rows and role labels; Invite is a full-screen sheet with email/role fields. Menus always visible; long emails wrap. General fields stack; actions follow content.

### M. Unavailable, access, and session states

**Hierarchy/layout:** keep known-safe shell, concise heading “This page isn’t available,” one sentence and Go to events. App-level unknown routes use “Page not found.” Network failure is distinct: “Couldn’t load this page” + Retry. Do not present a missing record as empty content.

**Actions:** retry, navigate to accessible workspace, or sign in with a validated same-origin return path. If membership was removed, clear that workspace’s cached data immediately.

**Empty:** absence is the state itself; no illustration or fake content. **Loading:** shell skeleton while authentication/permissions resolve. **Mobile:** centered text with natural width and full-sized actions; no sidebar until membership is known.

## 5. Open decisions

Defaults chosen on 2026-09-18 and written into sections 1–4. Change them here first.

1. **To-do status is two states.** A checkbox replaces Todo / In progress / Done. Existing In progress to-dos migrate to not done. Reason: a third state is a field most small teams never use.
2. **People per item.** A schedule item takes any number of people, so Mine and the per-person calendar are complete. A to-do keeps one person, because a to-do with two owners has no owner. This needs a join table for schedule people replacing `owner_membership_id`.
3. **Tables stay separate.** To-dos and schedule items share the page, entry pattern, and Mine filter, but remain separate tables in the MVP. Merge them only if the shared UI proves itself.
4. **Order is time.** Drop the uncommitted `sort_order` column and reorder command from `0017_run_of_show_briefing.sql`; keep `team_briefing`.
5. **Cascading times is opt-in per save**, never automatic.
6. **Calendar drag-to-move and resize is later work.** Click to edit and click empty time to add cover the MVP.
7. **PDF is generated in the browser** with a PDF library rather than `window.print()`, so every browser and phone gets the same file. Library choice is an implementation decision.
8. **An Events month calendar is later work.** The event list stays a list in the MVP.

## 6. Planning references

- [Design tokens and component behavior](DESIGN.md)
- [Schema, security, import semantics, and deployment](docs/ARCHITECTURE.md)
- [Small vertical slices for GPT-5.6 Sol](docs/IMPLEMENTATION.md)
- Primary visual reference: [Aside’s public product presentation](https://aside.com/), inspected 2026-09-12. The reference is its illustrated product chrome; Brie’s specified tokens are original choices, not extracted pixel values.
