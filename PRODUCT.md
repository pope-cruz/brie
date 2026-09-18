# Brie

## Register

product

## Users

Student organization officers and community organizers planning recurring, small-team events; volunteers checking assignments and the schedule on phones. An organizer may belong to multiple organizations, but works in one workspace at a time.

## Product purpose

Run events your way. Give a team one place to plan responsibilities, follow an event schedule, and retain trustworthy attendance history when leadership changes.

The MVP is a free internal operations tool. It is not a public event marketplace, registration platform, or member-management CRM. The complete scope is in [MVP.md](MVP.md).

## Product shape

**Type it like a Sheet, see it like a Calendar, check it on your phone.**

Brie's real alternative is a free Google Sheet that everyone already knows. Brie must be faster than a blank Sheet from the first minute, and then win on what a Sheet cannot do cheaply: time math, a personal view on a phone, and a clean printout.

- **One page per event, ordered by time.** An event is a single page with three sections: Before (to-dos), Day of (the run of show and team briefing), and After (attendance). Tasks, schedule, and attendance are phases of one event, not separate places.
- **Sheet-fast entry.** Keyboard first, few fields, the next row pre-filled from the last. Editing a row feels like typing in a spreadsheet, not filling out a form.
- **Calendar-clear shape.** The event day can be seen as a time grid where block height is duration, with a column per person.
- **Phone-first reading.** Members open on what is theirs: now, next, and their to-dos. One column, full notes, no side-scrolling.
- **Everyone sees everything; views filter, never hide.** "Mine" narrows a list; it is not a permission.
- **The PDF is how a plan leaves the team.** Volunteers, venue staff, and speakers without accounts get a downloaded PDF, for everyone or one person.

Not borrowed: spreadsheet formulas, formatting, or custom columns; calendar invites, recurrence, or sync; live show-calling, timers, or per-department columns from production rundown software.

## Brand personality

Operational, intentional, calm. Use direct language: “Assign task,” “Add segment,” “Import attendance.” Explain the consequence of a change in ordinary language.

## Surface boundary

The existing public landing page is approved. Preserve its Helvetica Neue typography, editorial vineyard imagery, restrained composition, existing content, and “Run events your way” positioning. Do not apply application styling rules to it.

For the authenticated application, the primary reference is the desktop product interface presented on [aside.com](https://aside.com/). Borrow compact navigation, quiet surfaces, and disciplined component proportions. Do not borrow its brand, browser controls, AI functionality, or marketing composition.

## Design principles

1. Put the next operational action beside the information it changes.
2. Fewer fields beat more options. Every field must earn its place against a blank spreadsheet row.
3. Prefer readable lists and schedules to dashboard decoration.
4. Make ownership, dates, time zones, and save status explicit.
5. Preserve history without turning it into surveillance or a score of people.
6. Keep administration small enough for next semester’s officers to understand.

## Anti-references

Generic KPI-card dashboards, ornamental gradients, oversized greetings, decorative charts, glass panels, colorful navigation tiles, and marketing imagery inside working screens.

## Accessibility and inclusion

Planning baseline: WCAG 2.2 AA, complete keyboard access, reduced motion, labeled controls, explicit state text, and usable 320px-wide layouts. Mobile use is essential for task completion and reading the run of show. These are proposed implementation requirements, not claims of existing compliance.

## Planning status

This document records the product direction and MVP scope. The core application is implemented; release acceptance is still in progress. See the [completion ledger](docs/SLICE_STATUS.md) for current verification evidence and remaining work. Read [DESIGN.md](DESIGN.md), [architecture](docs/ARCHITECTURE.md), and [implementation slices](docs/IMPLEMENTATION.md) together.
