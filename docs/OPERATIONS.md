# Operations

These are operator responsibilities. Reversion and archive are not privacy erasure.

## Production shape

- Static frontend host that serves `index.html` for `/app/*` and keeps `/` as the approved landing page.
- Supabase (Docker self-host or a documented managed equivalent) with the migrations in `supabase/migrations/`.
- Production SMTP for sign-in OTP. Invitation links are copied by owners; Brie does not send invite email.
- Allowlisted auth redirect URLs that match the deployed origin.
- Telemetry stays off unless a later release decides otherwise.

## Migrations and upgrades

1. Back up the database.
2. Apply `supabase/migrations` in order.
3. Deploy the matching frontend build.
4. Confirm sign-in, workspace creation, and one attendance import on a staging copy first.

## Backup and restore

Back up PostgreSQL daily. Verify a restore into a separate instance using fictional seed data, not production attendees.

A restore check is complete when:

- The restored database accepts the owner sign-in.
- Event, task, schedule, and active attendance counts match the backup source.
- A reverted import stays reverted.

## Expired preview cleanup

Schedule this daily:

```sql
select public.purge_expired_previews();
```

Expired preview payloads are hidden from reads immediately; this command deletes unused rows.

## Scoped erasure

Product MVP has no workspace or account deletion screen. An operator purge must:

1. Preview impact: memberships, events, tasks, segments, attendees, contributions, previews, and audit IDs for one workspace.
2. Export or retain a backup according to the operator’s retention policy.
3. Delete only that workspace’s rows. Do not delete an `auth.users` row if the person still belongs to another workspace.
4. Record that this is permanent erasure, not attendance reversion.

## License decision checklist

Before publishing:

- [ ] Confirm AGPL-3.0-only or another license with maintainers. Do not add a LICENSE file silently.
- [ ] Audit dependency and vineyard asset licenses.
- [ ] Do not distribute Helvetica Neue font files.

## Release demonstration

Use two workspaces and three roles:

1. Owner creates workspace A and invites an organizer and a member.
2. Organizer creates an event, assigns a task, and adds a schedule.
3. Member completes the task on a 375px-wide viewport.
4. Organizer imports `supabase/sample-attendance.csv`, then imports a second event so one person repeats.
5. Revert the first import and confirm overlapping attendance remains.
6. Confirm workspace B cannot read workspace A.
