# Data reliability verification

Run `npm run test:reliability` with Python 3, Docker and the local Supabase database running. No extra Python packages are required. To select another local container, use `python3 tests/reliability/run.py --container <name>`.

The harness creates two unique `brie_reliability_<random>` databases in that container. It copies only the Auth **schema**, replays every application migration, runs the pgTAP suite, and creates fictional fixtures. It never copies local account/session/application rows or resets the existing database. Its `finally` cleanup drops only the databases it created. If the runner is forcibly killed, inspect leftover databases with that prefix before manually removing them. Each worker has a 30-second statement timeout and the runner bounds its waits.

## What it proves

Separate PostgreSQL connections hold the first writer's transaction open after its write. The harness observes the second writer waiting on a database lock before releasing the first. These are overlapping transactions, not sequential stale-version simulations.

- Simultaneous attendance retries return one receipt and one contribution per person; competing previews conflict without partial effects.
- A preview started during an import sees its committed revision/counts.
- Event edits and assigned-member task status changes preserve the winning version. Concurrent event creation retries return one event.
- Archive and organizer demotion block queued attendance writes. Member removal blocks a queued new assignment. Competing ownership transfers leave exactly one owner.
- Terminating a connection after its second contribution has been inserted rolls back **all** affected tables. The same preview/key can subsequently succeed. A forced failure at the final audit write also rolls back the preview purge and revision increment.
- Receipt lookup recovers a completed response. Expired previews and archived events still allow authorized recovery of existing receipts; missing previews cannot bypass workspace/creator checks.
- Concurrent reversions return the same reverted receipt and increment attendance revision once.
- Two 5,000-row imports reconcile new and already-recorded people, preserve 5,000 distinct attendees, and meet the local 10-second budget for each preview/commit.
- A `pg_dump` of the fictional database restores into a second empty database. Every application row matches, including tasks, schedule, identities, contribution source rows, preview payloads, revisions, audit, and reverted batches. Fictional Auth accounts match, owner RPC access succeeds, and member attendance access remains denied.

CI runs this harness after the normal migration/database test job. The harness itself also runs all pgTAP files against its migration replay. A failure in either SQL assertions or concurrent assertions fails the job.

## Evidence — 2026-09-14

Environment: local Colima/Docker, ARM64, PostgreSQL 15.8, 4 virtual CPUs and approximately 7.7 GiB available to the Docker VM. Timings include local Docker/psql process transport and JSON decoding, but exclude browser CSV parsing and remote HTTP/network latency. These are individual measurements, not p95 or production guarantees.

| 5,000-row case | Before preview optimization | Verified preview | Verified commit |
| --- | ---: | ---: | ---: |
| New identities | 4.598 s | 0.223 s | 0.242 s |
| Already recorded at this event | 25.458 s | 0.278 s | 0.349 s |

The original preview repeatedly concatenated JSON arrays and queried distinct attendance for each row. Migration `0016_data_reliability.sql` normalizes/ranks rows once, joins the active attendance set once, and aggregates results in original input order. Existing first-name, duplicate, invalid-row, and normalization behavior is retained and regression-tested.

The same migration makes event/task/schedule/settings mutations and attendance previews acquire the workspace lock before authorization, request-key lookup and validation. Membership administration and attendance commit/reversion already use that lock. This intentionally serializes writes within a small-team workspace; unrelated workspaces use different locks. RPC names, arguments and response types are unchanged, so the existing typed application API needs no changes.

Verification: **125 pgTAP checks plus 39 additional reliability assertions** (the runner prints 48 passes, including nine pgTAP file groups); 69 app tests, lint and production build pass. Existing Fast Refresh and bundle-size warnings remain. Migration 0016 is additive and replaces functions without rewriting saved rows.

## Limits and remaining release checks

This is a database-level restore exercise into a separate database on the same PostgreSQL server. It does **not** prove fresh-server role provisioning, SMTP delivery, browser email-code sign-in, or recovery of a full Supabase deployment. Cluster roles already exist and are not part of the database dump. Complete the full-instance/sign-in exercise in [OPERATIONS.md](OPERATIONS.md) before release.

Capacity fixtures cover 5,000-row new and overlapping imports, not the entire 500-event/10,000-identity design envelope or concurrent workspace throughput. Re-measure on the intended host and through its HTTP/auth path. Full multi-account browser acceptance and production configuration remain separate release work.
