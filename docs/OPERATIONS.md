# Operations

These are operator responsibilities. Reversion and archive are not privacy erasure.

## Production shape

- Static frontend host that serves `index.html` for `/app/*` and keeps `/` as the approved landing page.
- Supabase (Docker self-host or a documented managed equivalent) with the migrations in `supabase/migrations/`.
- Production SMTP for sign-in OTP. Invitation links are copied by owners; Brie does not send invite email.
- Allowlisted auth redirect URLs that match the deployed origin.
- Telemetry stays off unless a later release decides otherwise.

## Production sign-in email and redirects

Brie signs people in with a six-digit email code, so production needs a real SMTP sender and an exact redirect allowlist. In `supabase/config.toml` (self-host) or the hosted Auth settings, set:

- `site_url` to `https://<your-origin>/app`.
- Redirect allowlist entries for `https://<your-origin>`, `https://<your-origin>/app`, `https://<your-origin>/app/sign-in` and `https://<your-origin>/app/sign-in?**`. The `?**` entry is required because the emailed link returns to the original route (invitations, filtered task pages). Never allow the landing page `/` alone; the session is stored under `/app`.
- `[auth.email.smtp]` with `host`, `port`, `user`, `pass` (read from an environment variable, never committed), `admin_email` and `sender_name`. Keep the `magic_link` and `confirmation` templates pointing at `supabase/templates/magic_link.html` so the code stays in the message body.
- Keep `otp_length = 6`, `max_frequency = "1m0s"` and `otp_expiry` at or below one hour. The app's resend countdown assumes the one-minute limit.

After changing auth settings, restart Auth (`supabase stop` / `supabase start` locally) and verify both paths on the real origin: paste a code from a real inbox, and open the emailed link. Both must land inside `/app` with the session stored and return to the route that started the sign-in.

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

Local migration 0016 was preceded by a custom-format PostgreSQL backup at `/tmp/brie-before-0016-20260914.dump` inside `supabase_db_brie`. This contains local data and should remain private. It is a local pre-migration recovery copy, not an off-host or durable production backup; removing the container can remove it.

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
