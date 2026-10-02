# Operations

These are operator responsibilities. Reversion and archive are not privacy erasure.

## Production shape

- Static frontend host that serves `index.html` for `/app/*` and keeps `/` as the approved landing page.
- Supabase (Docker self-host or a documented managed equivalent) with the migrations in `supabase/migrations/`.
- Production SMTP for sign-in OTP.
- The `send-invitation` Edge Function with a Resend key for invitation email. Owners can always copy the link if email is unavailable.
- Allowlisted auth redirect URLs that match the deployed origin.
- Telemetry stays off unless a later release decides otherwise.

## Production sign-in email and redirects

Follow the managed Supabase setup in [DEPLOYMENT.md](DEPLOYMENT.md#3-configure-auth-and-sign-in-email). Hosted Auth settings and email templates are entered in the Supabase dashboard; `supabase db push` applies database migrations only. A self-hosted Supabase installation needs its own Auth environment configuration and SMTP transport using the [official self-hosting instructions](https://supabase.com/docs/guides/self-hosting). In either case, verify six-digit code and email-link sign-in on the exact deployed HTTPS origin, including a return to an invitation route.

## Migrations and upgrades

1. Back up the database.
2. Apply `supabase/migrations` in order.
3. Deploy the matching frontend build.
4. Confirm sign-in, workspace creation, and one attendance import on a staging copy first.

## Backup and restore

Back up PostgreSQL daily. Verify a restore into a separate instance using fictional seed data, not production attendees.

For the automated database-level rehearsal, start the local database and run `npm run test:reliability`. It backs up fictional fixtures with `pg_dump`, restores into a second empty database, compares every application row and fictional Auth account, and checks owner/member RPC permissions. It cleans up both disposable databases. See [DATA_RELIABILITY.md](DATA_RELIABILITY.md) for scope, measurements and failure cleanup.

That rehearsal uses existing cluster roles on the same server. A full recovery must also provision the destination's Supabase roles/services/configuration, restore the Auth data, and exercise actual email-code sign-in. It is not complete merely because database contents match.

A restore check is complete when:

- The restored database accepts the owner sign-in.
- Event, task, schedule, and active attendance counts match the backup source.
- A reverted import stays reverted.

Event files (`0064_event_attachments.sql`) are stored in the Storage bucket `event-files`, not in PostgreSQL, so `pg_dump` and the reliability rehearsal back up their records but not their bytes. Back up the bucket separately (for example, with the S3-compatible endpoint) on the same schedule. Removing a file in the app only hides it so it can be restored; the bytes stay in the bucket.

Local migration 0016 was preceded by a custom-format PostgreSQL backup at `/tmp/brie-before-0016-20260914.dump` inside `supabase_db_brie`. This contains local data and should remain private. It is a local pre-migration recovery copy, not an off-host or durable production backup; removing the container can remove it.

## Expired preview cleanup

Schedule this daily:

```sql
select public.purge_expired_previews();
select public.purge_expired_import_sources();
```

Expired preview payloads and kept original rows past their 180-day limit are hidden from reads immediately; these commands delete them.

## Scoped erasure

Product MVP has no workspace or account deletion screen. An operator purge must:

1. Preview impact: memberships, events, tasks, segments, event attachments, attendees, contributions, previews, and audit IDs for one workspace.
2. Export or retain a backup according to the operator’s retention policy.
3. Delete only that workspace’s rows, and the Storage objects under `event-files/<workspace id>/`. Do not delete an `auth.users` row if the person still belongs to another workspace.
4. Record that this is permanent erasure, not attendance reversion.

To remove one person's kept original import rows in a workspace (for example, on request), run `select public.erase_import_source_rows('<workspace id>', '<email>');`. It returns the number of rows removed. Kept rows without an email cannot be matched to a person; delete that import's kept rows from its receipt instead. This removes only kept source rows, not the person's attendance or identity.

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
