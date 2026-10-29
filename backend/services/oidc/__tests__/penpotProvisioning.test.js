// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('node:os', () => ({ networkInterfaces: vi.fn() }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), lstat: vi.fn(), open: vi.fn() }));
vi.mock('../../../database/connection.js', () => ({ withTransactionAsync: vi.fn() }));
vi.mock('../../secrets/SecretsVault.js', () => ({ default: {
  health: vi.fn(), putSecret: vi.fn(), getSecret: vi.fn(),
} }));
import { networkInterfaces } from 'node:os';
import { mkdir, lstat, open } from 'node:fs/promises';
import { withTransactionAsync } from '../../../database/connection.js';
import vault from '../../secrets/SecretsVault.js';
import { changePenpotClient } from '../penpotProvisioning.js';
const callback = 'https://design.godcrm.ai/api/auth/oidc/callback';
const request_id = '32a606ed-4489-4567-b124-a98956e388bd';
const fields = {
  oidc_clients: { id: 'integer', client_id: 'text', client_secret: 'text', secret_ref: 'text',
    redirect_uris: 'text', allowed_scopes: 'text', is_active: 'integer', token_endpoint_auth_method: 'text',
    updated_at: 'timestamp without time zone' },
  _secrets: { key: 'text', encrypted_payload: 'jsonb', description: 'text', created_by: 'integer',
    space_id: 'integer', created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
  audit_log: { user_id: 'integer', action: 'text', entity_type: 'text', entity_id: 'text', details: 'text' },
};
let rows, secrets, schema, target, owner, trx, contents, file, receipt;
beforeEach(() => {
  vi.resetAllMocks();
  rows = [{ id: 5, client_id: 'penpot', client_secret: 'old-exposed-test-secret', secret_ref: null,
    redirect_uris: JSON.stringify(['https://design.hltrn.cc/api/auth/oidc/callback', callback]),
    allowed_scopes: '["openid","profile","email"]', is_active: 1, token_endpoint_auth_method: 'client_secret_post',
    updated_at: '2026-10-08', name: 'Penpot', space_id: null }];
  secrets = []; receipt = null; owner = 1;
  target = { database: 'godcrm_prod', address: '127.0.0.1/32' };
  schema = Object.entries(fields).flatMap(([table_name, cols]) => Object.entries(cols)
    .map(([column_name, data_type]) => ({ table_name, column_name, data_type, is_nullable: 'YES' })));
  networkInterfaces.mockReturnValue({ eth0: [{ address: '<PROD_IP>' }] });
  lstat.mockResolvedValue({ isDirectory: () => true, mode: 0o700, uid: process.getuid() });
  contents = '';
  file = { writeFile: vi.fn(async (text) => { contents = text; }), sync: vi.fn(),
    readFile: vi.fn(async () => contents), close: vi.fn() };
  open.mockResolvedValue(file);
  vault.health.mockReturnValue({ ok: true, hasKey: true });
  vault.getSecret.mockImplementation(async () => vault.putSecret.mock.calls.at(-1)?.[1] || 'existing-test-secret');
  trx = {
    get: vi.fn(async (sql) => sql.includes('current_database') ? target
      : sql.includes('spaces') ? { owner_id: owner } : receipt),
    all: vi.fn(async (sql) => sql.includes('information_schema') ? schema
      : sql.includes('oidc_clients') ? rows : secrets),
    run: vi.fn(async (sql, params) => {
      if (sql.includes('UPDATE public.oidc_clients')) {
        if (sql.includes('client_secret = NULL')) { rows[0].client_secret = null; rows[0].secret_ref = params[0]; }
        else rows[0].is_active = params[0];
      }
    }),
  };
  withTransactionAsync.mockImplementation(async (fn) => fn(trx));
});
const inspect = () => changePenpotClient({ action: 'inspect', actor: 1 });
const mutate = async (action = 'rotate') => changePenpotClient({ action, actor: 1, request_id,
  expected_revision: (await inspect()).revision });

test('inspect exposes only metadata and does not write or create a backup', async () => {
  const result = await inspect();
  expect(result).toMatchObject({ client_id: 'penpot', has_legacy_secret: true, secret_ref: null, is_active: 1 });
  expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain('old-exposed');
  expect(open).not.toHaveBeenCalled();
  expect(trx.run.mock.calls.some(([sql]) => /INSERT|UPDATE/.test(sql))).toBe(false);
});
test('rotation preserves callbacks, scopes, active flag and removes legacy fallback atomically', async () => {
  const before = structuredClone(rows[0]);
  const result = await mutate();
  expect(result).toMatchObject({ changed: true, has_legacy_secret: false, is_active: 1 });
  expect(result.secret_ref).toBe(`oidc_penpot_${request_id.replaceAll('-', '')}`);
  expect(rows[0]).toEqual({ ...before, client_secret: null, secret_ref: result.secret_ref });
  expect(vault.putSecret).toHaveBeenCalledWith(result.secret_ref, expect.stringMatching(/^[\w-]{43}$/),
    expect.objectContaining({ actor: 1, spaceId: 11, transaction: trx }));
  expect(file.sync.mock.invocationCallOrder[0]).toBeLessThan(vault.putSecret.mock.invocationCallOrder[0]);
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/^\/root\/backups\/temp\/oidc-penpot\//), 'wx+', 0o600);
  expect(JSON.stringify(result)).not.toContain('old-exposed');
  expect(JSON.stringify(result)).not.toContain(vault.putSecret.mock.calls[0][1]);
  expect(JSON.stringify(trx.run.mock.calls)).not.toContain('old-exposed');
});
test('rotation does not activate a disabled client', async () => {
  rows[0].is_active = 0;
  expect(await mutate()).toMatchObject({ is_active: 0 });
});
test('stale revision fails before backup or vault write', async () => {
  await expect(changePenpotClient({ actor: 1, action: 'rotate', request_id, expected_revision: 'a'.repeat(64) }))
    .rejects.toThrow('REVISION_CONFLICT');
  expect(open).not.toHaveBeenCalled(); expect(vault.putSecret).not.toHaveBeenCalled();
});
test.each([2, 0, null])('rejects actor %s', async (actor) => {
  await expect(changePenpotClient({ action: 'inspect', actor })).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
});
test('rejects wrong host before SQL', async () => {
  networkInterfaces.mockReturnValue({ eth0: [{ address: '<RING1_IP>' }] });
  await expect(inspect()).rejects.toThrow('WRONG_MASTER');
  expect(withTransactionAsync).not.toHaveBeenCalled();
});
test.each([{ database: 'godcrm_test', address: '127.0.0.1/32' },
  { database: 'godcrm_prod', address: '<RING1_IP>/32' },
  { database: 'godcrm_prod', address: null }])('rejects wrong actual DB target %j', async (value) => {
  target = value; await expect(inspect()).rejects.toThrow('WRONG_DATABASE');
});
test.each(['type', 'missing', 'required', 'nullable'])('rejects schema drift %s', async (kind) => {
  if (kind === 'type') schema[0].data_type = 'text';
  if (kind === 'missing') schema = schema.filter((col) => col.column_name !== 'secret_ref');
  if (kind === 'required') schema.push({ table_name: '_secrets', column_name: 'new_required', is_nullable: 'NO' });
  if (kind === 'nullable') schema.find((col) => col.column_name === 'client_secret').is_nullable = 'NO';
  await expect(mutate()).rejects.toThrow('SCHEMA'); expect(open).not.toHaveBeenCalled();
});
test.each(['duplicate', 'callback', 'public', 'foreign_ref', 'orphan', 'shared_ref'])('rejects client conflict %s', async (kind) => {
  if (kind === 'duplicate') rows.push({ ...rows[0], id: 6 });
  if (kind === 'callback') rows[0].redirect_uris = JSON.stringify([callback + '/']);
  if (kind === 'public') rows[0].token_endpoint_auth_method = 'none';
  if (kind === 'foreign_ref') rows[0].secret_ref = 'oidc_forgejo_client_secret';
  if (kind === 'orphan') secrets.push({ key: `oidc_penpot_${request_id.replaceAll('-', '')}`, space_id: 11 });
  if (kind === 'shared_ref') rows.push({ ...rows[0], client_id: 'forgejo' });
  await expect(mutate()).rejects.toThrow('CONFLICT'); expect(open).not.toHaveBeenCalled();
});
test('missing client is not implicitly provisioned', async () => {
  rows = []; await expect(inspect()).rejects.toThrow('CLIENT_NOT_FOUND');
});
test.each(['mkdir', 'permissions', 'symlink', 'hash'])('fails closed on backup %s', async (kind) => {
  if (kind === 'mkdir') mkdir.mockRejectedValue(new Error('backup failed'));
  if (kind === 'permissions') lstat.mockResolvedValue({ isDirectory: () => true, mode: 0o755 });
  if (kind === 'symlink') lstat.mockResolvedValue({ isDirectory: () => false, mode: 0o700 });
  if (kind === 'hash') file.readFile.mockResolvedValue('corrupt');
  await expect(mutate()).rejects.toThrow(); expect(vault.putSecret).not.toHaveBeenCalled();
});
test('disable works without vault, enable rejects legacy and missing secrets', async () => {
  vault.health.mockReturnValue({ ok: false, hasKey: false });
  expect(await mutate('disable')).toMatchObject({ is_active: 0 });
  await expect(mutate('enable')).rejects.toThrow('SECRET');
});
test('vault readback and audit errors reject operation', async () => {
  vault.getSecret.mockResolvedValue(null);
  await expect(mutate()).rejects.toThrow('SECRET_READBACK_FAILED');
});
test('repeat request returns current metadata without rotating or re-enabling', async () => {
  const expected_revision = (await inspect()).revision;
  const result = await mutate();
  receipt = { action: 'oidc.penpot.rotate', details: JSON.stringify({ request_id, expected_revision }) };
  rows[0].is_active = 0;
  const replay = await changePenpotClient({ action: 'rotate', actor: 1, request_id, expected_revision });
  expect(replay).toMatchObject({ replayed: true, changed: false, is_active: 0, secret_ref: result.secret_ref });
  expect(vault.putSecret).toHaveBeenCalledTimes(1);
});
test('reusing request UUID with different payload fails closed', async () => {
  receipt = { action: 'oidc.penpot.disable', details: JSON.stringify({ request_id, expected_revision: 'a'.repeat(64) }) };
  await expect(mutate()).rejects.toThrow('IDEMPOTENCY_CONFLICT');
});
