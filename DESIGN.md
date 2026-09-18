# Brie application design system

## Scope and reference

Applies only to `/app` and its authentication surfaces. The approved public landing page is immutable for this MVP: preserve Helvetica Neue, vineyard imagery/shader, editorial spacing, typography, content, and “Run events your way.” Its large headings, green palette, and hero rounding are not application tokens. Do not rewrite `src/styles.css` global theme values to implement this file.

Primary visual reference: [Aside](https://aside.com/), inspected 2026-09-12, specifically its illustrated desktop product interface: compact sidebar rows, subdued supporting labels, pale surfaces, and a clear main working pane. This is a translation of that component language, not a copy of its branding, sky imagery, browser toolbar, assistant composer, or landing page. The exact values below are Brie design decisions, not measured Aside values.

Scene: a student organizer is on a laptop in a bright campus room checking assignments before an event, while volunteers consult the same plan on phones. Use a light, restrained interface with readable contrast, predictable controls, and little decorative motion.

## Visual tokens

Scope variables to `.brie-app`; scope component styles beneath it or use CSS modules. Scope all portaled overlays through a `.brie-app` overlay root too. Root application wrapper sets its own color/background and minimum viewport height. Do not let application CSS selectors target global `h1`, `button`, `body`, or marketing utility classes.

### Color

Hex values are canonical sRGB tokens. Neutrals deliberately have no warm cream or blue cast. A later automated color-space conversion must preserve rendered appearance.

| Token | Value | Use |
| --- | --- | --- |
| `--app-canvas` | `#FFFFFF` | Main workspace surface |
| `--app-sidebar` | `#F5F5F5` | Navigation plane |
| `--app-subtle` | `#FAFAFA` | Table headers, readonly inset areas |
| `--app-hover` | `#F0F0F0` | Hover on neutral rows/buttons |
| `--app-selected` | `#E8E8E8` | Active nav/filter item |
| `--app-pressed` | `#DDDDDD` | Pressed neutral control |
| `--app-ink` | `#202020` | Main text |
| `--app-muted` | `#626262` | Metadata, secondary labels, placeholders |
| `--app-border` | `#E2E2E2` | Decorative dividers/table rules |
| `--app-control-border` | `#858585` | Essential input/checkbox boundary |
| `--app-primary` | `#171717` | Primary action background |
| `--app-primary-hover` | `#303030` | Primary hover |
| `--app-primary-pressed` | `#000000` | Primary press |
| `--app-on-primary` | `#FFFFFF` | Primary action text/icon |
| `--app-focus` | `#343434` | 2px focus ring with 2px surface-colored gap |
| `--app-success` / `--app-success-bg` | `#28603A` / `#EDF5EF` | Done / successful result |
| `--app-warning` / `--app-warning-bg` | `#775017` / `#FCF4E6` | Overlap / overdue / skipped rows |
| `--app-danger` / `--app-danger-bg` | `#A32D2D` / `#FCEEEE` | Validation and destructive action |
| `--app-disabled-text` / `--app-disabled-bg` | `#777777` / `#EEEEEE` | Disabled controls only |

Text pairs must meet 4.5:1; essential nontext controls and focus boundaries 3:1 against adjacent surfaces. The thin decorative border is not sufficient to identify a standalone input: use control-border there. Verify final rendered states, not just token swatches. Use visible text (“Overdue,” “Done”) with semantic color. Never lower opacity on an entire readonly form. Disabled controls must have a nearby reason when the cause is not obvious.

### Typography

Use `"Helvetica Neue", "HelveticaNeue", Helvetica, Arial, system-ui, sans-serif`. Do not introduce a webfont or package proprietary fonts. Accept platform fallback differences; test macOS Helvetica Neue and a non-macOS fallback.

| Role | Size / line height | Weight / tracking |
| --- | --- | --- |
| Page title | 24px / 32px | 500 / -0.02em |
| Section title | 16px / 24px | 500 / -0.01em |
| Body, data, form label | 14px / 20px | 400; labels 500 / normal |
| Sidebar, buttons | 13px / 20px | 400; active/primary 500 / normal |
| Metadata/table headers | 12px / 18px | 400; headers 500 / normal |
| Input text on mobile | 16px / 24px | 400 / normal |

Use rem equivalents with 16px browser default; do not change the root font size. No fluid heading scale in the app. No all-caps letterspaced category labels. Use tabular numerals for dates/times/counts only, not monospace for all data. Prose max 70ch. Event titles wrap; desktop row titles may truncate visually with full accessible text and a title tooltip. Do not truncate the only distinguishing part of an email on mobile.

### Geometry

| Token / rule | Value |
| --- | --- |
| Spacing scale | 4, 8, 12, 16, 20, 24, 32, 40, 48px |
| Sidebar | 224px desktop; 200px tablet; 280px mobile drawer max |
| Sidebar internal padding | 12px; nav item 32px high with 8px horizontal inset |
| Header | 56px min-height; grows for wrapped content |
| Page padding | 32px at ≥1024; 24px at 768–1023; 16px below 768 |
| Working content | 1200px max; centered within main pane, aligned consistently |
| Form / import content | 640px / 880px max |
| Toolbar gap / section gap | 8px / 24px |
| Table header / normal row / event row | 36px / 48px / 64px min-height |
| Controls | 36px desktop height; 44px mobile min-height |
| Detail panel | 400px desktop; full viewport below 768px |
| Radius control / row selection / panel | 6px / 4px / 8px |
| Status label radius | 4px, not a rounded pill |
| Dividers | 1px solid app-border |
| Shadows | None for pages, tables, panels, controls |
| Overlay exception | Menu only: `0 2px 6px rgb(0 0 0 / 0.08)` if border alone is unclear |

Main uses `min-width: 0`. Shell min-height is `100dvh`. Sidebar may scroll independently; page body normally has one main scroll container. Sticky headers remain below shell chrome and do not cover keyboard focus. Do not stack multiple independently scrolling table panes. The event page is a single column of Before / Day of / After sections, max 960px; the day-of calendar may use the full main width. Keep forms single-column except paired date/time fields on desktop.

## Component and state contract

| Component | Default / hierarchy | Interactive states and feedback |
| --- | --- | --- |
| Primary button | Black, white text, 6px radius, 12px horizontal padding | Hover/pressed primary tokens; focus ring; disabled neutral; loading retains width and uses verb “Saving…” with small spinner and `aria-busy`; error outside button |
| Secondary button | White, 1px decorative border, ink label | Neutral hover/press, focus ring; disabled label/background; loading retains label context |
| Quiet button | Text/icon, no resting border | Neutral hover background; same focus/disabled rules; accessible name required on icons |
| Destructive action | Text danger in menu; danger solid only at final confirmation | Name object and consequence; show pending; retain confirmation on failure; no irreversible claim for a reversible action |
| Navigation item | 16px icon, label, 8px gap | Hover neutral; active selected fill + weight + aria-current; focus separate from active; no error styling unless navigation failed in main pane |
| Tab | Text label, 12px side padding | Active ink + 2px bottom underline, inactive muted; focus ring; arrows/Home/End navigate tablist; active content/loading region announced |
| Field | Persistent label, white background, control border | Hover ink border; focus ring; invalid danger border + error text; readonly subtle surface and readable text; disabled semantic state; pending validation uses adjacent text |
| Select/assignee | Same field geometry, name or Unassigned | Native or accessible listbox; search only when useful; keyboard select/Escape; selected item has check; loading/error/no matches explicit |
| Status control | Text + optional small icon; neutral by default | Todo neutral; In progress ink; Done green; focus/hover identical across statuses; pending status announcement; error rollback |
| Table/list row | Content + bottom rule; title link only navigational target | Hover subtle; keyboard focus on actual controls, no hidden pseudo-button row; selected fill only when truly selected; failed mutation marked beside action |
| Detail panel | Header, form/content, footer actions; 1px left divider | Desktop nonmodal if underlying list remains operable; focus moves to panel heading, Close restores trigger. Mobile modal sheet traps focus; dirty close prompts; saving keeps fields |
| Menu | White, 1px border, 8px radius; min 180px | Portal outside scroll clipping; arrows select, Enter activates, Escape restores focus; disabled items explain why; no hover-only opening |
| Confirmation dialog | Title, consequence sentence, Cancel + action | Focus starts at safe action, trap focus; pending non-dismissible if operation accepted; failure remains readable and retryable |
| Toast | Small bottom-corner confirmation, no shadow required | Success only supplementary; visible result remains in page. Undo also reachable from Removed items; never sole location of an error |
| Skeleton | Neutral blocks matching final line/row geometry | Static by default; `aria-hidden`; parent busy; no fake data; after failure replace with Retry state |
| Empty state | Section heading or short sentence, 1–2 explanatory lines, relevant action | Distinguish first use, no matches, no permissions; no illustrations, empty charts, or fabricated metrics |

Native validation and accessible primitives are preferred over custom interaction invention. Do not pull in an entire theme to obtain a dialog. If a component library is chosen during implementation, map every state to these tokens and keep its default typography/spacing from leaking into the app.

## Screen composition rules

- Sidebar is workspace navigation; the event page uses sections with an optional jump bar of links, not tabs. Never duplicate the same full navigation in two rails.
- Event list is a working list, not a wall of event cards. Dates and ownership align for scanning.
- Home and the event page show real to-dos, schedule items, and event facts. No invented health score, trend chart, progress ring, or hero greeting.
- To-dos and schedule items use sheet-style rows on desktop and a full-screen sheet for editing on mobile. The run of show is a time-ordered list with time as the first visual anchor, plus a one-day calendar grid on desktop where block height is duration. Buffers are dashed blocks; no other color coding by type. A schedule is not a Kanban board.
- Attendance import is a page sequence with explicit review. Keep file-row counts separate from distinct attendee counts.
- History is a searchable record, not a leaderboard. Display the email beside names to distinguish identities.
- Never fill unused space with decoration. Whitespace is acceptable after a short list.
- Exact screen layouts/actions/empty/loading/error/mobile behavior are normative in [MVP.md](MVP.md), sections A–M.

## Motion, focus, and layering

Use 120ms color transitions and 180ms opacity/transform transitions for menus/drawers, easing `cubic-bezier(0.22,1,0.36,1)`. No route entrance choreography, staggered tables, bounce, parallax, or animated counters. Under `prefers-reduced-motion: reduce`, transitions are instant and skeletons static. Progress remains understandable without animation.

Layer scale: content 0, sticky header 10, desktop panel 20, popup 30, modal backdrop 40, modal 50, toast 60, tooltip 70. Menus inside a modal stay in its focus/layer context. Tooltip never carries essential instructions. `scroll-margin-top` keeps focus targets clear of sticky headers.

Keyboard acceptance: every action reachable, visible focus on all surfaces, Enter submits only appropriate forms, Escape never silently discards dirty edits, drag never the sole method. Touch acceptance: 44px targets and no hover dependency. At 200% zoom preserve content/actions without overlap; at 320px no page-level horizontal overflow.

## Anti-patterns and landing protection

Do not ship gradients, glass panels, decorative shadows, huge radii, nested cards, sidebar color stripes, oversized metrics, tiny uppercase eyebrows, decorative charts, welcome banners, emoji navigation, arbitrary font families, or multiple saturated action colors. No gray-on-gray placeholders below contrast requirements. Do not use status dots without text. No modal-first import workflow. No accidental full-row click target containing nested buttons. No disabled action without an explanation when the user cannot infer it.

Do not “fix” the landing’s typography, hero letter spacing, vineyard shader, rounding, or imagery to conform to this application specification. Existing marketing files remain unchanged. Introduce routing in a separate entry layer and mount the existing `App.tsx` at `/`.

## Visual acceptance fixtures

Review at 1440×900, 1024×768, 768×1024, 375×812, and 320×640. Include an empty workspace, 100-character event title, long email, missing location/name, former assignee, overdue task, overnight event, overlapping segments, canceled event with attendance, invalid CSV rows, reverted batch, and network failure. Compare populated and empty versions side-by-side for stable hierarchy. Capture landing baselines before routing changes; dynamic shader variation alone is not a layout regression.
