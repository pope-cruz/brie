# First complete test run

Use the local app at http://127.0.0.1:5199/app/sign-in and the local mailbox at http://127.0.0.1:54324. Local emails stay in Mailpit; they do not arrive in your real inbox. Start the existing stack using SETUP.md. Do not reset a database containing work you want to keep.

Allow about 30–45 minutes. Use fictional accounts `owner@example.test`, `organizer@example.test`, and `member@example.test`. Keep the owner in your normal browser and use separate browser profiles for teammates, so switching accounts does not interrupt the owner.

## 1. Sign in and start a workspace

1. Request a code for the owner. Open its latest email in Mailpit, then paste the six digits into Brie. Expect Create a workspace.
2. Before verifying another test account, try an incorrect code: expect an inline error, retained email, and an available retry. Resend becomes available after 60 seconds; use the newest code. Change email should clear the old code/error.
3. Create `Campus Events QA` with your display name and `America/New_York`. Expect a real empty Events list.
4. Reload. Expect to remain signed in and in the same workspace.

## 2. Plan an event

1. Create `Welcome night` with a future start/end in the selected time zone. Expect its overview; reload to confirm persistence.
2. Add `Set up welcome desk`, then add a run-of-show segment with instructions such as `Bring the sign-in sheet and markers`.
3. Try an end before the start. Expect validation without losing your draft.

## 3. Invite and exercise each role

1. In Settings → Team, create an Organizer invitation and a Member invitation for the two fictional addresses. Copy each link; invitations are shared manually.
2. Open the member link in its separate browser profile. Sign in using that exact invited address. Expect to return to the invitation and accept it.
3. Open an invitation while signed in to the wrong account. Use Sign in with another email; expect the invitation destination to be retained.
4. As owner, assign the task to the member. As member, open Tasks, find their assignment, mark Done, then reload. Expect the change to persist and the overview totals to update.
5. At 375px width, read the segment's full instructions. Expect no horizontal page scroll. Members should have no attendee details or workspace administration actions.
6. Accept the Organizer invitation. Confirm the organizer can edit event plans and attendance but cannot administer the workspace.

## 4. Import, overlap, and correct attendance

1. In Welcome night → Attendance, import `supabase/sample-attendance.csv`. Under **Who attended**, choose **Everyone in this file attended** (a plain list has no attendance column). Review mapping and every outcome before confirming. Expect the receipt and event count to agree.
2. Import `tests/fixtures/attendance-a.csv`, then `attendance-b.csv`. The files share Bo. Expect three distinct people across these two batches, not four (plus any distinct people from the sample import).
3. Revert batch A. Expect Ana to disappear from this event and Bo and Cy to remain. The reverted receipt stays visible.
4. Duplicate the event with new dates. Expect Draft, Todo tasks, no assignees/due dates, shifted schedule, and no attendance.
5. Import batch B into the second event. In workspace Attendance, expect Bo and Cy to each have two events; repeated evidence within one event counts only once.
6. Import `tests/fixtures/mixed-attendance-luma.csv` into the second event. Brie guesses `checked_in_at` for attendance and `approval_status` for RSVP; every value starts unknown. Set **Other values** under Attendance to **Attended** and tick **Keep a copy of the original rows**. Expect the review to show 3 will count (Mira, the name-less guest.desk row, Sasha), 3 won’t count (Jules with a blank check-in, Ren declined, Noor blank), 1 needs review (Sasha without email, not merged by name or phone) and 1 duplicate (Mira again). Skip the row that needs review and record. On the receipt, download the original rows, then delete them.
7. Import the same Luma file again with the same mapping. Expect “Nothing new to record from this file.” and no change to the count. A file that renames someone or marks a recorded person as a no-show lists that as a proposed change; Brie keeps the recorded details.

## 5. Recovery and isolation

1. Open the same event editor in two tabs. Save different changes from both. Expect the second save to report a conflict instead of silently overwriting the first.
2. Archive the event. Expect it hidden from default lists and read-only. Restore it and confirm its plan remains.
3. Copy a task-page URL including filters, sign out, and open it. Expect sign-in, then the same task page and filters after verifying.
4. Create a second workspace using a separate account. Paste the first workspace's event URL there. Expect an unavailable state, never its data.
5. Remove the member from the first workspace. Their next request should be denied. Check the former assignment display.
6. Disconnect the network and reload /app. Expect a recoverable error, not a false Create workspace screen. Reconnect and retry.
7. Repeat the main task flow with keyboard only, at 375px, and at 200% zoom.

## Automated browser suites

Both suites use Playwright and start the Vite dev server themselves (`playwright.config.ts`). Install the browser once with `npx playwright install chromium`.

- `npm run test:e2e:public` runs without the database: landing and sign-in at all five DESIGN.md viewports, 200% zoom, reduced motion, keyboard-only sign-in, focus and contrast, and unauthenticated routing.
- `npm run test:e2e:release` automates sections 1–5 above, plus invitation recovery, ownership transfer, open-tab role changes, and paste/shared-person/shift/Home scheduling. It uses fresh fictional accounts (`brie-e2e-…@example.test`) so saved local work is never touched. It reads sign-in codes from Mailpit's API and skips itself locally when the stack is not running; CI fails instead of skipping. Each address can request one code per minute, so re-sign-in steps wait; a full run takes several minutes.
- CI runs both browser suites against a full local Supabase stack on each pull request and main-branch push.
- Failures leave traces and screenshots under `test-results/`. Open one with `npx playwright show-trace <trace.zip>`.

## Next implementation priorities

1. Database permission tests cover invitation mismatch/expiry/replay/revocation, member task-only permissions, removed memberships, cross-workspace IDs, attendance privacy, overlapping imports, stale and expired previews, receipt recovery, and version conflicts (`supabase/tests/*.sql`, run in CI). `npm run test:reliability` additionally exercises genuinely overlapping sessions, mid-commit connection termination, late transaction failure, 5,000-row imports, and a disposable database restore. See [DATA_RELIABILITY.md](DATA_RELIABILITY.md) for measured evidence and limits.
2. Browser suites now cover the multi-account demonstration, public viewports, invitation recovery, and ownership transition. Complete targeted mobile, keyboard, and 200% zoom checks on Team and event work screens before release.
3. Before release, verify a full separate-stack setup/restore including owner email-code sign-in, production SMTP and redirect configuration, and capacity through the intended host's HTTP path. Migration replay, database-only restoration and local 5,000-row timing now pass in disposable databases. Complete the license decision. No deployment has been performed.

## Scheduling controls (shadcn)

- Open Run of show → Add segment. Start and end should match the event date and times in its zone, not today's date/current time. Pick a calendar date and verify it stays on that day after save/reload.
- Search city or timezone in Settings or the event form. Settings affect future events only. Changing an event's timezone preserves the entered clock times; existing segments keep their instants.
- For New York, March 8, 2026 at 02:30 is skipped and must be rejected. November 1, 2026 at 01:30 requires a first/second occurrence choice. Reopening an existing segment must preserve the saved occurrence.
- A segment outside the event hours shows a warning; overlap/outside warnings must be explicitly acknowledged. An unsuccessful save must never check the acknowledgment for you.
- On a phone, date and time controls stack and the calendar/editor remain within the screen. Escape closes a calendar first, then the editor; Cancel abandons the draft.
