// @vitest-environment node
import '../../../test/setup.js';
import { beforeAll, afterAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ schema: '', backupDir: '', failAudit: false, failVault: false }));
vi.mock('node:os', async (original) => ({ ...await original(),
  networkInterfaces: () => ({ test: [{ address: '<PROD_IP>' }] }),
}));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original();
  const map = (path) => path.replace('/root/backups/temp/oidc-penpot', state.backupDir);
  return { ...fs, mkdir: (path, opts) => fs.mkdir(map(path), opts),
    lstat: (path) => fs.lstat(map(path)), open: (path, ...args) => fs.open(map(path), ...args) };
});
vi.mock('../../../database/connection.js', async (original) => {
  const db = await original();
  const rewrite = (sql) => sql.replaceAll('public.', `${state.schema}.`)
    .replace("table_schema = 'public'", `table_schema = '${state.schema}'`)
    .replaceAll('INTO _secrets', `INTO ${state.schema}._secrets`)
    .replaceAll('FROM _secrets', `FROM ${state.schema}._secrets`)
    .replaceAll('FROM oidc_clients', `FROM ${state.schema}.oidc_clients`);
  return { ...db, dbGet: (sql, params) => db.dbGet(rewrite(sql), params),
    withTransactionAsync: (fn) => db.withTransactionAsync(async (real) => {
      const actual = await real.get('SELECT current_database() AS name');
      if (actual.name !== 'godcrm_test') throw new Error('Integration test refused unsafe database');
      const trx = Object.fromEntries(['get', 'all', 'run', 'query'].map((method) => [method, async (sql, params) => {
        if (sql.includes('current_database() AS database')) return { database: 'godcrm_prod', address: '127.0.0.1/32' };
        if (state.failAudit && sql.includes('INSERT INTO public.audit_log')) throw new Error('forced audit failure');
        if (state.failVault && sql.includes('INSERT INTO _secrets')) throw new Error('forced vault failure');
        return real[method](rewrite(sql), params);
      }]));
      return fn(trx);
    }) };
});
import { dbRun, dbGet, dbAll, destroyAdapter } from '../../../database/connection.js';
import vault from '../../secrets/SecretsVault.js';
import { changePenpotClient } from '../penpotProvisioning.js';
import { getClient, verifyClientSecret, isRedirectUriAllowed } from '../clientRegistry.js';
const callback = 'https://design.godcrm.ai/api/auth/oidc/callback';
const inspect = () => changePenpotClient({ action: 'inspect', actor: 1 });
const command = async (action = 'rotate') => ({ action, actor: 1, request_id: randomUUID(), expected_revision: (await inspect()).revision });
beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  state.schema = `penpot_test_${randomUUID().replaceAll('-', '')}`;
  state.backupDir = await mkdtemp(join(tmpdir(), 'penpot-21489-'));
  await dbRun(`CREATE SCHEMA ${state.schema}`);
  // Private identities/sequences: no copied defaults pointing into public tables.
  await dbRun(`CREATE TABLE ${state.schema}.oidc_clients (
    id serial PRIMARY KEY, client_id text, name text, client_secret text,
    secret_ref text, redirect_uris text, allowed_scopes text, is_active integer,
    token_endpoint_auth_method text, updated_at timestamp DEFAULT now())`);
  await dbRun(`CREATE TABLE ${state.schema}._secrets (
    id serial PRIMARY KEY, key text, encrypted_payload jsonb,
    description text, created_by integer, space_id integer, created_at timestamptz, updated_at timestamptz,
    UNIQUE(space_id, key))`);
  await dbRun(`CREATE TABLE ${state.schema}.audit_log (
    id serial PRIMARY KEY, user_id integer, action text,
    entity_type text, entity_id text, details text)`);
  await dbRun(`CREATE TABLE ${state.schema}.spaces (id integer, owner_id integer)`);
  await dbRun(`INSERT INTO ${state.schema}.spaces VALUES (11, 1) RETURNING id`);
  vi.stubEnv('SECRETS_MASTER_KEY', 'b'.repeat(64));
  await vault.init({ allowEnvFallback: false });
  // Reads for registry tests use the same private fixture rows, never public vault material.
  vault._adapter = { query: async (sql, params) => {
    const rows = await dbAll(sql.replaceAll('FROM _secrets', `FROM ${state.schema}._secrets`), params);
    return { rows, rowCount: rows.length };
  } };
});
beforeEach(async () => {
  state.failAudit = false; state.failVault = false; vault._cache.clear();
  await dbRun(`TRUNCATE ${state.schema}.oidc_clients, ${state.schema}._secrets, ${state.schema}.audit_log`);
  for (const client of ['penpot', 'forgejo', 'workadventure']) {
    await dbRun(`INSERT INTO ${state.schema}.oidc_clients
      (client_id, name, client_secret, redirect_uris, allowed_scopes, is_active, token_endpoint_auth_method)
      VALUES ($1, $1, $2, $3, $4, 1, 'client_secret_post')`,
    [client, 'legacy-test-secret', JSON.stringify([callback, 'https://design.hltrn.cc/api/auth/oidc/callback']), '["openid","email","profile"]']);
  }
});
afterAll(async () => {
  await vault.shutdown();
  if (state.schema) {
    for (const table of ['oidc_clients', '_secrets', 'audit_log', 'spaces']) await dbRun(`DROP TABLE IF EXISTS ${state.schema}.${table} RESTRICT`);
    await dbRun(`DROP SCHEMA ${state.schema} RESTRICT`);
  }
  if (state.backupDir) await rm(state.backupDir, { recursive: true, force: true });
  vi.unstubAllEnvs(); await destroyAdapter();
});
test('concurrent identical rotation commits exactly once; snapshot is verified and private', async () => {
  const input = await command();
  const before = await dbAll(`SELECT * FROM ${state.schema}.oidc_clients WHERE client_id <> 'penpot' ORDER BY id`);
  const results = await Promise.all([changePenpotClient(input), changePenpotClient(input)]);
  expect(results.map((r) => r.changed).sort()).toEqual([false, true]);
  expect(await dbAll(`SELECT * FROM ${state.schema}.audit_log`)).toHaveLength(1);
  expect(await dbAll(`SELECT * FROM ${state.schema}._secrets`)).toHaveLength(1);
  expect(await dbAll(`SELECT * FROM ${state.schema}.oidc_clients WHERE client_id <> 'penpot' ORDER BY id`)).toEqual(before);
  const backup = results.find((r) => r.changed).backup;
  const path = backup.file.replace('/root/backups/temp/oidc-penpot', state.backupDir);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(backup.sha256);
  expect(JSON.parse(await readFile(path, 'utf8')).clients[0].client_secret).toBe('legacy-test-secret');
});
test.each(['audit', 'vault'])('%s failure rolls back registry, vault and receipt; retry works', async (failure) => {
  const input = await command();
  state.failAudit = failure === 'audit'; state.failVault = failure === 'vault';
  await expect(changePenpotClient(input)).rejects.toThrow(`forced ${failure} failure`);
  expect((await dbGet(`SELECT * FROM ${state.schema}.oidc_clients WHERE client_id = 'penpot'`)).client_secret).toBe('legacy-test-secret');
  expect(await dbAll(`SELECT * FROM ${state.schema}._secrets`)).toEqual([]);
  expect(await dbAll(`SELECT * FROM ${state.schema}.audit_log`)).toEqual([]);
  expect(vault.health().cacheSize).toBe(0);
  state.failAudit = false; state.failVault = false;
  expect(await changePenpotClient(input)).toMatchObject({ changed: true });
});
test('old secret rejected, new accepted; second rotation bypasses cached previous secret', async () => {
  expect(await verifyClientSecret(await getClient('penpot'), 'legacy-test-secret')).toBe(true);
  const first = await changePenpotClient(await command());
  const old = await vault.getSecret(first.secret_ref);
  expect(await verifyClientSecret(await getClient('penpot'), old)).toBe(true);
  expect(await verifyClientSecret(await getClient('penpot'), 'legacy-test-secret')).toBe(false);
  const second = await changePenpotClient(await command());
  const client = await getClient('penpot');
  expect(client.secret_ref).not.toBe(first.secret_ref);
  expect(await verifyClientSecret(client, old)).toBe(false);
  expect(await verifyClientSecret(client, await vault.getSecret(second.secret_ref))).toBe(true);
  expect(isRedirectUriAllowed(client, callback)).toBe(true);
  expect(isRedirectUriAllowed(client, callback + '/')).toBe(false);
  expect(isRedirectUriAllowed(client, callback.replace('design.godcrm.ai', 'design.godcrm.ai.evil.test'))).toBe(false);
});
test('different concurrent rotation requests cannot both pass the same revision', async () => {
  const input = await command();
  const results = await Promise.allSettled([changePenpotClient(input), changePenpotClient({ ...input, request_id: randomUUID() })]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected').reason.message).toBe('REVISION_CONFLICT');
});
test('disabled client stays disabled through rotation; recovery enables only the new secret', async () => {
  await changePenpotClient(await command('disable'));
  await expect(changePenpotClient(await command('enable'))).rejects.toThrow('SECRET_UNAVAILABLE');
  const input = await command();
  const rotated = await changePenpotClient(input);
  expect(rotated.is_active).toBe(0); expect(await getClient('penpot')).toBeNull();
  await changePenpotClient(await command('enable'));
  expect(await verifyClientSecret(await getClient('penpot'), await vault.getSecret(rotated.secret_ref))).toBe(true);
  await changePenpotClient(await command('disable'));
  expect(await changePenpotClient(input)).toMatchObject({ replayed: true, is_active: 0 });
  expect(await getClient('penpot')).toBeNull();
});
