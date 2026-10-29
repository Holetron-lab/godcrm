// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('node:os', () => ({ networkInterfaces: vi.fn() }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), lstat: vi.fn(), open: vi.fn() }));
vi.mock('../../../database/connection.js', () => ({ withTransactionAsync: vi.fn() }));
vi.mock('../../secrets/SecretsVault.js', () => ({ default: {
  health: vi.fn(), putSecret: vi.fn(), getSecret: vi.fn(),
} }));
const config = vi.hoisted(() => ({ ISSUER: 'https://id.godcrm.ai' }));
vi.mock('../../../config/oidc.config.js', () => config);
import { networkInterfaces } from 'node:os';
import { mkdir, lstat, open } from 'node:fs/promises';
import { withTransactionAsync } from '../../../database/connection.js';
import vault from '../../secrets/SecretsVault.js';
import { changeForgejoClient } from '../forgejoProvisioning.js';

const registered = {
  id: 4, client_id: 'forgejo', name: 'Forgejo GOD CRM', client_secret: null,
  secret_ref: 'oidc_forgejo_client_secret', token_endpoint_auth_method: 'client_secret_post',
  redirect_uris: '["https://godcrm.ai/git/user/oauth2/GOD%20CRM/callback"]',
  allowed_scopes: '["openid","profile","email"]', is_active: 1,
  login_tier: 'oidc', space_id: null, assistant_id: null, default_conversation: null,
};
const fields = {
  oidc_clients: { id: 'integer', client_id: 'text', name: 'text', client_secret: 'text', secret_ref: 'text',
    redirect_uris: 'text', allowed_scopes: 'text', is_active: 'integer', token_endpoint_auth_method: 'text',
    login_tier: 'text', space_id: 'integer', assistant_id: 'integer', default_conversation: 'integer',
    updated_at: 'timestamp without time zone' },
  _secrets: { key: 'text', encrypted_payload: 'jsonb', description: 'text', created_by: 'integer',
    space_id: 'integer', created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
  audit_log: { user_id: 'integer', action: 'text', entity_type: 'text', entity_id: 'text', details: 'text' },
};
let rows, secretRows, schema, database, contents, trx, file;
beforeEach(() => {
  vi.resetAllMocks();
  config.ISSUER = 'https://id.godcrm.ai';
  rows = []; secretRows = []; database = 'godcrm_prod'; contents = '';
  schema = Object.entries(fields).flatMap(([table_name, columns]) => Object.entries(columns)
    .map(([column_name, data_type]) => ({ table_name, column_name, data_type, is_nullable: 'YES' })));
  networkInterfaces.mockReturnValue({ eth0: [{ address: '<PROD_IP>' }] });
  lstat.mockResolvedValue({ isDirectory: () => true, mode: 0o700 });
  file = { writeFile: vi.fn(async (text) => { contents = text; }), sync: vi.fn(),
    readFile: vi.fn(async () => contents), close: vi.fn() };
  open.mockResolvedValue(file);
  vault.health.mockReturnValue({ ok: true, hasKey: true });
  vault.getSecret.mockImplementation(async () => vault.putSecret.mock.calls[0]?.[1] || 'existing-secret');
  trx = {
    get: vi.fn(async (sql) => sql.includes('current_database')
      ? { database, address: '127.0.0.1/32' } : { owner_id: 1 }),
    all: vi.fn(async (sql) => sql.includes('information_schema') ? schema
      : sql.includes('oidc_clients') ? rows : secretRows),
    run: vi.fn().mockResolvedValue({ lastInsertRowid: 4 }),
  };
  withTransactionAsync.mockImplementation(async (fn) => fn(trx));
});

test('creates only the pinned confidential client; snapshot precedes secret and audit', async () => {
  const result = await changeForgejoClient({ action: 'provision', actor: 1 });
  expect(result).toMatchObject({ client_id: 'forgejo', is_active: 1, changed: true });
  expect(vault.putSecret).toHaveBeenCalledWith('oidc_forgejo_client_secret', expect.stringMatching(/^[\w-]{43}$/),
    expect.objectContaining({ actor: 1, spaceId: 11, transaction: trx }));
  expect(file.sync.mock.invocationCallOrder[0]).toBeLessThan(vault.putSecret.mock.invocationCallOrder[0]);
  expect(trx.run.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.audit_log'))).toBe(true);
  const insert = trx.run.mock.calls.find(([sql]) => sql.includes('INSERT INTO public.oidc_clients'));
  expect(insert[1]).toContain('forgejo');
  expect(JSON.stringify(insert)).not.toContain(vault.putSecret.mock.calls[0][1]);
  expect(contents).not.toContain(vault.putSecret.mock.calls[0][1]);
});

test.each([2, null])('rejects non-owner actor %s before backup or mutation', async (actor) => {
  await expect(changeForgejoClient({ action: 'provision', actor })).rejects.toThrow();
  expect(open).not.toHaveBeenCalled(); expect(vault.putSecret).not.toHaveBeenCalled();
});
test('rejects wrong host', async () => {
  networkInterfaces.mockReturnValue({ eth0: [{ address: '<RING1_IP>' }] });
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow('WRONG_MASTER');
  expect(withTransactionAsync).not.toHaveBeenCalled();
});
test('rejects actual test database even on master A host', async () => {
  database = 'godcrm_test';
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow('WRONG_DATABASE');
  expect(open).not.toHaveBeenCalled();
});
test.each(['duplicate', 'callback', 'secret', 'binding', 'orphan'])('fails closed on %s conflict', async (conflict) => {
  rows = [{ ...registered }]; secretRows = [{ key: registered.secret_ref }];
  if (conflict === 'duplicate') rows.push({ ...registered, id: 5 });
  if (conflict === 'callback') rows[0].redirect_uris = '["https://evil.test"]';
  if (conflict === 'secret') rows[0].client_secret = 'plaintext';
  if (conflict === 'binding') rows[0].space_id = 7820;
  if (conflict === 'orphan') rows = [];
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow('CONFLICT');
  expect(open).not.toHaveBeenCalled(); expect(vault.putSecret).not.toHaveBeenCalled();
});
test('identical repeat does not insert a client or rotate the secret', async () => {
  rows = [{ ...registered }]; secretRows = [{ key: registered.secret_ref }];
  expect(await changeForgejoClient({ action: 'provision', actor: 1 })).toMatchObject({ changed: false });
  expect(vault.putSecret).not.toHaveBeenCalled();
  expect(trx.run.mock.calls.some(([sql]) => sql.includes('INSERT INTO public.oidc_clients'))).toBe(false);
});
test('disable and explicit enable affect only forgejo; provisioning cannot reenable', async () => {
  rows = [{ ...registered }]; secretRows = [{ key: registered.secret_ref }];
  expect(await changeForgejoClient({ action: 'disable', actor: 1 })).toMatchObject({ is_active: 0 });
  expect(trx.run.mock.calls.find(([sql]) => sql.includes('UPDATE public.oidc_clients'))[1]).toEqual([0, 4, 'forgejo']);
  rows[0].is_active = 0;
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow('CONFLICT');
  expect(await changeForgejoClient({ action: 'enable', actor: 1 })).toMatchObject({ is_active: 1 });
  expect(vault.putSecret).not.toHaveBeenCalled();
});
test.each(['missing', 'type', 'required', 'nullable'])('refuses schema drift: %s', async (kind) => {
  if (kind === 'missing') schema = schema.filter((col) => col.column_name !== 'secret_ref');
  if (kind === 'type') schema.find((col) => col.column_name === 'is_active').data_type = 'boolean';
  if (kind === 'required') schema.push({ table_name: 'oidc_clients', column_name: 'unknown', is_nullable: 'NO', column_default: null });
  if (kind === 'nullable') schema.find((col) => col.column_name === 'client_secret').is_nullable = 'NO';
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow('SCHEMA');
  expect(open).not.toHaveBeenCalled();
});
test('backup failure prevents all writes', async () => {
  mkdir.mockRejectedValue(new Error('readonly'));
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow();
  expect(vault.putSecret).not.toHaveBeenCalled();
});
test('unreadable vault secret and failed audit abort the transaction', async () => {
  vault.getSecret.mockResolvedValue(null);
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow('SECRET');
  vault.getSecret.mockImplementation(async () => vault.putSecret.mock.calls.at(-1)[1]);
  trx.run.mockImplementation(async (sql) => { if (sql.includes('audit_log')) throw new Error('audit unavailable'); });
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow('audit unavailable');
});

test.each(['https://app.godcrm.ai', 'https://crm.hltrn.cc', 'https://id.godcrm.ai/', 'http://id.godcrm.ai'])('rejects non-canonical issuer %s before database access', async (issuer) => {
  config.ISSUER = issuer;
  await expect(changeForgejoClient({ action: 'provision', actor: 1 })).rejects.toThrow('WRONG_MASTER');
  expect(withTransactionAsync).not.toHaveBeenCalled();
});
