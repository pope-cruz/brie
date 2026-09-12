# Brie MVP specification

Status: implementation-ready plan, 2026-09-12. Proposed scope and defaults; no application code changes are part of this deliverable.

## 1. Scope and outcome

Brie lets a small organizing team create an event, assign the work, prepare a chronological run of show, import actual attendance from a CSV, and look up participation across past events. The organizing unit is a private workspace. Every event belongs to exactly one workspace; every active workspace member can see its operational plans.

**The release demonstration:** an owner creates a workspace and invites a teammate; an organizer creates an event and assigns a task; the teammate completes it on a phone; the organizer adds a schedule and imports an attendance file; a second event establishes repeat attendance; reverting the first import adjusts history correctly. A second workspace cannot access any of those records.

Design envelope, to validate with fixtures: 2–30 active teammates, up to 500 events and 10,000 attendee identities per workspace, 200 tasks and 200 schedule segments per event, 5,000 data rows / 2 MiB per CSV. These are explicit MVP limits, not measured capacity claims. UI queries paginate; do not fetch the entire workspace to render a screen.

### Included

- Email-code sign-in, workspace creation and switching, email-bound invitation links, and three roles.
- Event creation/editing, draft/planned/completed/canceled status, archive/restore, and duplication for reuse.
- Tasks with one optional assignee, optional due date, and todo/in-progress/done status.
- Run-of-show segments with explicit start/end, title, optional owner, and plain-text instructions.
- Reviewed CSV import of people who actually attended, duplicate handling, import receipts, and whole-batch reversion.
- Event attendance list, workspace attendance history, and individual participation detail.
- Basic workspace name/time-zone settings and team membership administration.
- Self-host instructions, migrations, sample data, automated authorization/import tests, and a demonstrated backup restore.

### Excluded

Public event pages, RSVPs, ticketing/payments, QR scanning, live check-in, email campaigns, announcements, push notifications, calendar/chat/CRM integrations, native apps, offline writes, realtime co-editing, AI assistants, file attachments, rich-text editors, budgets, recurring-event engines, dependencies/Gantt/Kanban, custom roles, private subteams, custom fields, member rankings, analytics dashboards, and a template library/editor.

Existing landing copy mentions reusable templates. MVP reuse is **Duplicate event**, which copies the plan; a dedicated template system remains later work. Do not change the approved landing copy to resolve that distinction. Imported attendees do not become user accounts or workspace members.

### Roles

| Capability | Owner | Organizer | Member |
| --- | --- | --- | --- |
| Read events, all tasks, run of show, team names | Yes | Yes | Yes |
| Create/edit/archive/duplicate events; manage tasks and schedule | Yes | Yes | No |
| Change own assigned task status | Yes | Yes | Yes |
| Import/revert attendance; see attendee names/emails/history | Yes | Yes | No |
| See aggregate attendance count on overview | Yes | Yes | Yes |
| Invite/revoke/remove members, change roles, workspace settings | Yes | No | No |
| Transfer ownership | Yes | No | No |

Exactly one owner. Ownership transfer to an active teammate is atomic and demotes the former owner to organizer. A member cannot edit a task’s title, date, assignee, or notes. Authorization is enforced at the data boundary, including direct requests, not merely by hiding controls. Removed memberships immediately lose access on the next request. Members see “Ask an organizer” where an empty workflow requires privileged action.

### Product rules

- Default event status is Draft. Organizer explicitly chooses Planned, Completed, or Canceled. Time passing does not change status. Planned requires valid start/end; all events require title, start/end, and time zone at creation.
- Archive is separate from status, reversible, and hides an event from default lists. Archived events and their tasks/schedule/attendance are read-only until restored. History still includes archived events with active attendance.
- Completed events remain editable for cleanup. Canceled events keep previously recorded attendance but reject new imports until moved to another status. Never infer absence or delete attendance when status changes.
- Event date/time uses the event’s IANA time zone; workspace time zone supplies the initial default. Show the zone wherever a person enters or reads schedule times. Task due dates are calendar dates interpreted in the event zone; no due time or reminders.
- A task is overdue when its date is before today in the event zone and it is not done; do not flag tasks of completed/canceled/archived events as operationally overdue.
- Duplicate event requires a new title and start/end. Copy description/location, task titles/notes, and schedule instructions/durations/offsets. Reset status to Draft, tasks to Todo, lead and assignees to Unassigned, due dates to none; copy no attendance, imports, or audit records. New schedule times are calculated from the new start by elapsed offsets; show an out-of-range warning if the chosen event end is earlier than copied segments.
- No hard-delete event action in MVP. Individual tasks/segments support reversible removal via undo or a “Removed items” disclosure in their tab; organizer restores them. Attendee identity correction uses batch reversion and corrected reimport; no fuzzy identity merge UI.

### Release criteria

- First-time organizer can create a usable event, task, and schedule without seed data or training.
- Import preview reconciles every nonblank row into one outcome; confirmed totals exactly match committed data.
- Two simultaneous saves cannot silently overwrite each other. Two retries cannot duplicate an import.
- A volunteer completes an assigned task and reads all schedule instructions at 375px width using touch, and at desktop using only a keyboard.
- Every specified screen has implemented empty/loading/error/permission states. No sample numbers appear in real empty workspaces.
- Landing visuals and content are unchanged at agreed desktop/mobile screenshot baselines.

## 2. Core flows and inventory

Route convention: `w` and `e` below are immutable UUIDs, never trusted as authorization. Workspace and event titles are display labels. `/app` redirects to the last accessible workspace’s event list, or onboarding. Use browser history for back navigation; preserve filters in query parameters.

| Flow | Steps | Destination / success |
| --- | --- | --- |
| Start a workspace | Sign in → verify code → name workspace + choose zone | Event list; owner membership created atomically |
| Join a team | Open invite → authenticate matching email → accept membership | Invited workspace event list, clear role label |
| Plan | Events → New event → overview → Tasks → Run of show | Persisted plan with owners and chronological schedule |
| Carry out assigned work | Workspace Tasks → Mine → open task → update status | Status persists; event totals update |
| Record attendance | Event Attendance → Import → choose CSV → map → review → confirm | Import receipt and updated distinct attendance count |
| Correct a mistaken import | Attendance → Imports → receipt → Revert → confirm impact | Active contribution removed; other batches preserved |
| Remember | Workspace Attendance → search/date filter → person | List of distinct attended events with context |
| Reuse | Event menu → Duplicate → choose new dates → create | Draft with copied plan and reset ownership/status |

| Screen | Route |
| --- | --- |
| Sign-in and code verification | `/app/sign-in` |
| Onboarding / create workspace | `/app/new-workspace` |
| Invite acceptance | `/app/invite/:token` |
| Shared workspace shell/sidebar | Every authenticated workspace route |
| Event list | `/app/w/:w/events` |
| Event create/edit/duplicate form | `.../events/new`, `.../events/:e/edit`, `.../events/:e/duplicate` |
| Event overview | `.../events/:e` |
| Event task assignments | `.../events/:e/tasks` |
| Workspace tasks (same component, event column) | `/app/w/:w/tasks` |
| Run of show | `.../events/:e/run-of-show` |
| Event attendance; Imports subview | `.../events/:e/attendance?view=people|imports` |
| Attendance import / receipt | `.../events/:e/attendance/import`, `.../attendance/imports/:batch` |
| Workspace attendance history | `/app/w/:w/attendance` |
| Attendee detail | `/app/w/:w/attendance/:person` |
| Workspace settings / team | `/app/w/:w/settings?tab=general|team` |
| Unavailable, forbidden, session expired | In-route state; unknown route gets app 404 |

No dashboard, calendar, inbox, or standalone attendee CRM screen. The Events list is home.

## 3. Shared screen contract

All screens below inherit this contract; per-screen states supplement it. Visual dimensions and state tokens are in [DESIGN.md](DESIGN.md).

- **Hierarchy:** one h1, optional single-line contextual description, one primary action for the current task, then filters and the working content. Event screens share title, metadata, and tabs: Overview, Tasks, Run of show, Attendance (last tab only for owner/organizer).
- **Loading:** render the stable shell immediately after authentication; skeleton only the pending region with its eventual geometry and `aria-busy`. Never show a false zero or empty state before data resolves. Refetch preserves rows and labels them updating.
- **Errors:** inline explanation + Retry for failed reads; retain form values on failed writes. A session expiration returns to sign-in with a same-origin return path; do not persist attendance payloads in local storage. Show safe navigation when the record is inaccessible, without confirming another workspace’s record exists.
- **Save feedback:** ordinary forms explicitly Save/Cancel. Row status updates may be optimistic with rollback and inline error. Import, role changes, and reversion are pessimistic. Stale version errors offer Reload latest and retain the unsaved input for comparison; no silent last-write-wins.
- **Mobile:** 320px minimum width; below 768px replace sidebar with a labeled menu drawer, stack forms, and turn operational tables into labeled rows. Tables that truly need column comparison can scroll in a labeled region. Actions remain visible without hover; touch targets at least 44px.
- **Search:** all MVP search fields use case-insensitive prefix matching on the named fields (title/location, or name/email). A match at the start of either field qualifies; substring and fuzzy search are out of scope. Apply the query before pagination and distinguish filtered zero results from first-use emptiness.
- **Accessibility:** links navigate, buttons act, native labels precede fields, errors reference their fields, dialogs trap/restore focus, Escape closes dismissible overlays, and background content is inert while a drawer/dialog is open. Screen changes focus the h1; validation focuses the first error. Never use color alone for status.

## 4. Detailed screens

### A. Workspace sidebar and shell

**Hierarchy/layout:** fixed 224px desktop sidebar with pale neutral surface and 1px right border. Top 56px contains a small `brie` wordmark and workspace switcher. Middle navigation: Events, Tasks, Attendance (owner/organizer only). Bottom: Settings (owner only), current user name, account menu. Inside event pages, retain workspace navigation and use event tabs in the main pane; do not grow a second event tree. No badge unless it carries a defined actionable count; MVP ships without sidebar counts.

**Actions:** switch to another accessible workspace; Create workspace; open nav destinations; sign out from account menu. Workspace switch clears prior-workspace query caches before painting the destination. Current item uses a filled neutral selection plus medium weight and `aria-current=page`; event child routes keep Events selected. Task detail opened from workspace Tasks preserves its return location.

**Empty:** user with no membership sees onboarding without a dummy workspace sidebar. Switcher with one workspace shows its name and Create workspace; no “no results” filler.

**Loading/error:** workspace name and nav skeleton until permissions resolve; never briefly flash owner controls. Failure offers Reload workspace and Sign out. Membership revoked routes to accessible workspace selection/onboarding.

**Mobile:** 56px top bar with Menu, workspace name, account action. Drawer is 280px or viewport minus 32px, whichever is smaller; closes after navigation, traps focus, restores it to Menu. No collapsed icon rail and no duplicate bottom navigation. Tablet 768–1023px uses a 200px sidebar; desktop content remains usable with wrapping controls.

### B. Event list

**Hierarchy/layout:** h1 “Events,” short workspace context, right-aligned New event. Segmented filters Upcoming / Past / All / Archived, then search. Flat table: Event (title + optional location), When (date/time + zone), Status, Lead, Tasks (done/total). Lead is optional active workspace teammate, not a separate permission role. Rows are 64px; title is a real link and trailing menu is a separate button. No hero stats.

**Behavior/actions:** Upcoming defaults to unarchived Draft/Planned with end at or after now, earliest start first. Past includes unarchived events ended before now or explicitly Completed/Canceled, latest start first. These tabs are intentionally disjoint; All includes every unarchived event. Archived is separate, latest start first. Search is case-insensitive title/location within current filter; URL stores query and page. Fifty results per page with total and previous/next. Menu: Edit, Duplicate, Archive; archived menu: Restore. Member gets navigation only. Archive confirmation states read-only effect and history retention.

**Empty:** first workspace: “Plan your first event” + New event; member: “Your team hasn’t added an event yet.” Filter empty: “No upcoming events” or “No events match ‘…’” + Clear filters / All. Archived empty: “Archived events will appear here.”

**Loading/error:** six row skeletons under actual headers; keep filter toolbar stable. On failed pagination retain last successful rows with Retry. Archive/restore error stays beside the affected row.

**Mobile:** stacked rows show title, date/time, status, task fraction; lead/location in secondary line or row detail. Filters wrap; search fills width; New event becomes compact text button. Menus have visible 44px targets. No whole-page horizontal scroll.

### C. Event creation, editing, and duplication

**Hierarchy/layout:** full-page form, max 640px, backlink to Events or event; h1 “New event,” “Edit event,” or “Duplicate event.” Fields in order: title (required, 120 characters), description (plain text, 2,000), location (optional, 200), start/end date and time, IANA time zone (required), lead (optional). Status field appears on edit; creation/duplication is Draft. Display Save/Create event and Cancel at the form end.

**Actions/rules:** validate end after start; explicitly resolve ambiguous daylight-saving times by choosing offset and reject nonexistent local times. Changing event start/zone does not silently move existing schedule segments: show “Schedule times stay fixed; review Run of show.” Duplication summarizes what resets before Create copy. Prevent double submission; navigate only after transaction success. Confirm discarding dirty input on navigation.

**Empty:** blank creation form with workspace zone preselected; no invented location or dates. Duplication pre-fills a title ending “copy” and asks for dates. No teammates beyond owner still allows Unassigned lead.

**Loading/error:** edit/duplicate skeleton before fetching source; errors inline; preserve data after save failure. Not found returns safe event-list link. Removed lead remains labeled “Former member” on an existing event, but cannot be chosen for a new assignment.

**Mobile:** full-width single-column form with 16px field text, stacked date/time inputs, natural document scrolling. Save/Cancel may stick above safe area only if they do not cover content or focused inputs.

### D. Event overview

**Hierarchy/layout:** breadcrumb Events / event, 24px event title, status, compact metadata (date range, zone, location, lead), Edit event and overflow. Tabs below a divider. Main pane at desktop uses 2:1 columns: description then upcoming/open task rows on left; event details and next five schedule segments on right. Attendance is one quiet text line (“84 attendees recorded”) linked for privileged users, not a KPI tile. Member sees the aggregate only.

**Actions:** edit/status change in Edit event; shortcuts Add task, Add segment, Import attendance in their sections, shown by permission. View all tasks/schedule; open task; Duplicate/Archive in overflow. Section headings own their links; no universal “Quick actions” panel.

**Content rules:** open tasks ordered overdue first, then dated, then undated; at most five. Schedule preview uses first upcoming segment by time, or first five if event is not in progress; label the time rule. Derived counts come from server aggregates. Archived banner explains Restore to edit; canceled banner explains event status without a destructive warning tone.

**Empty:** each absent object teaches locally: “No tasks yet. Add the work your team needs to do”; “No schedule yet. Add your first segment”; “Attendance hasn’t been imported.” Members receive explanatory text without unavailable CTAs. Missing description/location uses unobtrusive “Not added.”

**Loading/error:** metadata and each section have separate skeletons; a failed task section does not hide event details. Failed counts show “Unavailable,” never 0. Stale content exposes Refresh.

**Mobile:** one column: metadata → description → tasks → schedule → attendance. Tabs remain a horizontally scrollable, keyboard-accessible tab strip; short labels fit when possible. Long event titles wrap to multiple lines. Primary edit action moves into the title action row, never over the title.

### E. Task assignments and workspace Tasks

**Hierarchy/layout:** event tab shows “Tasks,” status filter All/Open/Done, assignee filter Anyone/Me/Unassigned/person, and Add task. Table columns: Status, Task, Assignee, Due, row menu. Workspace Tasks defaults to Me + Open, adds Event column, excludes completed/canceled/archived events unless “Include closed events” is on. No separate custom saved-view system. Query params hold filters; use 50-row pagination. Sort open overdue dates first, then due date, then creation; Done rows last in All.

**Actions:** click title opens a 400px detail panel with title (required, 200 characters), notes (2,000 characters), single assignee, due date, status, and Save/Cancel. Add task opens the same blank panel; workspace creation additionally requires Event. Inline status select labels Todo, In progress, Done. Organizer can assign active teammates or Unassigned; member can change only own task status. Removed assignee displays Former member and no longer counts as “Me.” Remove task offers Undo and remains restorable from Removed items.

**Empty:** “No tasks yet” + Add task for organizers; filtered view “No open tasks assigned to you” + Show all tasks. Assignee search with zero matches says so and offers Unassigned, never silently invites someone.

**Loading/error:** row skeletons, assignee options skeleton, explicit “Saving status…” announced quietly. Failed optimistic update rolls back and retains Retry on that row. Concurrent reassignment while member saves status rejects the mutation and refreshes permissions. A detail panel never discards a draft after conflict.

**Mobile:** list rows show status control + title, then assignee and labeled due date. Detail panel becomes full-screen sheet with heading, Close, body scrolling, Save at bottom. Filters wrap. Inline controls remain visible and 44px; removal is in the menu. No drag-and-drop requirement.

### F. Run of show

**Hierarchy/layout:** h1 remains event title; tab heading “Run of show,” event date/zone, Add segment. Chronological table: Start–End (tabular numbers), Segment, Owner, Instructions preview, menu. Each segment shows full date when spanning dates. Optional “Now” text indicator is derived from wall clock and event zone, never a live-sync claim. Expand a row to read full instructions without leaving the schedule. No calendar grid or decorative timeline spine.

**Actions/rules:** Add/Edit uses detail panel: title (120), start, end, owner, instructions (4,000 plain-text characters). Both times required, end after start. Sort by start then creation ID; equal/overlapping segments allowed with “Overlaps another segment” text and a warning before saving. Segments outside event range warn but may be saved for setup/cleanup. Editing one segment never cascades times. Owner optional; active teammates only. Organizer can remove/restore; members read and expand. No reorder handles because chronological times define order.

**Empty:** “Build the schedule for event day” + Add segment, helper “Include setup, program, and cleanup.” Members see “The schedule hasn’t been added yet.”

**Loading/error:** five fixed-height schedule skeletons; retain expanded rows during refetch. Stale edit offers latest data; save errors preserve times/instructions. Refetch on focus and expose Last updated + Refresh; no realtime or offline indicator suggesting functionality that does not exist.

**Mobile:** vertically ordered rows: time range first, title next, owner and expandable instructions below. Date and zone stay visible in the section header; no horizontally scrolling table. Add/Edit is full-screen sheet. “Now” does not auto-scroll or steal focus during use.

### G. Event attendance and import receipts

**Hierarchy/layout:** Attendance tab: heading, distinct active attendee total, Import CSV. Local switch People / Imports. People columns Name, Email, Recorded in (latest active batch date); searchable by name/email, 50-row pagination. Imports columns file label, imported at, imported by, rows added, status Active/Reverted; latest first. Counts describe distinct people, not file rows.

**Actions:** People opens attendee detail; Imports opens receipt with totals and link back to people. Receipt lists aggregate accepted/skipped/duplicate outcomes and uploader/time; rejected row details are available only in the preview and are not retained after commit. Revert import is an explicit secondary destructive action, requiring confirmation with recalculated number of attendance records that disappear and number retained through other active batches. Reverted receipt remains visible, read-only. Correct mistakes with revert → corrected file → new import. No raw file download or individual attendance editing in MVP.

**Empty:** People: “No attendance recorded” + Import CSV. If only reverted imports exist: “No active attendance records” and View imports. Imports: “Your imports will appear here.” Search empty has Clear search.

**Loading/error:** independent count/list skeletons; batch reversion shows “Reverting…” and blocks repeat action. If confirmation impact is stale, refresh the impact and ask the product user to confirm the updated result. Failed receipt load preserves navigation. Receipt of an expired draft directs to restart import.

**Mobile:** People becomes name/email rows with secondary batch date; Imports becomes file/status rows with timestamp and added count. Receipt totals use a compact definition list, not cards. Reversion confirmation fills available width and explains consequences before its button.

### H. Attendance import

**Hierarchy/layout:** full-page workflow within the event shell, max 880px. Always show event title/date and “This file records people who attended.” Step indicator Choose file → Map columns → Review → Result. One primary continuation button per step; Back retains in-memory inputs. No upload modal.

**Actions:** Choose file, Download example, map/ignore columns, filter preview outcomes, acknowledge skipped invalid rows, Record attendance, and View receipt. Back is available before commit; Exit import confirms discarding local selection or the current draft. The step rules below define when each action is available.

**Choose file:** native file picker plus optional drop target; accept UTF-8 comma-delimited `.csv`, optional BOM, quoted fields and embedded newlines. Limits: 2 MiB and 5,000 nonblank data rows. Download example CSV with `name,email` and fictional example rows. Explain that email is required for matching across events and extra columns are ignored. File is parsed locally; raw file is not stored on the server.

**Map:** column-header dropdowns for required Email and optional Name, each showing sample values. Case-insensitive exact header matches may preselect; user can correct. Require unique mappings, explicit “Ignore” for unused data, and confirmation of the header row. Repeated/blank headers get stable numbered display labels. Do not guess that a numeric ID or phone column is an email. Optional Name defaults to empty and displays “Name not provided.”

**Review:** server-validated summary of new attendance, already recorded people, duplicates within file, invalid rows, and blank rows ignored. Preview table includes original row number, name, email, result/reason; filters by outcome and paginates. Normalize email by trim + lowercase only; never strip plus tags/dots or merge by name. First syntactically valid row for each normalized email is canonical; later occurrences are within-file duplicates. Existing identities keep their stored display name; conflicting imported names are a warning, not an overwrite. Invalid email is skipped only after explicit “Skip N invalid rows” acknowledgment; do not allow commit without it. Zero valid unique rows blocks commit. Button: “Record attendance for N people” where N includes already-recorded people receiving additional batch evidence; explanatory subtext gives the number of newly counted attendees.

**Confirm/result:** confirmation sends a preview ID and idempotency key, not arbitrary client totals. Save every accepted unique row as evidence for this batch, including people already present from another batch. Receipt says “X attendees added · Y already recorded · Z rows skipped.” Counts are server-calculated. Transaction is all-or-nothing for the accepted set. If attendance changed since preview, regenerate counts and require review again. On timeout, check receipt status before offering retry; do not assume failure. Browser reload can recover an unexpired server draft by ID after authentication; file selection/mapping before preview is not recoverable.

**Empty:** before selecting file, show instructions and sample download. Header-only/empty file: “This file has no attendance rows. Choose another file.” Missing mapping errors sit under fields. File with no Email column cannot continue until mapped or replaced.

**Loading/error:** “Reading file…” then “Checking rows…” within the step, retain title and controls; Cancel may stop parsing/preparation before commit. Row counts are not percentage progress. Commit says “Recording attendance…”; no cancel after request is accepted. Invalid encoding, malformed quoting, oversize and row-limit errors explain correction. Connectivity errors retain local input; drafts expire after 24 hours and require new review. Permission loss invalidates the draft action. No attendee data in logs/error telemetry.

**Mobile:** file picker is primary; mapping fields stack with visible sample text. Review rows become expandable outcome rows, with counts and outcome filter above. Sticky continuation button cannot cover the final row or errors. All review/confirm steps work on mobile; do not require desktop to finish a selected file.

### I. Workspace attendance history

**Hierarchy/layout:** “Attendance history,” explanatory line “People recorded at your workspace’s events,” search and event-date From/To filters. Table: Person (name + email), Events attended, Last attended (event local date), Last event. Default last-attended descending then person ID; 50-row pagination. A short summary line may show distinct people and distinct attended events in the filtered result, never retention percentages or ranking charts.

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

## 5. Planning references

- [Design tokens and component behavior](DESIGN.md)
- [Schema, security, import semantics, and deployment](docs/ARCHITECTURE.md)
- [Small vertical slices for GPT-5.6 Sol](docs/IMPLEMENTATION.md)
- Primary visual reference: [Aside’s public product presentation](https://aside.com/), inspected 2026-09-12. The reference is its illustrated product chrome; Brie’s specified tokens are original choices, not extracted pixel values.
