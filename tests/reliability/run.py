#!/usr/bin/env python3
"""Real PostgreSQL sessions; only uniquely named disposable databases are mutated."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container', default='supabase_db_brie')
parser.add_argument('--before', help='Stop migration replay before this filename (regression reproduction)')
args = parser.parse_args()
DB = 'brie_reliability_' + uuid.uuid4().hex[:12]
RESTORE = DB + '_restore'
created = []
processes = []
checks = 0


def docker(*command, data=None, check=True):
    result = subprocess.run(['docker', 'exec', '-i', args.container, *command], input=data,
                            text=True, capture_output=True, timeout=120)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result


def sql(statement, database=DB):
    return docker('psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database,
                  data=statement).stdout.strip()


def start(statement, name):
    process = subprocess.Popen(['docker', 'exec', '-i', args.container, 'psql', '-XqAt',
                                '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DB],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name='{name}'; set statement_timeout='30s';\n{statement}\n")
    process.stdin.close()
    process.stdin = None
    processes.append(process)
    return process


def wait_for(predicate, description):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.05)
    raise AssertionError('Timed out waiting for ' + description)


def waiting(name):
    return sql(f"select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='{name}' and wait_event_type='Lock');") == 't'


def finish(process, error=None):
    out, err = process.communicate(timeout=40)
    if error:
        assert process.returncode and f'ERROR:  {error}' in err, (out, err)
    else:
        assert process.returncode == 0, (out, err)
    return out.strip()


def ok(condition, message):
    global checks
    assert condition, message
    checks += 1
    print(f'PASS {message}', flush=True)


def overlap(first, second, error=None):
    """Hold first transaction AFTER its write; prove second waits before releasing it."""
    gate = start('begin; select pg_advisory_xact_lock(918247); select pg_sleep(30); rollback;', 'gate')
    wait_for(lambda: sql("select exists(select 1 from pg_stat_activity where application_name='gate' and datname=current_database() and wait_event='PgSleep');") == 't', 'gate')
    one = start('begin; ' + first + '; select pg_advisory_xact_lock(918247); commit;', 'writer_one')
    wait_for(lambda: waiting('writer_one') or one.poll() is not None, 'first writer')
    assert one.poll() is None, finish(one)
    two = start(second + ';', 'writer_two')
    try:
        wait_for(lambda: waiting('writer_two') or two.poll() is not None, 'second writer')
        ok(waiting('writer_two'), 'independent writers overlap and wait on a database lock')
    finally:
        sql("select pg_cancel_backend(pid) from pg_stat_activity where application_name='gate' and datname=current_database();")
        gate.communicate(timeout=5)
    return finish(one).splitlines()[0], finish(two, error)


OWNER = 'f1000000-0000-4000-8000-000000000001'
ORG = 'f1000000-0000-4000-8000-000000000002'
MEM = 'f1000000-0000-4000-8000-000000000003'
W = 'f1000000-0000-4000-8000-0000000000aa'


def auth(command, user=OWNER):
    return f"set role authenticated; set request.jwt.claim.sub='{user}'; {command}"


def rpc(command, user=OWNER, database=DB):
    return json.loads(sql(auth('select ' + command, user), database))


def event():
    return rpc(f"public.create_event('{W}', 'Reliability rehearsal', '', '', '2026-09-20 18:00Z', '2026-09-20 20:00Z', 'UTC', null, '{uuid.uuid4()}')")['id']


def preview(e, names, user=OWNER):
    rows = json.dumps([{'rowNumber': i+2, 'email': n+'@example.test', 'name': n} for i, n in enumerate(names)])
    return rpc(f"public.prepare_attendance_import('{W}', '{e}', 'fictional.csv', 'fictional-hash', 'brie-csv-1', '{{}}', '{rows}', 0)", user)


def commit(p, key):
    return f"public.commit_attendance_import('{p['id']}', false, '{key}')"


def snapshot(database=DB):
    # Exact row comparison includes identities, source rows, payload purge, revisions and audit.
    tables = sql("select tablename from pg_tables where schemaname='public' order by tablename", database).splitlines()
    return {t: sql(f"select coalesce(jsonb_agg(x order by x::text), '[]') from (select to_jsonb(t) x from public.{t} t) s", database) for t in tables}


def main():
    sql(f'create database {DB} template template0;', 'postgres')
    created.append(DB)
    # Copy schema only: never read/copy local accounts, sessions, or application rows.
    schema = docker('pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--schema=auth',
                    '--no-owner', '--no-privileges', '--exclude-table=auth.schema_migrations').stdout
    # The app's trigger is recreated by migration 0001, not by the auth bootstrap.
    schema = '\n'.join(line for line in schema.splitlines() if not line.startswith('CREATE TRIGGER on_auth_user_created '))
    sql('create schema extensions; create extension pgcrypto with schema extensions;')
    sql(schema)
    sql('grant usage on schema public, auth, extensions to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;')
    for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if args.before and migration.name >= args.before:
            break
        sql(migration.read_text())
    sql('create extension pgtap with schema extensions;')
    for test in sorted((ROOT / 'supabase/tests').glob('*.sql')):
        result = sql('set search_path=public,extensions; ' + test.read_text())
        if 'not ok' in result or 'Looks like' in result:
            print(result, flush=True)
        ok('not ok' not in result and 'Looks like' not in result and '1..' in result,
           'pgTAP ' + test.name)
    print('Replayed migrations in disposable database ' + DB, flush=True)
    sql(f"""insert into auth.users(id,email) values ('{OWNER}','reliability-owner@example.test'),
        ('{ORG}','reliability-organizer@example.test'), ('{MEM}','reliability-member@example.test');
        insert into public.workspaces(id,name,timezone) values ('{W}','Fictional reliability fixtures','UTC');
        insert into public.memberships(workspace_id,user_id,role,email_normalized) values
        ('{W}','{OWNER}','owner','reliability-owner@example.test'),
        ('{W}','{ORG}','organizer','reliability-organizer@example.test'),
        ('{W}','{MEM}','member','reliability-member@example.test');""")

    e = event()
    p = preview(e, ['ana', 'bo'])
    a, b = overlap(auth('select ' + commit(p, 'same-preview-key')), auth('select ' + commit(p, 'same-preview-key')))
    ok(json.loads(a)['id'] == json.loads(b)['id'], 'simultaneous retries return the same receipt')
    ok(sql(f"select count(*) from public.attendance_contributions where event_id='{e}'") == '2', 'retry creates exactly two contributions')
    p1, p2 = preview(e, ['cy']), preview(e, ['dan'])
    overlap(auth('select ' + commit(p1, 'different-preview-1')), auth('select ' + commit(p2, 'different-preview-2')), 'CONFLICT')
    ok(rpc(f"public.get_event('{W}','{e}')")['attendanceCount'] == 3, 'competing preview is rejected without adding people')

    # A preview must wait for the in-flight commit and describe its committed revision.
    e2 = event()
    p = preview(e2, ['snapshot'])
    rows = '[{"rowNumber":2,"email":"snapshot@example.test","name":"snapshot"}]'
    _, result = overlap(auth('select ' + commit(p, 'snapshot-commit')), auth(f"select public.prepare_attendance_import('{W}','{e2}','snapshot.csv','hash','brie-csv-1','{{}}','{rows}',0)"))
    ok(json.loads(result)['counts']['alreadyRecorded'] == 1, 'preview sees committed attendance and matching revision')

    # Optimistic event edits, plus archive during a pending import.
    def edit(title):
        return auth(f"select public.update_event('{W}','{e}','{title}','','','2026-09-20 18:00Z','2026-09-20 20:00Z','UTC',null,'planned',1)")
    overlap(edit('First edit'), edit('Second edit'), 'CONFLICT')
    ok(rpc(f"public.get_event('{W}','{e}')")['title'] == 'First edit', 'concurrent event edit cannot overwrite newer data')
    e3 = event()
    p = preview(e3, ['archived'])
    overlap(auth(f"select public.archive_event('{W}','{e3}',1)"), auth('select ' + commit(p, 'archive-race-key')), 'FORBIDDEN')
    ok(sql(f"select count(*) from public.attendance_batches where event_id='{e3}'") == '0', 'archive winning the race blocks attendance')

    # Creation retries must wait BEFORE looking up their request key.
    creation = auth(f"select public.create_event('{W}','Retry event','','','2026-09-20 18:00Z','2026-09-20 20:00Z','UTC',null,'concurrent-create-key')")
    a, b = overlap(creation, creation)
    ok(json.loads(a)['id'] == json.loads(b)['id'], 'simultaneous event creation returns one event, not a unique-key error')
    member_id = sql(f"select id from public.memberships where workspace_id='{W}' and user_id='{MEM}'")
    organizer_id = sql(f"select id from public.memberships where workspace_id='{W}' and user_id='{ORG}'")
    owner_id = sql(f"select id from public.memberships where workspace_id='{W}' and user_id='{OWNER}'")
    task = rpc(f"public.save_task('{W}','{e}',null,'Assigned task','','{member_id}',null,'todo',null,'assigned-task-key')")
    overlap(auth(f"select public.set_task_status('{W}','{task['id']}','done',1)", MEM),
            auth(f"select public.set_task_status('{W}','{task['id']}','in_progress',1)", MEM), 'CONFLICT')
    ok(sql(f"select status from public.tasks where id='{task['id']}'") == 'done', 'simultaneous task status saves retain the winning version')
    # Demotion must take effect before a waiting organizer command authorizes itself.
    p = preview(e, ['demoted'], ORG)
    overlap(auth(f"select public.change_member_role('{W}','{organizer_id}','member',1)"),
            auth('select ' + commit(p, 'demotion-race-key'), ORG), 'FORBIDDEN')
    ok(sql(f"select count(*) from public.attendance_batches where preview_id='{p['id']}'") == '0', 'demoted organizer cannot finish a queued import')
    rpc(f"public.change_member_role('{W}','{organizer_id}','organizer',2)")
    # Removal racing a NEW assignment used to allow the removed membership through.
    departed = 'f1000000-0000-4000-8000-000000000004'
    sql(f"insert into auth.users(id,email) values ('{departed}','departed@example.test'); insert into public.memberships(workspace_id,user_id,role,email_normalized) values ('{W}','{departed}','member','departed@example.test');")
    departed_id = sql(f"select id from public.memberships where user_id='{departed}'")
    overlap(auth(f"select public.remove_member('{W}','{departed_id}',1)"),
            auth(f"select public.save_task('{W}','{e}',null,'Invalid assignment','','{departed_id}',null,'todo',null,'removed-assignment-key')"), 'VALIDATION')
    ok(sql("select count(*) from public.tasks where title='Invalid assignment'") == '0', 'removal prevents a concurrent new assignment')
    overlap(auth(f"select public.transfer_ownership('{W}','{organizer_id}',1,3)"),
            auth(f"select public.transfer_ownership('{W}','{member_id}',1,1)"), 'FORBIDDEN')
    ok(sql(f"select count(*) from public.memberships where workspace_id='{W}' and role='owner' and removed_at is null") == '1', 'concurrent ownership transfers leave exactly one owner')
    rpc(f"public.transfer_ownership('{W}','{owner_id}',4,2)", ORG)

    # Interrupt after the second contribution has actually been inserted.
    e4 = event()
    p = preview(e4, ['interrupted-one', 'interrupted-two', 'interrupted-three'])
    sql("""create function public.reliability_pause() returns trigger language plpgsql as $$
      begin if new.source_row_number = 3 then perform pg_advisory_xact_lock(918248); end if; return new; end $$;
      revoke all on function public.reliability_pause() from public, anon, authenticated;
      create trigger reliability_pause after insert on public.attendance_contributions
      for each row execute function public.reliability_pause();""")
    before = snapshot()
    gate = start('begin; select pg_advisory_xact_lock(918248); select pg_sleep(30); rollback;', 'interrupt_gate')
    wait_for(lambda: sql("select exists(select 1 from pg_stat_activity where application_name='interrupt_gate' and datname=current_database() and wait_event='PgSleep')") == 't', 'interrupt gate')
    writer = start(auth('select ' + commit(p, 'interrupted-key')), 'interrupted_writer')
    wait_for(lambda: waiting('interrupted_writer'), 'second contribution inserted')
    sql("select pg_terminate_backend(pid) from pg_stat_activity where datname=current_database() and application_name='interrupted_writer'")
    out, err = writer.communicate(timeout=10)
    ok(writer.returncode != 0 and 'terminating connection' in err, 'database connection terminated partway through commit')
    sql("select pg_cancel_backend(pid) from pg_stat_activity where datname=current_database() and application_name='interrupt_gate'")
    gate.communicate(timeout=5)
    ok(before == snapshot(), 'interruption rolls back identities, receipt, contributions, preview, revision and audit')
    sql('drop trigger reliability_pause on public.attendance_contributions; drop function public.reliability_pause();')
    receipt = rpc(commit(p, 'interrupted-key'))
    ok(receipt['added'] == 3, 'same preview and key recover successfully after interruption')
    ok(rpc(f"public.lookup_import_receipt('{W}','{e4}','{p['id']}','interrupted-key')")['id'] == receipt['id'], 'receipt lookup recovers a committed response')

    # Failure at the final audit write must undo the earlier preview purge as well.
    p = preview(e4, ['late-failure'])
    sql("""create function public.reliability_fail() returns trigger language plpgsql as $$
      begin raise exception 'INJECTED_FAILURE'; end $$;
      revoke all on function public.reliability_fail() from public, anon, authenticated;
      create trigger reliability_fail before insert on public.audit_entries
      for each row execute function public.reliability_fail();""")
    before = snapshot()
    finish(start(auth('select ' + commit(p, 'late-failure-key')), 'failed_writer'), 'INJECTED_FAILURE')
    ok(before == snapshot(), 'late commit failure rolls back even preview purge and revision update')
    sql('drop trigger reliability_fail on public.audit_entries; drop function public.reliability_fail();')
    rpc(commit(p, 'late-failure-key'))
    # Two simultaneous reversions are harmless retries, not double revision changes.
    batch_id = rpc(commit(p, 'late-failure-key'))['id']
    impact = rpc(f"public.preview_revert_import('{W}','{batch_id}')")
    revert = auth(f"select public.revert_attendance_import('{W}','{batch_id}',{impact['batchVersion']},{impact['attendanceVersion']})")
    a, b = overlap(revert, revert)
    ok(json.loads(a)['id'] == json.loads(b)['id'] and json.loads(b)['status'] == 'reverted', 'simultaneous reversion returns the same reverted receipt')
    ok(sql(f"select version from public.event_attendance_revisions where event_id='{e4}'") == str(impact['attendanceVersion']+1), 'simultaneous reversion increments attendance revision once')

    # Five thousand distinct rows, followed by five thousand overlapping rows.
    for iteration in range(2):
        big_event = event() if iteration == 0 else big_event
        started = time.monotonic()
        big = preview(big_event, ['capacity-'+str(i) for i in range(5000)])
        preview_seconds = time.monotonic() - started
        started = time.monotonic()
        receipt = rpc(commit(big, 'capacity-key-'+str(iteration)))
        commit_seconds = time.monotonic() - started
        print(f'TIMING 5000 rows ({"new" if iteration == 0 else "overlap"}): preview={preview_seconds:.3f}s commit={commit_seconds:.3f}s (includes local Docker/psql transport)', flush=True)
        ok(preview_seconds < 10 and commit_seconds < 10, '5000-row preview and commit each meet the 10-second local budget')
        ok(receipt['added'] == (5000 if iteration == 0 else 0), 'capacity receipt reconciles distinct attendance')
    ok(rpc(f"public.get_event('{W}','{big_event}')")['attendanceCount'] == 5000, 'overlapping 5000-row import does not double count')

    # Preserve nonempty tasks/schedule and a reverted overlapping batch through restore.
    sql(f"insert into public.tasks(workspace_id,event_id,title,created_by) values ('{W}','{e}','Restore task','{OWNER}');")
    sql(f"insert into public.schedule_segments(workspace_id,event_id,title,starts_at,ends_at) values ('{W}','{e}','Restore segment','2026-09-20 18:00Z','2026-09-20 18:30Z');")
    impact = rpc(f"public.preview_revert_import('{W}','{receipt['id']}')")
    rpc(f"public.revert_attendance_import('{W}','{receipt['id']}',{impact['batchVersion']},{impact['attendanceVersion']})")
    source = snapshot()
    dump = docker('pg_dump', '-U', 'postgres', '-d', DB, '--no-owner').stdout
    sql(f'create database {RESTORE} template template0;', 'postgres')
    created.append(RESTORE)
    sql(dump, RESTORE)
    ok(source == snapshot(RESTORE), 'backup restore matches every application row, including reverted batches and audit')
    ok(sql('select row_to_json(u) from auth.users u order by id') == sql('select row_to_json(u) from auth.users u order by id', RESTORE), 'fictional auth accounts survive backup restore')
    ok(rpc(f"public.get_workspace('{W}')", database=RESTORE)['role'] == 'owner', 'restored owner can access workspace through authenticated RPC')
    ok(rpc(f"public.get_event('{W}','{big_event}')", database=RESTORE)['attendanceCount'] == 5000, 'restored active attendance preserves overlapping evidence after reversion')
    denied = docker('psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', RESTORE,
                    data=auth(f"select public.list_event_people('{W}','{big_event}','',1)", MEM), check=False)
    ok(denied.returncode != 0 and 'FORBIDDEN' in denied.stderr, 'restored grants and authorization still deny member attendance access')
    print(f'Completed {checks} reliability assertions. Browser OTP and remote disaster recovery are separate checks.', flush=True)


try:
    main()
finally:
    for database in reversed(created):
        assert database.startswith('brie_reliability_')
        sql(f'drop database if exists {database} with (force);', 'postgres')
    for process in processes:
        if process.poll() is None:
            process.communicate(timeout=5)
