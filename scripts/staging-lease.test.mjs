import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

// Every staging entry point goes through scripts/staging-lease.sh. The suite
// drives the real script against a private state dir and a stubbed
// `runuser … psql`. SCENARIO models the broker registry (ops_staging_leases):
//   present          table exists, no live lease — the default every allowed path is tested on
//   held             table exists, a foreign live lease
//   absent           table missing (owner decision, chat 3660: refusal, never readiness)
//   unreadable       psql fails on every query
//   unreadable-live  the registry probe answers, the lease query fails
//   garbage / empty  unexpected answers to the registry probe
// The restore hook is a real executable whose outcome is steered through control
// files, so its bytes (pinned at `enter`) never change between runs; it models the
// infra policy "never start an unverified tree": step apply|activate → exit 4.
// Fixtures live inside the checkout: the ops-runner mounts /tmp noexec.
const SCRIPT = join(process.cwd(), 'scripts/staging-lease.sh');

function fixture() {
  const dir = mkdtempSync(join(process.cwd(), '.staging-lease-test-'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/runuser'), `#!/bin/bash
set -e
# Real psql interpolates :'var' only in SQL read from stdin, never inside -c — so the
# stub, like the server, takes the statement from stdin and logs args and SQL apart.
sql=$(cat | tr -s '\\n\\t ' ' ')   # one line per call in the log
echo "$SCENARIO: $* | stdin: $sql" >> "${dir}/db-calls"
[ "$SCENARIO" != unreadable ]
case "$sql" in
  *to_regclass*) case "$SCENARIO" in absent) echo f ;; garbage) echo 'psql: notice: something else' ;; empty) ;; *) echo t ;; esac ;;
  *released_at*) [ "$SCENARIO" != unreadable-live ]; if [ "$SCENARIO" = held ]; then echo "7 quiet-window job=20841 holder_pid=1 expires=2026-10-02T12:00:00Z"; fi ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(dir, 'restore.sh'), `#!/bin/bash
echo "restore reason=$STAGING_RESTORE_REASON id=$STAGING_MAINTENANCE_ID holder=$STAGING_MAINTENANCE_HOLDER step=$STAGING_MAINTENANCE_STEP attempt=$STAGING_RESTORE_ATTEMPT" >> "${dir}/restore-calls"
case "$STAGING_MAINTENANCE_STEP" in apply|activate) echo "policy: tree may be partially installed — not started" >> "${dir}/restore-calls"; exit 4 ;; esac
exit "$(cat "${dir}/restore-exit")"
`, { mode: 0o755 });
  writeFileSync(join(dir, 'restore-exit'), '0\n');
  const env = (extra = {}) => ({
    ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, SCENARIO: 'present',
    STAGING_STATE_DIR: join(dir, 'state'), STAGING_LOCK_WAIT_SECONDS: '1', GODCRM_STAGING_LOCK_PID: '', ...extra,
  });
  const lease = (args, extra = {}) => {
    const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 20000, env: env(extra) });
    expect(r.error).toBeUndefined();
    return r;
  };
  const enter = (extra = {}, args = []) => {
    const r = lease(['enter', '--holder', 'sysadmin-3660', '--restore', join(dir, 'restore.sh'), ...args], extra);
    expect(r.status, r.stderr).toBe(0);
    const token = /^STAGING_MAINTENANCE_TOKEN=([0-9a-f]{32})$/m.exec(r.stdout)?.[1];
    expect(token).toBeDefined();
    return token;
  };
  // Long-running `run`; resolves with the exit status once the command ends.
  const runAsync = (cmd, extra = {}) => {
    const child = spawn('bash', [SCRIPT, 'run', '--', 'bash', '-c', cmd], { env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', d => { stderr += d; });
    const done = new Promise(resolve => child.on('close', code => resolve({ code, stderr })));
    return { child, done };
  };
  const calls = f => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean) : []);
  const state = () => readFileSync(join(dir, 'state/maintenance'), 'utf8');
  const field = (out, key) => new RegExp(`^${key}=(.*)$`, 'm').exec(out)?.[1];
  return { dir, lease, enter, runAsync, calls, state, field, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hook = f => join(f.dir, 'restore.sh');

test('check: present empty registry → exit 0 after the registry was asked; a foreign broker lease → 75 with the lease named', () => {
  const f = fixture();
  try {
    const ok = f.lease(['check']);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('gate: free');
    expect(f.calls('db-calls').some(c => c.startsWith('present:') && c.includes('to_regclass'))).toBe(true);
    const held = f.lease(['check'], { SCENARIO: 'held' });
    expect(held.status).toBe(75);
    expect(held.stderr).toContain('BLOCKED');
    expect(held.stderr).toContain('job=20841');
  } finally { f.cleanup(); }
});

test('check: broker token travels as a psql variable, never interpolated', () => {
  const f = fixture();
  try {
    const r = f.lease(['check'], { STAGING_LEASE_TOKEN: "x'; drop table ops_staging_leases; --" });
    expect(r.status, r.stderr).toBe(0);
    const calls = f.calls('db-calls');
    expect(calls.join('\n')).toContain("tok=x'; drop table");
    // The statement itself must arrive on stdin: psql ignores :'tok' inside -c.
    for (const c of calls) {
      const [args, sql] = c.split(' | stdin: ');
      expect(args, c).not.toMatch(/(^| )-c( |$)/);
      expect(args, c).not.toContain('select');
      expect(sql, c).toMatch(/^select /);
    }
    expect(calls.some(c => c.includes("holder_token <> :'tok'"))).toBe(true);
  } finally { f.cleanup(); }
});

test('check: absent registry, unreadable database or an unexpected answer → fail closed (1), never free', () => {
  const f = fixture();
  try {
    for (const SCENARIO of ['absent', 'unreadable', 'unreadable-live', 'garbage', 'empty']) {
      const r = f.lease(['check'], { SCENARIO });
      expect(r.status, SCENARIO).toBe(1);
      expect(r.stderr, SCENARIO).toContain('fail closed');
      expect(r.stdout, SCENARIO).not.toContain('gate:');
    }
    const absent = f.lease(['check'], { SCENARIO: 'absent' });
    expect(absent.stderr).toContain('ops_staging_leases absent');
    expect(absent.stderr).not.toContain('WARN');
    expect(existsSync(join(f.dir, 'state/maintenance'))).toBe(false);
    // The active holder gets no bypass either: a missing registry refuses before the local record is consulted as readiness.
    const token = f.enter();
    expect(f.lease(['check'], { SCENARIO: 'absent' }).status).toBe(75); // outsider: the local maintenance blocks before the DB is even asked
    expect(f.lease(['check'], { SCENARIO: 'absent', STAGING_MAINTENANCE_TOKEN: token }).status).toBe(1);
    expect(f.lease(['check'], { STAGING_MAINTENANCE_TOKEN: token }).status).toBe(0); // registry back → holder passes
  } finally { f.cleanup(); }
});

test('run: absent registry refuses before the payload — outsider, holder and a fresh enter alike', () => {
  const f = fixture();
  try {
    const payload = `touch "${f.dir}/payload"`;
    for (const SCENARIO of ['absent', 'unreadable', 'unreadable-live', 'garbage', 'empty']) {
      const r = f.lease(['run', '--', 'bash', '-c', payload], { SCENARIO });
      expect(r.status, SCENARIO).toBe(1);
      expect(existsSync(join(f.dir, 'payload')), SCENARIO).toBe(false);
    }
    expect(f.calls('db-calls').filter(c => c.startsWith('absent:'))).toHaveLength(1); // probed once, refused, no lease query
    const enter = f.lease(['enter', '--holder', 'sysadmin-3660', '--restore', hook(f)], { SCENARIO: 'absent' });
    expect(enter.status).toBe(1);
    expect(enter.stdout).not.toContain('STAGING_MAINTENANCE_TOKEN');
    expect(existsSync(join(f.dir, 'state/maintenance'))).toBe(false);
    expect(existsSync(join(f.dir, 'state/heartbeat'))).toBe(false);
    // Active holder + registry gone: a NEW modifying operation is refused before its payload.
    const token = f.enter();
    const holder = f.lease(['run', '--', 'bash', '-c', payload], { SCENARIO: 'absent', STAGING_MAINTENANCE_TOKEN: token });
    expect(holder.status).toBe(1);
    expect(holder.stderr).toContain('ops_staging_leases absent');
    expect(existsSync(join(f.dir, 'payload'))).toBe(false);
    expect(f.field(f.state(), 'phase')).toBe('active'); // the refusal does not touch the maintenance record
    // Legitimate nesting inside an operation admitted under the gate is unchanged: the
    // registry answer at admission binds the whole operation, descendants never re-gate,
    // and the lock stays held throughout — even when the nested `run` lands in the very
    // pid the outer `run` exec'd into (a fresh open of the lock file must NOT acquire it).
    const probe = `exec 8>"${f.dir}/state/lock"; if flock -n 8; then echo LOCK_LOST; exit 9; fi; ${payload}`;
    const nested = f.lease(['run', '--', 'bash', '-c', `SCENARIO=absent bash "${SCRIPT}" run -- bash -c '${probe}'`], { STAGING_MAINTENANCE_TOKEN: token });
    expect(nested.status, nested.stderr + nested.stdout).toBe(0);
    expect(existsSync(join(f.dir, 'payload'))).toBe(true);
    expect(f.calls('db-calls').filter(c => c.startsWith('absent:'))).toHaveLength(3); // loop, enter, holder run — the nested run never asked the DB
  } finally { f.cleanup(); }
});

test('status: absent registry → exit 1 with db_lease=absent, gate=refused and the local owner/phase still reported', () => {
  const f = fixture();
  try {
    const none = f.lease(['status'], { SCENARIO: 'absent' });
    expect(none.status).toBe(1);
    expect(f.field(none.stdout, 'maintenance')).toBe('none');
    expect(f.field(none.stdout, 'db_lease')).toBe('absent');
    expect(f.field(none.stdout, 'gate')).toBe('refused');
    expect(f.field(none.stdout, 'reason')).toBe('registry_absent');
    const token = f.enter();
    f.lease(['mark', 'capture'], { STAGING_MAINTENANCE_TOKEN: token });
    const held = f.lease(['status'], { SCENARIO: 'absent' });
    expect(held.status).toBe(1);
    expect(f.field(held.stdout, 'maintenance')).toBe('active');
    expect(f.field(held.stdout, 'holder')).toBe('sysadmin-3660');
    expect(f.field(held.stdout, 'step')).toBe('capture');
    expect(f.field(held.stdout, 'db_lease')).toBe('absent');
    expect(f.field(held.stdout, 'gate')).toBe('refused');
    for (const [SCENARIO, reason] of [['unreadable', 'db_unreadable'], ['garbage', 'db_unexpected'], ['empty', 'db_unexpected']]) {
      const r = f.lease(['status'], { SCENARIO });
      expect(r.status, SCENARIO).toBe(1);
      expect(f.field(r.stdout, 'gate'), SCENARIO).toBe('refused');
      expect(f.field(r.stdout, 'reason'), SCENARIO).toBe(reason);
    }
    const present = f.lease(['status']);
    expect(present.status).toBe(75);
    expect(f.field(present.stdout, 'db_lease')).toBe('free');
    expect(f.field(present.stdout, 'gate')).toBe('blocked');
    expect(f.field(present.stdout, 'reason')).toBe('maintenance_active');
    const lease = f.lease(['status'], { SCENARIO: 'held' });
    expect(lease.status).toBe(75);
    expect(f.field(lease.stdout, 'db_lease')).toMatch(/^live 7 quiet-window/);
  } finally { f.cleanup(); }
});

test('recovery of an open maintenance survives a lost registry: heartbeat, mark, restore and watchdog still work; new operations do not', () => {
  const f = fixture();
  try {
    const token = f.enter();
    f.lease(['mark', 'capture'], { STAGING_MAINTENANCE_TOKEN: token });
    for (const SCENARIO of ['absent', 'unreadable']) {
      expect(f.lease(['heartbeat'], { SCENARIO, STAGING_MAINTENANCE_TOKEN: token }).status, SCENARIO).toBe(0);
      expect(f.lease(['mark', 'capture'], { SCENARIO, STAGING_MAINTENANCE_TOKEN: token }).status, SCENARIO).toBe(0);
      expect(f.lease(['run', '--', 'true'], { SCENARIO, STAGING_MAINTENANCE_TOKEN: token }).status, SCENARIO).toBe(1);
      expect(f.lease(['watchdog'], { SCENARIO }).status, SCENARIO).toBe(0); // fresh heartbeat → nothing to do, no DB needed
    }
    expect(f.calls('restore-calls')).toEqual([]);
    writeFileSync(join(f.dir, 'state/heartbeat'), '1\n'); // the holder's session died while the registry is gone
    const wd = f.lease(['watchdog'], { SCENARIO: 'absent' });
    expect(wd.status, wd.stderr).toBe(0);
    expect(wd.stdout).toContain('MAINTENANCE_RELEASED');
    expect(f.calls('restore-calls')[0]).toContain('reason=heartbeat_lost');
    expect(f.calls('restore-calls')[0]).toContain('step=capture');
    expect(f.calls('db-calls').filter(c => c.startsWith('absent:'))).toHaveLength(1); // only the refused run touched the DB
    expect(f.lease(['run', '--', 'true'], { SCENARIO: 'absent' }).status).toBe(1); // released, yet still no readiness without the registry
    expect(f.lease(['run', '--', 'true']).status).toBe(0);
    // Manual restore under an unreadable DB releases a capture-step window the same way.
    const token2 = f.enter();
    f.lease(['mark', 'capture'], { STAGING_MAINTENANCE_TOKEN: token2 });
    const manual = f.lease(['restore', 'holder_exit'], { SCENARIO: 'unreadable' });
    expect(manual.status, manual.stderr).toBe(0);
    expect(existsSync(join(f.dir, 'state/maintenance'))).toBe(false);
  } finally { f.cleanup(); }
});

test('recovery with a lost registry keeps the infra policy: apply/activate and a changed hook stay blocked, repeat restore is idempotent', () => {
  const f = fixture();
  try {
    const token = f.enter();
    f.lease(['mark', 'apply'], { STAGING_MAINTENANCE_TOKEN: token });
    const failed = f.lease(['restore', 'holder_exit'], { SCENARIO: 'absent' });
    expect(failed.status).toBe(1);
    expect(f.calls('restore-calls')).toHaveLength(2); // call line + policy line
    expect(f.calls('restore-calls')[1]).toContain('not started');
    const status = f.lease(['status'], { SCENARIO: 'absent' });
    expect(status.status).toBe(1);
    expect(f.field(status.stdout, 'maintenance')).toBe('restore_failed');
    expect(f.field(status.stdout, 'last_restore_exit')).toBe('4');
    for (const SCENARIO of ['absent', 'present']) {
      expect(f.lease(['run', '--', 'true'], { SCENARIO }).status, SCENARIO).not.toBe(0);
      expect(f.lease(['run', '--', 'true'], { SCENARIO, STAGING_MAINTENANCE_TOKEN: token }).status, SCENARIO).not.toBe(0);
    }
    expect(f.lease(['watchdog'], { SCENARIO: 'absent' }).status).toBe(1); // retry → same policy refusal
    expect(f.field(f.state(), 'restore_attempts')).toBe('2');
    const again = f.lease(['restore'], { SCENARIO: 'absent' });
    expect(again.status).toBe(1);
    expect(f.field(f.state(), 'restore_attempts')).toBe('3');
    expect(f.field(f.state(), 'phase')).toBe('restore_failed');
    appendFileSync(hook(f), '# tampered\n');
    const tampered = f.lease(['restore'], { SCENARIO: 'absent' });
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain('sha256');
    expect(f.calls('restore-calls')).toHaveLength(6); // the changed hook was not executed
    expect(f.lease(['run', '--', 'true']).status).toBe(75);
  } finally { f.cleanup(); }
});

test('check: unusable state dir or corrupt record → fail closed (1), never "free"', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'not-a-dir'), '');
    const r = f.lease(['check'], { STAGING_STATE_DIR: join(f.dir, 'not-a-dir') });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('fail closed');
    f.enter();
    writeFileSync(join(f.dir, 'state/maintenance'), 'garbage\n');
    for (const cmd of [['check'], ['run', '--', 'true'], ['status'], ['watchdog'], ['restore'], ['heartbeat']]) {
      const c = f.lease(cmd);
      expect(c.status, cmd.join(' ')).toBe(1);
      expect(c.stderr, cmd.join(' ')).toContain('corrupt');
    }
  } finally { f.cleanup(); }
});

test('usage: unknown command → 2; run needs a command; enter validates holder, hook and ttl', () => {
  const f = fixture();
  try {
    expect(f.lease(['release']).status).toBe(2);
    expect(f.lease(['run', '--']).status).toBe(2);
    expect(f.lease(['enter', '--holder', 'bad name', '--restore', hook(f)]).status).toBe(2);
    expect(f.lease(['enter', '--holder', 'ok', '--restore', 'restore.sh']).status).toBe(2);
    expect(f.lease(['enter', '--holder', 'ok', '--restore', join(f.dir, 'restore-exit')]).status).toBe(2); // not executable
    expect(f.lease(['enter', '--holder', 'ok', '--restore', hook(f), '--ttl', '5']).status).toBe(2);
    expect(existsSync(join(f.dir, 'state/maintenance'))).toBe(false);
  } finally { f.cleanup(); }
});

test('run: executes the command with its arguments and propagates its exit code', () => {
  const f = fixture();
  try {
    const ok = f.lease(['run', '--', 'bash', '-c', 'echo "args=$1 $2"; test "$GODCRM_STAGING_LOCK_PID" = "$$"', 'sh', 'x', 'a b']);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('args=x a b');
    expect(f.lease(['run', '--', 'bash', '-c', 'test -z "$GODCRM_STAGING_MAINTENANCE_ID"']).status).toBe(0); // no maintenance → no id exported
    expect(f.lease(['run', '--', 'bash', '-c', 'exit 7']).status).toBe(7);
    expect(f.lease(['run', '--', 'true'], { SCENARIO: 'held' }).status).toBe(75);
    expect(f.lease(['run', '--', 'true'], { SCENARIO: 'unreadable' }).status).toBe(1);
  } finally { f.cleanup(); }
});

test('run: the lock is held for the whole operation — concurrent run and enter are refused, then allowed', async () => {
  const f = fixture();
  try {
    const first = f.runAsync(`sleep 1.5; echo done >> "${f.dir}/first"`);
    await sleep(500);
    const second = f.lease(['run', '--', 'true']);
    expect(second.status).toBe(75);
    expect(second.stderr).toContain('another staging operation');
    const enterDuring = f.lease(['enter', '--holder', 'sysadmin', '--restore', hook(f)]);
    expect(enterDuring.status).toBe(75);
    expect(enterDuring.stderr).toContain('in progress');
    expect(f.field(f.lease(['status']).stdout, 'lock')).toBe('busy');
    expect(f.calls('first')).toEqual([]); // the first operation is still inside its command
    expect((await first.done).code).toBe(0);
    expect(f.calls('first')).toEqual(['done']);
    expect(f.lease(['run', '--', 'true']).status).toBe(0);
    expect(f.lease(['enter', '--holder', 'sysadmin', '--restore', hook(f)]).status).toBe(0);
  } finally { f.cleanup(); }
});

test('run: nested entry points inside a locked operation proceed; a forged lock pid does not', async () => {
  const f = fixture();
  try {
    const nested = f.lease(['run', '--', 'bash', SCRIPT, 'run', '--', 'bash', SCRIPT, 'run', '--', 'echo', 'nested']);
    expect(nested.status, nested.stderr).toBe(0);
    expect(nested.stdout).toContain('nested');
    const holder = f.runAsync('sleep 1.5');
    await sleep(500);
    const forged = f.lease(['run', '--', 'true'], { GODCRM_STAGING_LOCK_PID: String(process.pid) });
    expect(forged.status).toBe(75);
    const forgedHolder = f.lease(['run', '--', 'true'], { GODCRM_STAGING_LOCK_PID: String(holder.child.pid) });
    expect(forgedHolder.status).toBe(75); // holds the lock but is not our ancestor
    expect((await holder.done).code).toBe(0);
  } finally { f.cleanup(); }
});

test('enter: opens maintenance once, prints the token once, blocks everyone but the holder', () => {
  const f = fixture();
  try {
    const token = f.enter({}, ['--ttl', '600']);
    expect(f.state()).not.toContain(token); // only its sha256 is stored
    const again = f.lease(['enter', '--holder', 'other', '--restore', hook(f)]);
    expect(again.status).toBe(75);
    expect(again.stderr).toContain('already');
    const status = f.lease(['status']);
    expect(status.status).toBe(75);
    expect(f.field(status.stdout, 'maintenance')).toBe('active');
    expect(f.field(status.stdout, 'holder')).toBe('sysadmin-3660');
    expect(f.field(status.stdout, 'lock')).toBe('free');
    expect(f.field(status.stdout, 'db_lease')).toBe('free');
    expect(f.field(status.stdout, 'gate')).toBe('blocked');
    expect(f.field(status.stdout, 'reason')).toBe('maintenance_active');
    const blocked = f.lease(['run', '--', 'true']);
    expect(blocked.status).toBe(75);
    expect(blocked.stderr).toContain('holder=sysadmin-3660');
    expect(f.lease(['run', '--', 'true'], { STAGING_MAINTENANCE_TOKEN: 'deadbeef' }).status).toBe(75);
    expect(f.lease(['check']).status).toBe(75);
    const allowed = f.lease(['run', '--', 'echo', 'deploying'], { STAGING_MAINTENANCE_TOKEN: token });
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(allowed.stdout).toContain('deploying');
    expect(f.lease(['run', '--', 'true'], { STAGING_MAINTENANCE_TOKEN: token, SCENARIO: 'held' }).status).toBe(75); // broker lease still binds
  } finally { f.cleanup(); }
});

test('enter: refused while a foreign broker lease is live or the database is unreadable', () => {
  const f = fixture();
  try {
    expect(f.lease(['enter', '--holder', 'a', '--restore', hook(f)], { SCENARIO: 'held' }).status).toBe(75);
    expect(f.lease(['enter', '--holder', 'a', '--restore', hook(f)], { SCENARIO: 'unreadable' }).status).toBe(1);
    expect(existsSync(join(f.dir, 'state/maintenance'))).toBe(false);
  } finally { f.cleanup(); }
});

test('heartbeat: only the active holder can beat; watchdog leaves a fresh maintenance alone', () => {
  const f = fixture();
  try {
    expect(f.lease(['heartbeat']).status).toBe(1);
    const token = f.enter();
    expect(f.lease(['heartbeat'], { STAGING_MAINTENANCE_TOKEN: 'wrong' }).status).toBe(1);
    writeFileSync(join(f.dir, 'state/heartbeat'), '1\n');
    const beat = f.lease(['heartbeat'], { STAGING_MAINTENANCE_TOKEN: token });
    expect(beat.status, beat.stderr).toBe(0);
    expect(Number(readFileSync(join(f.dir, 'state/heartbeat'), 'utf8'))).toBeGreaterThan(1_700_000_000);
    const wd = f.lease(['watchdog']);
    expect(wd.status, wd.stderr).toBe(0);
    expect(f.calls('restore-calls')).toEqual([]);
    expect(f.field(f.lease(['status']).stdout, 'maintenance')).toBe('active');
  } finally { f.cleanup(); }
});

test('mark: the holder records the phase step; status, the holder operation and the restore hook see it', async () => {
  const f = fixture();
  try {
    expect(f.lease(['mark', 'apply']).status).toBe(1); // no maintenance at all
    const token = f.enter();
    expect(f.field(f.lease(['status']).stdout, 'step')).toBe('precheck');
    expect(f.lease(['mark', 'apply']).status).toBe(1); // not the holder
    expect(f.lease(['mark', 'apply'], { STAGING_MAINTENANCE_TOKEN: 'wrong' }).status).toBe(1);
    expect(f.lease(['mark', 'rollout'], { STAGING_MAINTENANCE_TOKEN: token }).status).toBe(2); // unknown step
    expect(f.field(f.lease(['status']).stdout, 'step')).toBe('precheck');
    const ok = f.lease(['mark', 'capture'], { STAGING_MAINTENANCE_TOKEN: token });
    expect(ok.status, ok.stderr).toBe(0);
    expect(f.field(f.lease(['status']).stdout, 'step')).toBe('capture');
    // `run` hands the maintenance id to the holder's operation; a nested mark inside that operation works.
    const op = f.lease(['run', '--', 'bash', '-c', `test -n "$GODCRM_STAGING_MAINTENANCE_ID" && bash "${SCRIPT}" mark apply`], { STAGING_MAINTENANCE_TOKEN: token });
    expect(op.status, op.stderr).toBe(0);
    expect(f.field(f.lease(['status']).stdout, 'step')).toBe('apply');
    // While a foreign operation holds the lock, mark is postponed (75), never applied half-way.
    const busy = f.runAsync('sleep 1.5', { STAGING_MAINTENANCE_TOKEN: token });
    await sleep(300);
    expect(f.lease(['mark', 'activate'], { STAGING_MAINTENANCE_TOKEN: token }).status).toBe(75);
    expect((await busy.done).code).toBe(0);
    expect(f.lease(['mark', 'activate'], { STAGING_MAINTENANCE_TOKEN: token }).status).toBe(0);
    // Acceptance first: the hook decides by step, and at `activate` the policy refuses to touch the tree.
    expect(f.lease(['mark', 'release'], { STAGING_MAINTENANCE_TOKEN: token }).status).toBe(0);
    const released = f.lease(['restore', 'holder_exit']);
    expect(released.status, released.stderr).toBe(0);
    expect(f.calls('restore-calls')[0]).toContain('step=release');
    expect(readFileSync(join(f.dir, 'state/history', f.calls('restore-calls')[0].match(/id=(\S+)/)[1]), 'utf8')).toContain('step=release');
    expect(f.lease(['mark', 'release'], { STAGING_MAINTENANCE_TOKEN: token }).status).toBe(1); // nothing left to mark
  } finally { f.cleanup(); }
});

test('watchdog: lost heartbeat → restore hook runs → maintenance released → operations allowed', () => {
  const f = fixture();
  try {
    f.enter();
    writeFileSync(join(f.dir, 'state/heartbeat'), '1\n'); // the holder died long ago
    const wd = f.lease(['watchdog']);
    expect(wd.status, wd.stderr).toBe(0);
    expect(wd.stdout).toContain('MAINTENANCE_RELEASED');
    expect(f.calls('restore-calls')).toHaveLength(1);
    expect(f.calls('restore-calls')[0]).toContain('reason=heartbeat_lost');
    expect(f.calls('restore-calls')[0]).toContain('holder=sysadmin-3660');
    expect(existsSync(join(f.dir, 'state/maintenance'))).toBe(false);
    const status = f.lease(['status']);
    expect(status.status).toBe(0);
    expect(f.field(status.stdout, 'maintenance')).toBe('none');
    expect(f.field(status.stdout, 'gate')).toBe('ready');
    expect(f.field(status.stdout, 'reason')).toBe('');
    expect(f.lease(['run', '--', 'true']).status).toBe(0);
    expect(f.lease(['watchdog']).status).toBe(0); // nothing left to do
    expect(f.calls('restore-calls')).toHaveLength(1);
  } finally { f.cleanup(); }
});

test('watchdog: expired ttl restores even with a fresh heartbeat', () => {
  const f = fixture();
  try {
    const token = f.enter({}, ['--ttl', '60']);
    const expiresAt = f.field(f.state(), 'expires_at');
    // Rewrite the record with an expiry in the past (the ttl floor is 60 s).
    writeFileSync(join(f.dir, 'state/maintenance'), f.state().replace(`expires_at=${expiresAt}`, 'expires_at=1'));
    expect(f.lease(['heartbeat'], { STAGING_MAINTENANCE_TOKEN: token }).status).toBe(0);
    const wd = f.lease(['watchdog']);
    expect(wd.status, wd.stderr).toBe(0);
    expect(f.calls('restore-calls')[0]).toContain('reason=expired');
    expect(f.lease(['run', '--', 'true']).status).toBe(0);
  } finally { f.cleanup(); }
});

test('restore: a failing hook keeps everything blocked (holder included); re-running restore releases once it succeeds', () => {
  const f = fixture();
  try {
    const token = f.enter();
    writeFileSync(join(f.dir, 'restore-exit'), '3\n');
    const failed = f.lease(['restore', 'holder_exit']);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('stays blocked');
    const status = f.lease(['status']);
    expect(status.status).toBe(75);
    expect(f.field(status.stdout, 'maintenance')).toBe('restore_failed');
    expect(f.field(status.stdout, 'last_restore_exit')).toBe('3');
    expect(f.lease(['run', '--', 'true']).status).toBe(75);
    expect(f.lease(['run', '--', 'true'], { STAGING_MAINTENANCE_TOKEN: token }).status).toBe(75);
    expect(f.lease(['heartbeat'], { STAGING_MAINTENANCE_TOKEN: token }).status).toBe(1);
    // The watchdog retries a failed restore on every tick.
    expect(f.lease(['watchdog']).status).toBe(1);
    expect(f.calls('restore-calls')).toHaveLength(2);
    expect(f.calls('restore-calls')[1]).toContain('reason=restore_retry');
    writeFileSync(join(f.dir, 'restore-exit'), '0\n');
    const ok = f.lease(['restore', 'holder_exit']);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('MAINTENANCE_RELEASED');
    expect(ok.stdout).toContain('attempts=3');
    expect(f.lease(['run', '--', 'true']).status).toBe(0);
    const idempotent = f.lease(['restore']);
    expect(idempotent.status).toBe(0);
    expect(idempotent.stdout).toContain('no maintenance');
    expect(f.calls('restore-calls')).toHaveLength(3);
    const id = f.calls('restore-calls')[0].match(/id=(\S+)/)[1];
    const history = readFileSync(join(f.dir, 'state/history', id), 'utf8');
    expect(history).toContain('release_reason=holder_exit');
    expect(history).toContain('restore_attempts=3');
    expect(existsSync(join(f.dir, 'state/history', `${id}.restore.log`))).toBe(true);
  } finally { f.cleanup(); }
});

test('restore: a hook changed since enter is never executed — maintenance stays blocked', () => {
  const f = fixture();
  try {
    f.enter();
    appendFileSync(hook(f), '# tampered\n');
    const r = f.lease(['restore']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('sha256');
    expect(f.calls('restore-calls')).toEqual([]);
    expect(f.field(f.lease(['status']).stdout, 'maintenance')).toBe('restore_failed');
    expect(f.lease(['run', '--', 'true']).status).toBe(75);
  } finally { f.cleanup(); }
});

test('restore and watchdog wait for a running operation instead of racing it', async () => {
  const f = fixture();
  try {
    const token = f.enter();
    const op = f.runAsync('sleep 1.5', { STAGING_MAINTENANCE_TOKEN: token });
    await sleep(300);
    const wd = f.lease(['watchdog']); // lock wait is 1 s in this fixture → skipped, not restored
    expect(wd.status, wd.stderr).toBe(0);
    expect(wd.stderr).toContain('skipped');
    expect(f.calls('restore-calls')).toEqual([]);
    expect((await op.done).code).toBe(0);
    expect(f.lease(['restore']).status).toBe(0);
    expect(f.calls('restore-calls')).toHaveLength(1);
  } finally { f.cleanup(); }
});
