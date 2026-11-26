// @vitest-environment node
import '../../../test/setup.js';
import { beforeAll, afterAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ schema: '', backupDir: '', failAudit: false, failVault: false }));
vi.mock('node:os', async (original) => ({ ...await original(),
  networkInterfaces: () => ({ test: [{ address: '<PROD_IP>' }] }),
}));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original();
  const map = (path) => path.replace('/root/backups/temp/oidc-level', state.backupDir);
  return { ...fs, mkdir: (path, opts) => fs.mkdir(map(path), opts),
    lstat: (path) => fs.lstat(map(path)), open: (path, ...args) => fs.open(map(path), ...args) };
});
vi.mock('../../../config/oidc.config.js', () => ({ ISSUER: 'https://id.godcrm.ai' }));
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
import { validateKey } from '../../secrets/secretsSystemTable.js';
import { changeLevelClient, LEVEL_SECRET_REF } from '../levelProvisioning.js';
import { getClient, verifyClientSecret, isRedirectUriAllowed } from '../clientRegistry.js';

const CALLBACK = 'https://sixtynine.ru/auth/social/godcrm/callback';
const ORIGIN = 'https://admin.sixtynine.ru';
const inspect = () => changeLevelClient({ action: 'inspect', actor: 1 });
const command = async (action = 'provision', dry_run = false) => ({
  action, actor: 1, request_id: randomUUID(), expected_revision: (await inspect()).revision, dry_run,
});
const clientRow = () => dbGet(`SELECT * FROM ${state.schema}.oidc_clients WHERE client_id = 'level'`);
const secretRows = () => dbAll(`SELECT * FROM ${state.schema}._secrets`);

async function insertLegacy({ secretRef = 'oidc/level/client_secret', clientSecret = null } = {}) {
  await dbRun(`INSERT INTO ${state.schema}.oidc_clients
    (client_id, name, client_secret, secret_ref, redirect_uris, allowed_scopes, allowed_origins,
     is_active, token_endpoint_auth_method, login_tier, space_id)
    VALUES ('level', 'Level Admin', $1, $2, $3, $4, $5::jsonb, 0, 'client_secret_basic', 'oidc', 35)`,
  [clientSecret, secretRef, JSON.stringify([CALLBACK]), JSON.stringify(['openid', 'profile', 'email']), JSON.stringify([ORIGIN])]);
}

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  state.schema = `level_test_${randomUUID().replaceAll('-', '')}`;
  state.backupDir = await mkdtemp(join(tmpdir(), 'level-210-'));
  await dbRun(`CREATE SCHEMA ${state.schema}`);
  await dbRun(`CREATE TABLE ${state.schema}.oidc_clients (
    id serial PRIMARY KEY, client_id text, name text, client_secret text, secret_ref text,
    redirect_uris text, allowed_scopes text, allowed_origins jsonb, is_active integer,
    token_endpoint_auth_method text, login_tier text, space_id integer,
    assistant_id integer, default_conversation integer, updated_at timestamp DEFAULT now())`);
  await dbRun(`CREATE TABLE ${state.schema}._secrets (
    id serial PRIMARY KEY, key text, encrypted_payload jsonb, description text,
    created_by integer, space_id integer, created_at timestamptz, updated_at timestamptz,
    UNIQUE(space_id, key))`);
  await dbRun(`CREATE TABLE ${state.schema}.audit_log (
    id serial PRIMARY KEY, user_id integer, action text, entity_type text, entity_id text, details text)`);
  await dbRun(`CREATE TABLE ${state.schema}.spaces (id integer, owner_id integer)`);
  await dbRun(`INSERT INTO ${state.schema}.spaces VALUES (11, 1)`);
  vi.stubEnv('SECRETS_MASTER_KEY', 'b'.repeat(64));
  await vault.init({ allowEnvFallback: false });
  vault._adapter = { query: async (sql, params) => {
    const rows = await dbAll(sql.replaceAll('FROM _secrets', `FROM ${state.schema}._secrets`), params);
    return { rows, rowCount: rows.length };
  } };
});

beforeEach(async () => {
  state.failAudit = false; state.failVault = false; vault._cache.clear();
  await dbRun(`TRUNCATE ${state.schema}.oidc_clients, ${state.schema}._secrets, ${state.schema}.audit_log`);
  for (const file of await readdir(state.backupDir)) await rm(join(state.backupDir, file));
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

test('vault-compatible ref and dry-run provision expose metadata without writes or backup', async () => {
  expect(validateKey(LEVEL_SECRET_REF)).toEqual({ ok: true, value: 'oidc_level_client_secret' });
  expect(await inspect()).toMatchObject({ exists: false, client_id: 'level', is_active: null });
  const result = await changeLevelClient(await command('provision', true));
  expect(result).toMatchObject({ dry_run: true, changed: true, secret_ref: LEVEL_SECRET_REF, is_active: 0 });
  expect(await clientRow()).toBeNull();
  expect(await secretRows()).toEqual([]);
  expect(await readdir(state.backupDir)).toEqual([]);
});

test('new provision stays inactive, verifies readback and enables only explicitly', async () => {
  const provisioned = await changeLevelClient(await command());
  expect(provisioned).toMatchObject({ changed: true, is_active: 0, secret_ref: LEVEL_SECRET_REF });
  expect(await getClient('level')).toBeNull();
  const client = await clientRow();
  expect(client).toMatchObject({ client_id: 'level', client_secret: null, secret_ref: LEVEL_SECRET_REF,
    is_active: 0, token_endpoint_auth_method: 'client_secret_basic', login_tier: 'oidc', space_id: 35 });
  expect(JSON.parse(client.redirect_uris)).toEqual([CALLBACK]);
  expect(client.allowed_origins).toEqual([ORIGIN]);
  const secrets = await secretRows();
  expect(secrets).toHaveLength(1);
  expect(secrets[0].encrypted_payload).toMatchObject({ v: 1, iv: expect.any(String), ct: expect.any(String) });
  expect(JSON.stringify(provisioned)).not.toContain(await vault.getSecret(LEVEL_SECRET_REF));
  await changeLevelClient(await command('enable'));
  const active = await getClient('level');
  expect(isRedirectUriAllowed(active, CALLBACK)).toBe(true);
  expect(isRedirectUriAllowed(active, `${CALLBACK}/`)).toBe(false);
  expect(await verifyClientSecret(active, await vault.getSecret(LEVEL_SECRET_REF))).toBe(true);
  expect(await verifyClientSecret(active, 'wrong-secret')).toBe(false);
});

test('existing migration row is repaired without activation; repeat never rotates', async () => {
  await insertLegacy();
  const first = await changeLevelClient(await command());
  expect(first).toMatchObject({ changed: true, is_active: 0, secret_ref: LEVEL_SECRET_REF });
  const before = await dbGet(`SELECT encrypted_payload FROM ${state.schema}._secrets WHERE key = $1`, [LEVEL_SECRET_REF]);
  const repeat = await changeLevelClient(await command());
  expect(repeat).toMatchObject({ changed: false, is_active: 0, secret_ref: LEVEL_SECRET_REF });
  expect(await dbGet(`SELECT encrypted_payload FROM ${state.schema}._secrets WHERE key = $1`, [LEVEL_SECRET_REF]))
    .toEqual(before);
  expect(await secretRows()).toHaveLength(1);
  expect((await clientRow()).is_active).toBe(0);
});

test('exact legacy callback and secret ref migrate once; repeat does not rotate or duplicate', async () => {
  await insertLegacy();
  await dbRun(`UPDATE ${state.schema}.oidc_clients SET redirect_uris = $1`,
    [JSON.stringify(['https://admin.sixtynine.ru/auth/social/godcrm/callback'])]);
  const first = await changeLevelClient(await command());
  expect(first).toMatchObject({ changed: true, is_active: 0, secret_ref: LEVEL_SECRET_REF });
  const client = await clientRow();
  expect(JSON.parse(client.redirect_uris)).toEqual([CALLBACK]);
  const before = await dbGet(`SELECT encrypted_payload FROM ${state.schema}._secrets WHERE key = $1`, [LEVEL_SECRET_REF]);
  const repeat = await changeLevelClient(await command());
  expect(repeat).toMatchObject({ changed: false, is_active: 0, secret_ref: LEVEL_SECRET_REF });
  expect(await dbGet(`SELECT encrypted_payload FROM ${state.schema}._secrets WHERE key = $1`, [LEVEL_SECRET_REF]))
    .toEqual(before);
  expect(await dbAll(`SELECT * FROM ${state.schema}.oidc_clients`)).toHaveLength(1);
  expect(await secretRows()).toHaveLength(1);
});

test('non-legacy callback conflict remains rejected before mutation', async () => {
  await insertLegacy();
  const input = await command();
  await dbRun(`UPDATE ${state.schema}.oidc_clients SET redirect_uris = $1`,
    [JSON.stringify(['https://evil.example/callback'])]);
  await expect(changeLevelClient(input)).rejects.toThrow('CLIENT_CONFLICT');
  expect(JSON.parse((await clientRow()).redirect_uris)).toEqual(['https://evil.example/callback']);
  expect(await secretRows()).toEqual([]);
});

test('existing plaintext fallback is removed and never disclosed in metadata or audit', async () => {
  await insertLegacy({ secretRef: null, clientSecret: 'legacy-level-test-secret' });
  const inspected = await inspect();
  expect(inspected).toMatchObject({ has_legacy_secret: true, secret_available: false });
  expect(JSON.stringify(inspected)).not.toContain('legacy-level-test-secret');
  const result = await changeLevelClient(await command());
  expect(result).toMatchObject({ has_legacy_secret: false, secret_ref: LEVEL_SECRET_REF });
  expect((await clientRow()).client_secret).toBeNull();
  const audits = await dbAll(`SELECT * FROM ${state.schema}.audit_log`);
  expect(JSON.stringify(audits)).not.toContain('legacy-level-test-secret');
  expect(JSON.stringify(result)).not.toContain('legacy-level-test-secret');
});

test('enable fails closed without a readable vault secret, including dry-run', async () => {
  await insertLegacy({ secretRef: LEVEL_SECRET_REF });
  await expect(changeLevelClient(await command('enable', true))).rejects.toThrow('SECRET_UNAVAILABLE');
  expect((await clientRow()).is_active).toBe(0);
  expect(await secretRows()).toEqual([]);
  expect(await readdir(state.backupDir)).toEqual([]);
});

test('explicit rotation replaces the credential and preserves active state', async () => {
  await changeLevelClient(await command());
  await changeLevelClient(await command('enable'));
  const oldSecret = await vault.getSecret(LEVEL_SECRET_REF);
  const rotated = await changeLevelClient(await command('rotate'));
  expect(rotated.secret_ref).toMatch(/^oidc_level_[a-f0-9]{32}$/);
  expect(rotated).toMatchObject({ changed: true, is_active: 1, has_legacy_secret: false });
  const newSecret = await vault.getSecret(rotated.secret_ref);
  expect(newSecret).not.toBe(oldSecret);
  expect(await verifyClientSecret(await getClient('level'), oldSecret)).toBe(false);
  expect(await verifyClientSecret(await getClient('level'), newSecret)).toBe(true);
  const second = await changeLevelClient(await command('rotate'));
  expect(second.secret_ref).not.toBe(rotated.secret_ref);
  expect(await verifyClientSecret(await getClient('level'), newSecret)).toBe(false);
  expect(await verifyClientSecret(await getClient('level'), await vault.getSecret(second.secret_ref))).toBe(true);
  expect(await changeLevelClient(await command())).toMatchObject({ changed: false, secret_ref: second.secret_ref });
});

test('identical request replay is idempotent and does not re-enable or rotate', async () => {
  const input = await command();
  const first = await changeLevelClient(input);
  await changeLevelClient(await command('enable'));
  await changeLevelClient(await command('disable'));
  const replay = await changeLevelClient(input);
  expect(replay).toMatchObject({ replayed: true, changed: false, is_active: 0, secret_ref: first.secret_ref });
  expect(await secretRows()).toHaveLength(1);
  expect(await dbAll(`SELECT * FROM ${state.schema}.audit_log WHERE action = 'oidc.level.provision'`)).toHaveLength(1);
});

test('concurrent provisioning creates one client and one secret', async () => {
  const input = await command();
  const results = await Promise.all([changeLevelClient(input), changeLevelClient(input)]);
  expect(results.map((result) => result.changed).sort()).toEqual([false, true]);
  expect(await dbAll(`SELECT * FROM ${state.schema}.oidc_clients`)).toHaveLength(1);
  expect(await secretRows()).toHaveLength(1);
});

test('stale revision and conflicting registry fail before mutation', async () => {
  await expect(changeLevelClient({ ...await command(), expected_revision: 'a'.repeat(64) }))
    .rejects.toThrow('REVISION_CONFLICT');
  await insertLegacy({ clientSecret: 'legacy-level-test-secret' });
  const conflicting = await command();
  await dbRun(`UPDATE ${state.schema}.oidc_clients SET allowed_origins = '["https://evil.example"]'`);
  await expect(changeLevelClient(conflicting)).rejects.toThrow('CLIENT_CONFLICT');
  expect(await secretRows()).toEqual([]);
});

test.each(['audit', 'vault'])('%s failure rolls back registry and vault; retry succeeds', async (failure) => {
  const input = await command();
  state.failAudit = failure === 'audit'; state.failVault = failure === 'vault';
  await expect(changeLevelClient(input)).rejects.toThrow(`forced ${failure} failure`);
  expect(await clientRow()).toBeNull();
  expect(await secretRows()).toEqual([]);
  state.failAudit = false; state.failVault = false;
  expect(await changeLevelClient(input)).toMatchObject({ changed: true });
});

test('backup is private, verified and contains no generated plaintext secret', async () => {
  const result = await changeLevelClient(await command());
  const path = result.backup.file.replace('/root/backups/temp/oidc-level', state.backupDir);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const contents = await readFile(path);
  expect(createHash('sha256').update(contents).digest('hex')).toBe(result.backup.sha256);
  expect(contents.toString()).not.toContain(await vault.getSecret(LEVEL_SECRET_REF));
});
