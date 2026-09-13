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

1. In Welcome night → Attendance, import `supabase/sample-attendance.csv`. Review mapping and every outcome before confirming. Expect the receipt and event count to agree.
2. Import `tests/fixtures/attendance-a.csv`, then `attendance-b.csv`. The files share Bo. Expect three distinct people across these two batches, not four (plus any distinct people from the sample import).
3. Revert batch A. Expect Ana to disappear from this event and Bo and Cy to remain. The reverted receipt stays visible.
4. Duplicate the event with new dates. Expect Draft, Todo tasks, no assignees/due dates, shifted schedule, and no attendance.
5. Import batch B into the second event. In workspace Attendance, expect Bo and Cy to each have two events; repeated evidence within one event counts only once.

## 5. Recovery and isolation

1. Open the same event editor in two tabs. Save different changes from both. Expect the second save to report a conflict instead of silently overwriting the first.
2. Archive the event. Expect it hidden from default lists and read-only. Restore it and confirm its plan remains.
3. Copy a task-page URL including filters, sign out, and open it. Expect sign-in, then the same task page and filters after verifying.
4. Create a second workspace using a separate account. Paste the first workspace's event URL there. Expect an unavailable state, never its data.
5. Remove the member from the first workspace. Their next request should be denied. Check the former assignment display.
6. Disconnect the network and reload /app. Expect a recoverable error, not a false Create workspace screen. Reconnect and retry.
7. Repeat the main task flow with keyboard only, at 375px, and at 200% zoom.

## Next implementation priorities

1. Database permission tests now cover invitation mismatch/expiry/replay/revocation, member task-only permissions, removed memberships, cross-workspace IDs, attendance privacy, overlapping imports, stale and expired previews, and version conflicts (`supabase/tests/*.sql`, run in CI). Not covered: truly simultaneous sessions and a failure partway through a commit; pgTAP runs one session per test file, so version-conflict tests stand in for concurrent writes.
2. Automate the multi-account browser demonstration above and complete all five design viewports, focus/dialog behavior, and landing baseline comparison.
3. Before release, verify clean migration replay in a separate stack, backup restoration, 5,000-row import timing, production SMTP and redirect configuration. Complete the license decision. No deployment has been performed.

## Scheduling controls (shadcn)

- Open Run of show → Add segment. Start and end should match the event date and times in its zone, not today's date/current time. Pick a calendar date and verify it stays on that day after save/reload.
- Search city or timezone in Settings or the event form. Settings affect future events only. Changing an event's timezone preserves the entered clock times; existing segments keep their instants.
- For New York, March 8, 2026 at 02:30 is skipped and must be rejected. November 1, 2026 at 01:30 requires a first/second occurrence choice. Reopening an existing segment must preserve the saved occurrence.
- A segment outside the event hours shows a warning; overlap/outside warnings must be explicitly acknowledged. An unsuccessful save must never check the acknowledgment for you.
- On a phone, date and time controls stack and the calendar/editor remain within the screen. Escape closes a calendar first, then the editor; Cancel abandons the draft.
