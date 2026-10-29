// @vitest-environment node
import '../../../test/setup.js';
import { beforeAll, afterAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ schema: '', backupDir: '', failAudit: false }));
vi.mock('node:os', async (original) => ({ ...await original(),
  networkInterfaces: () => ({ test: [{ address: '<PROD_IP>' }] }),
}));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original();
  const map = (path) => path.replace('/srv/godcrm/shared/oidc-backups', state.backupDir);
  return { ...fs, mkdir: (path, opts) => fs.mkdir(map(path), opts),
    lstat: (path) => fs.lstat(map(path)), open: (path, ...args) => fs.open(map(path), ...args) };
});
vi.mock('../../../config/oidc.config.js', () => ({ ISSUER: 'https://id.godcrm.ai' }));
vi.mock('../../../database/connection.js', async (original) => {
  const db = await original();
  return { ...db, withTransactionAsync: (fn) => db.withTransactionAsync(async (real) => {
    const actual = await real.get('SELECT current_database() AS name');
    if (actual.name !== 'godcrm_test') throw new Error('Integration test refused unsafe database');
    // Simulate only the environment guard; real SQL/locks/rollback use an isolated schema.
    const rewrite = (sql) => sql.replaceAll('public.', `${state.schema}.`)
      .replace("table_schema = 'public'", `table_schema = '${state.schema}'`)
      .replaceAll('INTO _secrets', `INTO ${state.schema}._secrets`)
      .replaceAll('FROM _secrets', `FROM ${state.schema}._secrets`);
    const trx = Object.fromEntries(['get', 'all', 'run', 'query'].map((method) => [method, async (sql, params) => {
      if (sql.includes('current_database() AS database')) return { database: 'godcrm_prod', address: '127.0.0.1/32' };
      if (state.failAudit && sql.includes('INSERT INTO public.audit_log')) throw new Error('forced audit failure');
      return real[method](rewrite(sql), params);
    }]));
    return fn(trx);
  }) };
});
import { dbRun, dbGet, dbAll, destroyAdapter } from '../../../database/connection.js';
import vault from '../../secrets/SecretsVault.js';
import { changeForgejoClient } from '../forgejoProvisioning.js';

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  state.schema = `oidc_test_${randomUUID().replaceAll('-', '')}`;
  state.backupDir = await mkdtemp(join(tmpdir(), 'oidc-3721-'));
  await dbRun(`CREATE SCHEMA ${state.schema}`);
  for (const table of ['oidc_clients', '_secrets', 'audit_log']) {
    await dbRun(`CREATE TABLE ${state.schema}.${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING INDEXES)`);
  }
  await dbRun(`CREATE TABLE ${state.schema}.spaces (id integer, owner_id integer)`);
  await dbRun(`INSERT INTO ${state.schema}.spaces VALUES (11, 1) RETURNING id`);
  vi.stubEnv('SECRETS_MASTER_KEY', 'b'.repeat(64));
  await vault.init({ allowEnvFallback: false });
});
beforeEach(async () => {
  state.failAudit = false;
  await dbRun(`TRUNCATE ${state.schema}.oidc_clients, ${state.schema}._secrets, ${state.schema}.audit_log`);
});
afterAll(async () => {
  await vault.shutdown();
  if (state.schema) {
    for (const table of ['oidc_clients', '_secrets', 'audit_log', 'spaces']) {
      await dbRun(`DROP TABLE IF EXISTS ${state.schema}.${table} RESTRICT`);
    }
    await dbRun(`DROP SCHEMA ${state.schema} RESTRICT`);
  }
  if (state.backupDir) await rm(state.backupDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  await destroyAdapter();
});

test('concurrent provisioning commits one encrypted secret, one client and two audits', async () => {
  const results = await Promise.all([1, 2].map(() => changeForgejoClient({ action: 'provision', actor: 1 })));
  expect(results.map((result) => result.changed).sort()).toEqual([false, true]);
  const clients = await dbAll(`SELECT * FROM ${state.schema}.oidc_clients`);
  expect(clients).toHaveLength(1);
  expect(clients[0]).toMatchObject({ client_id: 'forgejo', client_secret: null, space_id: null, is_active: 1 });
  const secrets = await dbAll(`SELECT * FROM ${state.schema}._secrets`);
  expect(secrets).toHaveLength(1);
  expect(secrets[0].encrypted_payload).toMatchObject({ v: 1, iv: expect.any(String), ct: expect.any(String) });
  expect((await dbAll(`SELECT * FROM ${state.schema}.audit_log`))).toHaveLength(2);
  const previous = secrets[0].encrypted_payload;
  await changeForgejoClient({ action: 'disable', actor: 1 });
  expect((await dbGet(`SELECT is_active FROM ${state.schema}.oidc_clients`)).is_active).toBe(0);
  await changeForgejoClient({ action: 'enable', actor: 1 });
  expect((await dbGet(`SELECT encrypted_payload FROM ${state.schema}._secrets`)).encrypted_payload).toEqual(previous);
});

test('audit failure rolls back client AND vault; retry succeeds without an orphan', async () => {
  state.failAudit = true;
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow('forced audit failure');
  expect(await dbAll(`SELECT * FROM ${state.schema}.oidc_clients`)).toEqual([]);
  expect(await dbAll(`SELECT * FROM ${state.schema}._secrets`)).toEqual([]);
  expect(vault.health().cacheSize).toBe(0);
  state.failAudit = false;
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).resolves.toMatchObject({ changed: true });
});
