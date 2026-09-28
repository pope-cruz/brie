-- Pending outcomes for mixed attendance imports. No behavior is asserted yet.
-- Fixtures (the database cannot read these files during supabase test db):
--   tests/fixtures/mixed-attendance-luma.csv
--   tests/fixtures/mixed-attendance-google-form.csv
-- Unit coverage of the same rows: tests/unit/mixed-attendance.test.ts
--
-- Organizer map assumed below:
--   Luma approval_status: approved = rsvp yes, declined = rsvp no, blank = unknown.
--   Luma checked_in_at: any non-blank value means attended; blank means unknown.
--   Google "Will you attend?": Yes = rsvp yes, No = rsvp no, blank = unknown.
--   Google "Checked in at the door?": Yes = attended, No = no_show;
--     Maybe, blank, and any other value mean unknown.
-- RSVP never implies attendance. Identity stays normalized email.
-- A missing email is staged unresolved and is not merged by name or phone.
--
-- These tests use skip(), not todo(). A failing TODO is still reported as a
-- failure line, and tests/reliability/run.py treats that line as a failed file.
begin;
select plan(16);

-- PR 2. Preview rows store RSVP and attendance separately.
select skip('PR 2: checked-in rows store rsvp yes and attendance attended as separate fields (Luma Mira Okonkwo row 2 mira.okonkwo@example.test; Google Priya Raman row 2 priya.raman@example.test)', 1);

-- PR 2. Blank check-in is unknown, not attended.
select skip('PR 2: RSVP yes with a blank check-in stores attendance unknown (Luma Jules Navarro row 3 jules.navarro@example.test; Google Rowan Kim row 5 rowan.kim@example.test)', 1);

-- PR 2. RSVP no does not count as attended.
select skip('PR 2: RSVP no stores rsvp no and attendance unknown (Luma Ren Sato row 4 ren.sato@example.test; Google Casey Adebayo row 4 casey.adebayo@example.test)', 1);

-- PR 2. Explicit no-show is its own status and does not contribute.
select skip('PR 2: explicit no-show stores attendance no_show separate from rsvp yes and creates no contribution (Google Elio Marquez row 3 elio.marquez@example.test; Google Quinn Ibarra row 10 quinn.ibarra@example.test)', 1);

-- PR 2. Blank status is unknown.
select skip('PR 2: blank status stores rsvp unknown and attendance unknown (Luma Noor El-Sayed row 5 noor.elsayed@example.test; Google Samira Costa row 8 samira.costa@example.test)', 1);

-- PR 2. Unrecognized attendance values are unknown.
select skip('PR 2: unrecognized attendance value Maybe stores attendance unknown (Google Niall Berg row 9 niall.berg@example.test)', 1);

-- PR 2. Missing email is unresolved and is not merged by name or phone.
select skip('PR 2: a missing email is staged unresolved and is not merged by name or phone (Luma Sasha Quinn row 9 vs sasha.quinn@example.test row 8; Google Quinn Ibarra row 7 vs quinn.ibarra@example.test row 10)', 1);

-- PR 2. Duplicate email is one person.
select skip('PR 2: a duplicate email collapses to one person (Luma Mira Okonkwo row 7 mira.okonkwo@example.test; Google Elio Marquez row 6 elio.marquez@example.test)', 1);

-- PR 2. Contribution model: only attended rows count. guest.desk has no name but has an email and a check-in.
select skip('PR 2: only attendance attended creates contributions; Luma count is 3 (mira.okonkwo@example.test, guest.desk@example.test, sasha.quinn@example.test) and Google count is 1 (priya.raman@example.test)', 1);

-- PR 2. New RPCs follow the existing privilege allowlist.
select skip('PR 2: new mixed-attendance security-definer functions are revoked from public, anon, and authenticated, and any still granted to authenticated are added to the function_privileges.sql allowlist', 1);

-- PR 2. Unresolved rows stay inside the workspace.
select skip('PR 2: an organizer in another workspace cannot read unresolved source rows or mixed preview detail', 1);

-- PR 4. Preview groups. Enabled once PR 2 stores the statuses.
select skip('PR 4: Luma groups will-count as mira.okonkwo@example.test, guest.desk@example.test, and sasha.quinn@example.test; wont-count as jules.navarro@example.test, ren.sato@example.test, and noor.elsayed@example.test; needs-review as the email-less Sasha Quinn row; the second Mira row is a duplicate', 1);

select skip('PR 4: Google groups will-count as priya.raman@example.test only; wont-count as elio.marquez@example.test, casey.adebayo@example.test, rowan.kim@example.test, samira.costa@example.test, niall.berg@example.test, and quinn.ibarra@example.test; needs-review as the email-less Quinn Ibarra row; the second Elio row is a duplicate', 1);

-- PR 5. Repeat import shows proposals and does not double-count or overwrite.
select skip('PR 5: importing the Luma fixture again proposes no additions, creates no second contribution, and leaves the attendance count at 3', 1);

select skip('PR 5: a repeat row that renames Mira Okonkwo to Mira O. is reported as a proposed change and does not overwrite the stored name', 1);

select skip('PR 5: a failed commit of a mixed preview rolls back contributions and unresolved rows together', 1);

select * from finish();
rollback;
