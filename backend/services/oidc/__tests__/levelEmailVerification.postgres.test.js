// @vitest-environment node
import '../../../test/setup.js';
import { beforeAll, afterAll, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const state = vi.hoisted(() => ({ schema: '', failAudit: false }));
vi.mock('node:os', async (original) => ({ ...await original(),
  networkInterfaces: () => ({ test: [{ address: '<PROD_IP>' }] }),
}));
vi.mock('../../../config/oidc.config.js', () => ({ ISSUER: 'https://id.godcrm.ai' }));
vi.mock('../../../database/connection.js', async (original) => {
  const db = await original();
  const rewrite = (sql) => sql.replaceAll('public.', `${state.schema}.`);
  return { ...db,
    dbRun: (sql, params) => db.dbRun(rewrite(sql), params),
    dbGet: (sql, params) => db.dbGet(rewrite(sql), params),
    dbAll: (sql, params) => db.dbAll(rewrite(sql), params),
    withTransactionAsync: (fn) => db.withTransactionAsync(async (real) => {
      const actual = await real.get('SELECT current_database() AS name');
      if (actual.name !== 'godcrm_test') throw new Error('Integration test refused unsafe database');
      const trx = Object.fromEntries(['get', 'all', 'run', 'query'].map((method) => [method, async (sql, params) => {
        if (sql.includes('current_database() AS database')) return { database: 'godcrm_prod', address: '127.0.0.1/32' };
        if (state.failAudit && sql.includes('INSERT INTO public.audit_log')) throw new Error('forced audit failure');
        return real[method](rewrite(sql), params);
      }]));
      return fn(trx);
    }) };
});

import { dbRun, dbGet, dbAll, destroyAdapter } from '../../../database/connection.js';
import { verifyLevelPilotEmail } from '../levelEmailVerification.js';

const EMAIL = 'private-pilot@example.test';
const input = () => ({ actor: 1, user_id: 6, request_id: randomUUID() });
const target = () => dbGet(`SELECT * FROM ${state.schema}.users WHERE id = 6`);
const audits = () => dbAll(`SELECT * FROM ${state.schema}.audit_log`);

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  state.schema = `level_email_test_${randomUUID().replaceAll('-', '')}`;
  await dbRun(`CREATE SCHEMA ${state.schema}`);
  await dbRun(`CREATE TABLE ${state.schema}.users (
    id integer PRIMARY KEY, email text NOT NULL UNIQUE, email_verified integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'active', user_type text NOT NULL DEFAULT 'human', updated_at timestamp)`);
  await dbRun(`CREATE TABLE ${state.schema}.spaces (id integer PRIMARY KEY, owner_id integer)`);
  await dbRun(`INSERT INTO ${state.schema}.spaces VALUES (11, 1)`);
  await dbRun(`CREATE TABLE ${state.schema}.audit_log (
    id serial PRIMARY KEY, user_id integer, action text, entity_type text, entity_id text, details text)`);
});

beforeEach(async () => {
  state.failAudit = false;
  await dbRun(`TRUNCATE ${state.schema}.users, ${state.schema}.audit_log`);
  await dbRun(`INSERT INTO ${state.schema}.users (id, email) VALUES (6, $1)`, [EMAIL]);
});

afterAll(async () => {
  if (state.schema) {
    for (const table of ['users', 'audit_log', 'spaces']) {
      await dbRun(`DROP TABLE IF EXISTS ${state.schema}.${table} RESTRICT`);
    }
    await dbRun(`DROP SCHEMA ${state.schema} RESTRICT`);
  }
  await destroyAdapter();
});

test('owner verifies only the fixed active human pilot and audit contains no email', async () => {
  const result = await verifyLevelPilotEmail(input());
  expect(result).toEqual({ user_id: 6, email_verified: true, changed: true, replayed: false });
  expect((await target()).email_verified).toBe(1);
  expect(await audits()).toHaveLength(1);
  expect(await audits()).toMatchObject([{ user_id: 1, action: 'oidc.level.email_verified', entity_type: 'user', entity_id: '6' }]);
  expect(JSON.stringify(await audits())).not.toContain(EMAIL);
  expect(JSON.stringify(result)).not.toContain(EMAIL);
});

test('same request replay and later no-op are idempotent', async () => {
  const command = input();
  expect(await verifyLevelPilotEmail(command)).toMatchObject({ changed: true, replayed: false });
  expect(await verifyLevelPilotEmail(command)).toMatchObject({ changed: false, replayed: true });
  expect(await audits()).toHaveLength(1);
  expect(await verifyLevelPilotEmail(input())).toMatchObject({ changed: false, replayed: false, email_verified: true });
  expect(await audits()).toHaveLength(2);
});

test('non-owner is denied before mutation or audit', async () => {
  await expect(verifyLevelPilotEmail({ ...input(), actor: 2 })).rejects.toThrow('OWNER_REQUIRED');
  expect((await target()).email_verified).toBe(0);
  expect(await audits()).toEqual([]);
});

test.each([
  { missing: true, code: 'TARGET_NOT_FOUND' },
  { status: 'disabled', code: 'TARGET_NOT_ELIGIBLE' },
  { userType: 'agent', code: 'TARGET_NOT_ELIGIBLE' },
])('missing, inactive or conflicting target fails closed: %j', async ({ missing, status, userType, code }) => {
  if (missing) await dbRun(`DELETE FROM ${state.schema}.users WHERE id = 6`);
  if (status) await dbRun(`UPDATE ${state.schema}.users SET status = $1 WHERE id = 6`, [status]);
  if (userType) await dbRun(`UPDATE ${state.schema}.users SET user_type = $1 WHERE id = 6`, [userType]);
  await expect(verifyLevelPilotEmail(input())).rejects.toThrow(code);
  expect(await audits()).toEqual([]);
});

test('schema rejects arbitrary target and caller-supplied actor shape', async () => {
  await expect(verifyLevelPilotEmail({ ...input(), user_id: 7 })).rejects.toThrow();
  await expect(verifyLevelPilotEmail({ ...input(), actor: '1' })).rejects.toThrow();
  expect((await target()).email_verified).toBe(0);
});

test('concurrent same-request verification has one mutation and one audit', async () => {
  const command = input();
  const results = await Promise.all([verifyLevelPilotEmail(command), verifyLevelPilotEmail(command)]);
  expect(results.map((result) => result.changed).sort()).toEqual([false, true]);
  expect(results.filter((result) => result.replayed)).toHaveLength(1);
  expect((await target()).email_verified).toBe(1);
  expect(await audits()).toHaveLength(1);
});

test('audit failure rolls back verification and retry succeeds', async () => {
  const command = input();
  state.failAudit = true;
  await expect(verifyLevelPilotEmail(command)).rejects.toThrow('forced audit failure');
  expect((await target()).email_verified).toBe(0);
  expect(await audits()).toEqual([]);
  state.failAudit = false;
  expect(await verifyLevelPilotEmail(command)).toMatchObject({ changed: true });
  expect((await target()).email_verified).toBe(1);
});
