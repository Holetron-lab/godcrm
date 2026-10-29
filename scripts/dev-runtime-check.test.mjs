import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// The real probe, fed over stdin exactly as dev-operation.sh does, against
// synthetic pm2 / runuser binaries and synthetic dotenv / pg packages. The
// fixture lives inside the checkout (ops-runner mounts /tmp noexec).
function probe({ mode, pm2 = 'stopped', env = 'POSTGRES_DB=godcrm_test\n', connect = 'ok', peer = 'godcrm_test' }) {
  const dir = mkdtempSync(join(process.cwd(), '.runtime-check-test-'));
  try {
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, '.env'), env);
    for (const [name, code] of Object.entries({
      dotenv: 'export default { parse: s => Object.fromEntries(String(s).split("\\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) };',
      pg: `export default { Client: class { constructor(o) { this.o = o; }
        async connect() { if (process.env.PG_CONNECT !== 'ok') throw new Error('SYNTHETIC_HBA_REJECT: no pg_hba.conf entry'); }
        async query() { return { rows: [{ db: this.o.database }] }; }
        async end() {} } };`,
    })) {
      mkdirSync(join(dir, 'node_modules', name), { recursive: true });
      writeFileSync(join(dir, 'node_modules', name, 'package.json'), '{"type":"module","main":"index.js"}');
      writeFileSync(join(dir, 'node_modules', name, 'index.js'), code);
    }
    // pid = the probe itself, so /proc/<pid>/environ is readable and carries POSTGRES_* from this env.
    writeFileSync(join(dir, 'bin/pm2'), `#!/bin/bash\necho "[{\\"name\\":\\"godcrm\\",\\"pid\\":$PPID,\\"pm2_env\\":{\\"status\\":\\"$PM2_STATUS\\",\\"pm_cwd\\":\\"$PWD\\"}}]"\n`, { mode: 0o755 });
    writeFileSync(join(dir, 'bin/runuser'), '#!/bin/bash\necho "runuser $*" >> peer-calls\n[ -n "$PEER_DB" ] && echo "$PEER_DB"\n', { mode: 0o755 });
    const r = spawnSync(process.execPath, ['--input-type=module'], { // the runner container has node outside /usr/bin
      cwd: dir, encoding: 'utf8', timeout: 10000, input: readFileSync('scripts/dev-runtime-check.mjs', 'utf8'),
      env: { PATH: `${join(dir, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, RUNTIME_CHECK_MODE: mode, PM2_STATUS: pm2, PG_CONNECT: connect, PEER_DB: peer, POSTGRES_DB: 'godcrm_test' },
    });
    expect(r.error).toBeUndefined();
    return { ...r, peerCalls: readFileSync(join(dir, 'peer-calls'), { encoding: 'utf8', flag: 'a+' }) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('online (default): godcrm online and both current and next-start env connect to godcrm_test', () => {
  const ok = probe({ mode: 'online', pm2: 'online' });
  expect(ok.status, ok.stderr).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({ mode: 'online', database: 'godcrm_test', status: 'online' });
  expect(probe({ mode: undefined, pm2: 'online' }).status).toBe(0);
  expect(probe({ mode: 'online', pm2: 'stopped' }).status).not.toBe(0); // the online path needs the running process
  const fenced = probe({ mode: 'online', pm2: 'online', connect: 'reject' });
  expect(fenced.status).not.toBe(0);
  expect(fenced.stderr).toContain('SYNTHETIC_HBA_REJECT');
  expect(probe({ mode: 'online', pm2: 'online', env: 'POSTGRES_DB=godcrm_prod\n' }).status).not.toBe(0);
});

test('stopped (APPLY under the fence): godcrm not online; next-start names godcrm_test on loopback; peer socket confirms the database', () => {
  const ok = probe({ mode: 'stopped', connect: 'reject' }); // the app role is rejected by the fence — the probe must not need it
  expect(ok.status, ok.stderr).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({ mode: 'stopped', database: 'godcrm_test', status: 'stopped' });
  expect(ok.peerCalls).toMatch(/runuser -u postgres -- psql .*godcrm_test/);
  expect(probe({ mode: 'stopped', pm2: 'online' }).status).not.toBe(0); // APPLY requires the stopped application
  expect(probe({ mode: 'stopped', env: 'POSTGRES_DB=godcrm_prod\n' }).status).not.toBe(0);
  expect(probe({ mode: 'stopped', env: 'POSTGRES_DB=godcrm_test\nPOSTGRES_HOST=10.0.0.5\n' }).status).not.toBe(0); // not loopback
  expect(probe({ mode: 'stopped', env: 'POSTGRES_URL=postgres://u:p@db.example/godcrm_test\n' }).status).not.toBe(0);
  expect(probe({ mode: 'stopped', env: 'POSTGRES_URL=postgres://u:p@127.0.0.1:5432/godcrm_test\n' }).status).toBe(0);
  expect(probe({ mode: 'stopped', peer: 'godcrm_prod' }).status).not.toBe(0);
  expect(probe({ mode: 'stopped', peer: '' }).status).not.toBe(0); // peer socket unreadable → fail closed
});

test('next-start (ACTIVATE before start): godcrm not online; the next-start env really connects to godcrm_test', () => {
  const ok = probe({ mode: 'next-start' });
  expect(ok.status, ok.stderr).toBe(0);
  expect(JSON.parse(ok.stdout)).toMatchObject({ mode: 'next-start', database: 'godcrm_test' });
  expect(ok.peerCalls).toBe(''); // a real connection as the application role, not the superuser socket
  const fenced = probe({ mode: 'next-start', connect: 'reject' });
  expect(fenced.status).not.toBe(0); // the fence must be lifted before anything starts
  expect(fenced.stderr).toContain('SYNTHETIC_HBA_REJECT');
  expect(probe({ mode: 'next-start', pm2: 'online' }).status).not.toBe(0);
  expect(probe({ mode: 'next-start', env: 'POSTGRES_DB=godcrm_prod\n' }).status).not.toBe(0);
  const unknown = probe({ mode: 'rollout' });
  expect(unknown.status).not.toBe(0);
  expect(unknown.stderr).toContain('RUNTIME_CHECK_MODE');
});
