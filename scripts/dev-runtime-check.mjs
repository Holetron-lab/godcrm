// Sent over SSH stdin. Read-only probe of the staging process and its database identity.
// RUNTIME_CHECK_MODE (scripts/DEV-OPERATIONS.md §Maintenance phases):
//   online      (default) godcrm online; current AND next-start settings connect to godcrm_test
//   stopped     APPLY under the HBA fence: godcrm NOT online; next-start settings name godcrm_test
//               on loopback; the peer superuser socket (the only path the fence leaves open)
//               confirms that database answers — the application role is never used
//   next-start  ACTIVATE before start: godcrm NOT online; next-start settings REALLY connect to
//               godcrm_test as the application role, so a still-present fence fails here, not after start
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

const mode = process.env.RUNTIME_CHECK_MODE || 'online';
assert.ok(['online', 'stopped', 'next-start'].includes(mode), `unknown RUNTIME_CHECK_MODE=${mode}`);
const runtime = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })).find(p => p.name === 'godcrm');
assert.equal(runtime?.pm2_env.pm_cwd, process.cwd());
assert.equal(runtime.pm2_env.status === 'online', mode === 'online', `godcrm is ${runtime.pm2_env.status} (mode ${mode})`);

const next = dotenv.parse(fs.readFileSync('.env'));
const envs = [{ ...next, ...runtime.pm2_env }]; // what PM2 will hand to the next start
if (mode === 'online') {
  const launched = Object.fromEntries(fs.readFileSync(`/proc/${runtime.pid}/environ`, 'utf8')
    .split('\0').filter(v => v.includes('=')).map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]));
  envs.push({ ...next, ...launched }); // what the running process actually got
}
for (const env of envs) {
  const url = env.POSTGRES_URL ? new URL(env.POSTGRES_URL) : null;
  assert.equal(url ? url.pathname : `/${env.POSTGRES_DB}`, '/godcrm_test');
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]', '', undefined].includes(url ? url.hostname : env.POSTGRES_HOST), 'database host must be loopback');
  if (mode === 'stopped') continue; // the fence rejects the application role by design
  const options = { options: '-c default_transaction_read_only=on -c statement_timeout=5000', connectionTimeoutMillis: 5000 };
  const client = new pg.Client(url ? { ...options, connectionString: env.POSTGRES_URL } : {
    ...options, host: env.POSTGRES_HOST || 'localhost', port: env.POSTGRES_PORT || 5432,
    database: env.POSTGRES_DB, user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD,
  });
  await client.connect();
  try { assert.equal((await client.query('select current_database() db')).rows[0].db, 'godcrm_test'); }
  finally { await client.end(); }
}
if (mode === 'stopped') {
  const peer = execFileSync('runuser', ['-u', 'postgres', '--', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', 'godcrm_test', '-c', 'select current_database()'], { encoding: 'utf8' });
  assert.equal(peer.trim(), 'godcrm_test');
}
console.log(JSON.stringify({ mode, database: 'godcrm_test', pid: runtime.pid, status: runtime.pm2_env.status }));
