import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// The real dev-operation.sh and the real staging-lease.sh gate, every external
// action stubbed. Fixtures live inside the checkout: the ops-runner mounts /tmp
// noexec, so stubs under os.tmpdir() would silently fall through to the real
// binaries (that was the "no postgres user in the runner image" finding).
const online = ['deploy', 'restart', 'host', 'same-host', 'busy', 'lease', 'lease-unreadable', 'lease-absent', 'refresh', 'database', 'sha', 'dirty', 'backup', 'make', 'health'];
const phases = ['precheck', 'apply', 'activate', 'apply-no-maintenance', 'apply-sha', 'apply-running', 'apply-drift', 'apply-lease-absent', 'activate-fenced', 'activate-health'];
const success = ['deploy', 'restart', 'precheck', 'apply', 'activate'];
const makeRuns = [...success.filter(s => s !== 'precheck'), 'make', 'health', 'apply-drift', 'activate-health'];
const operation = { 'apply-no-maintenance': 'apply', 'apply-sha': 'apply', 'apply-running': 'apply', 'apply-drift': 'apply', 'apply-lease-absent': 'apply', 'activate-fenced': 'activate', 'activate-health': 'activate', restart: 'restart', precheck: 'precheck', apply: 'apply', activate: 'activate' };

for (const scenario of [...online, ...phases]) {
  test(`dev operation: ${scenario}`, () => {
    const dir = mkdtempSync(join(process.cwd(), '.dev-operation-test-'));
    try {
      const bin = join(dir, 'bin'); const log = join(dir, 'actions');
      for (const sub of ['bin', 'scripts', 'backups', 'dist']) mkdirSync(join(dir, sub));
      writeFileSync(log, '');
      writeFileSync(join(dir, 'scripts/deploy.local.env'), `DEV_HOST=${scenario === 'host' ? 'local' : 'dev72'}\n`);
      writeFileSync(join(dir, 'scripts/dev-runtime-check.mjs'), '');
      writeFileSync(join(dir, 'scripts/staging-lease.sh'), readFileSync('scripts/staging-lease.sh', 'utf8')); // the real gate, stubbed psql
      writeFileSync(join(dir, 'scripts/staging-sync.sh'), `#!/bin/bash\necho "sync $*" >> "$ACTION_LOG"
if [ "$SCENARIO" = apply-drift ]; then echo '>f.st...... backend/server.js'; else echo '.d..t...... ./'; fi`, { mode: 0o755 }); // dry-run readback; a bare directory mtime is not drift
      writeFileSync(join(dir, 'restore.sh'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
      writeFileSync(join(dir, '.mcp.json'), '{}');
      writeFileSync(join(dir, 'machine-id'), 'fixture-host\n'); // the runner container has no /etc/machine-id
      const stub = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\nset -e\n${body}\n`, { mode: 0o755 });
      stub('flock', '[ "$SCENARIO" != busy ]');
      // The broker registry (ops_staging_leases) is PRESENT in every allowed scenario; `lease-absent`
      // drops it before the operation, `apply-lease-absent` drops it after the holder entered.
      stub('runuser', `[ "$SCENARIO" != lease-unreadable ]
sql=$(cat)   # the gate feeds SQL on stdin (psql interpolates :'tok' only there, never in -c)
case "$sql" in *to_regclass*) if [ "$SCENARIO" = lease-absent ] || [ -e "$FIXTURE_DIR/registry-gone" ]; then echo f; else echo t; fi ;;
 *released_at*) if [ "$SCENARIO" = lease ]; then echo "7 quiet-window job=20841 holder_pid=1 expires=2026-10-02T12:00:00Z"; fi ;; esac`);
      stub('systemctl', 'if [ "$SCENARIO" = refresh ]; then echo active; else echo inactive; fi');
      stub('git', 'case "$*" in *rev-parse*) echo abc ;; *branch*) echo main ;; *status*) if [ "$SCENARIO" = dirty ]; then echo modified; fi ;; esac');
      stub('ssh', `echo "ssh $*" >> "$ACTION_LOG"
case "$*" in
 *machine-id*) if [ "$SCENARIO" = same-host ]; then cat "$FIXTURE_DIR/machine-id"; else echo remote-staging; fi ;;
 *'RUNTIME_CHECK_MODE=stopped node'*) [ "$SCENARIO" != apply-running ] ;;
 *'RUNTIME_CHECK_MODE=next-start node'*) [ "$SCENARIO" != activate-fenced ] ;;
 *'node --input-type'*) [ "$SCENARIO" != database ] ;;
 *jlist*) echo '[{"name":"godcrm","pid":1,"pm2_env":{"status":"online","POSTGRES_PASSWORD":"never-printed"}},{"name":"bdd-runner","pid":2,"pm2_env":{"status":"online"}}]' ;;
 *'systemctl is-active'*) printf 'active\\nactive\\n' ;;
 *curl*) if [ "$SCENARIO" = activate-health ]; then echo '{"status":"error"}'; else echo '{"status":"ok","database":{"status":"connected"}}'; fi ;;
 *tar*) [ "$SCENARIO" != backup ]; tar -C "$FIXTURE_DIR" -cf - .mcp.json ;;
 *) exit 99 ;;
esac`);
      stub('make', 'echo "make $* no_restart=${DEPLOY_NO_RESTART:-0}" >> "$ACTION_LOG"; [ "$SCENARIO" != make ]');
      stub('curl', 'if [ "$SCENARIO" = health ]; then echo \'{"status":"error"}\'; else echo \'{"status":"ok","database":{"status":"connected"}}\'; fi');
      const source = readFileSync('scripts/dev-operation.sh', 'utf8')
        .replace('PROJ=/root/production/business-crm', `PROJ=${dir}`)
        .replace('BACKUPS=/root/backups/temp', `BACKUPS=${dir}/backups`)
        .replace('cat /etc/machine-id', `cat ${dir}/machine-id`);
      const script = join(dir, 'operation.sh'); writeFileSync(script, source);
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SCENARIO: scenario, ACTION_LOG: log, FIXTURE_DIR: dir,
        EXPECTED_SHA: scenario === 'sha' ? 'wrong' : 'abc',
        STAGING_STATE_DIR: join(dir, 'state'), GODCRM_STAGING_LOCK_PID: '' }; // the shared lock/gate state stays inside the fixture
      if (scenario === 'apply-sha') delete env.EXPECTED_SHA; // maintenance phases never default the pin to HEAD
      if (phases.includes(scenario) && scenario !== 'apply-no-maintenance' && scenario !== 'precheck') {
        const enter = spawnSync('bash', [join(dir, 'scripts/staging-lease.sh'), 'enter', '--holder', 'sysadmin-3660', '--restore', join(dir, 'restore.sh')], { encoding: 'utf8', env });
        expect(enter.status, enter.stderr).toBe(0);
        env.STAGING_MAINTENANCE_TOKEN = /^STAGING_MAINTENANCE_TOKEN=([0-9a-f]{32})$/m.exec(enter.stdout)[1];
        if (scenario === 'apply-lease-absent') writeFileSync(join(dir, 'registry-gone'), '');
      }
      const result = spawnSync('bash', [script, operation[scenario] ?? 'deploy'], { encoding: 'utf8', timeout: 10000, env });
      expect(result.error).toBeUndefined();
      const ok = success.includes(scenario);
      expect(result.status === 0, result.stderr).toBe(ok);
      const actions = readFileSync(log, 'utf8');
      expect(actions.includes('make '), actions).toBe(makeRuns.includes(scenario));
      if (scenario.endsWith('lease-absent')) { expect(result.status).toBe(1); expect(result.stderr).toContain('ops_staging_leases absent'); expect(actions).toBe(''); } // refused before any payload action, holder included
      if (scenario === 'deploy') expect(actions).toMatch(/make -C \S+ dev no_restart=0/);
      if (scenario === 'restart' || scenario === 'activate') expect(actions).toMatch(/make -C \S+ restart no_restart=0/);
      if (scenario === 'apply' || scenario === 'apply-drift') expect(actions).toMatch(/make -C \S+ dev no_restart=1/); // APPLY never starts PM2
      if (scenario === 'activate') expect(actions).toMatch(/ssh .*curl .*127\.0\.0\.1:5000\/api\/health/); // loopback only: ingress stays closed
      if (scenario === 'activate') expect(actions).not.toMatch(/RUNTIME_CHECK_MODE=online[\s\S]*make restart/); // next-start identity first, start second
      if (['precheck', 'apply'].includes(scenario)) expect(actions).toContain('sync ');
      if (scenario === 'precheck') { expect(result.stdout).toMatch(/godcrm=online bdd-runner=online/); expect(result.stdout).not.toContain('never-printed'); }
      if (scenario === 'apply') expect(result.stdout).toContain('apply complete');
      if (scenario === 'apply-drift') expect(result.stderr).toContain('differs');
      if (scenario === 'apply-no-maintenance') expect(result.stderr).toContain('holder');
      if (['apply', 'activate'].includes(scenario)) expect(readFileSync(join(dir, 'state/maintenance'), 'utf8')).toContain(`step=${scenario}`);
      expect(result.stdout.includes('healthy; source')).toBe(['deploy', 'restart', 'activate'].includes(scenario));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
