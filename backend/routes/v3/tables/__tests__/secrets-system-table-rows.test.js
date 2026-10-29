// @vitest-environment node
// ADR-0040 §space-secrets — the per-space `Secrets` system table is writable
// from the rows API exactly like Users: POST/PUT/DELETE land in the encrypted
// vault scoped to the table's space, and only the space owner may write.
// DB-backed (godcrm_test, ADR-0009).
import '../../../../test/setup.js';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

if (!process.env.SECRETS_MASTER_KEY) {
  process.env.SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
}

const { dbRun, dbGet, dbAll } = await import('../../../../database/connection.js');
const { PostgresAdapter } = await import('../../../../database/adapters/PostgresAdapter.js');
const { default: secretsVault } = await import('../../../../services/secrets/SecretsVault.js');
const { ensureSecretsSystemTableForSpace } = await import('../../../../services/SystemTablesCreator.js');
const { createEphemeralWorkspace } = await import('../../../../tests/helpers/workspace-fixture.js');
const { lockSecretsSuite, ensureSecretsTable } = await import('../../../../tests/helpers/secrets-suite.js');
const { default: tablesRouter } = await import('../index.js');

let currentUser = null;
const app = express();
app.use(express.json());
app.use('/api/v3', (req, _res, next) => { req.user = currentUser; next(); }, tablesRouter);
const as = (ws, role = 'viewer') => { currentUser = { id: ws.userId, email: ws.email, role }; return request(app); };

let owner;
let editor;
let tableId;
let adapter;
let releaseSuite;
const projectIds = [];

beforeAll(async () => {
  releaseSuite = await lockSecretsSuite();
  owner = await createEphemeralWorkspace({ label: 'secrets-rows-owner', dashboard: false, table: false });
  editor = await createEphemeralWorkspace({ label: 'secrets-rows-editor', dashboard: false, table: false });
  await dbRun(
    'INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by) VALUES (?, ?, ?, ?)',
    [editor.userId, owner.spaceId, 'editor', owner.userId]
  );
  adapter = new PostgresAdapter({});
  await adapter.initialize();
  await ensureSecretsTable(adapter);
  await secretsVault.init({ adapter });
  tableId = await ensureSecretsSystemTableForSpace(owner.spaceId);
  const p = await dbGet("SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'", [owner.spaceId]);
  projectIds.push(p.id);
}, 120_000);

afterAll(async () => {
  await dbRun('DELETE FROM _secrets WHERE space_id = ?', [owner.spaceId]);
  await dbRun("DELETE FROM audit_log WHERE entity_type = 'secret' AND user_id IN (?, ?)", [owner.userId, editor.userId]);
  await dbRun('DELETE FROM user_access_permissions WHERE user_id = ?', [editor.userId]);
  for (const pid of projectIds) {
    for (const t of await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [pid])) {
      await dbRun('DELETE FROM table_columns WHERE table_id = ?', [t.id]);
      await dbRun('DELETE FROM universal_tables WHERE id = ?', [t.id]);
    }
    await dbRun('DELETE FROM projects WHERE id = ?', [pid]);
  }
  await editor.cleanup();
  await owner.cleanup();
  try { await secretsVault.shutdown(); } catch { /* ignore */ }
  try { await adapter.close?.(); } catch { /* ignore */ }
  await releaseSuite?.();
});

const vaultRow = (key) => dbGet('SELECT id, key, description, encrypted_payload FROM _secrets WHERE space_id = ? AND key = ?', [owner.spaceId, key]);

describe('owner writes through the rows API', () => {
  it('POST creates an encrypted secret in the table space; plaintext never stored or echoed', async () => {
    const res = await as(owner).post(`/api/v3/tables/${tableId}/rows`)
      .send({ data: { key: 'grid_key', value: 'hunter2', description: 'from grid' } });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toMatch(/^secret-\d+$/);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');

    const row = await vaultRow('grid_key');
    expect(row.description).toBe('from grid');
    const blob = typeof row.encrypted_payload === 'string' ? JSON.parse(row.encrypted_payload) : row.encrypted_payload;
    expect(blob.v).toBe(1);
    expect(JSON.stringify(row)).not.toContain('hunter2');
    expect(await secretsVault.getSecret('grid_key', { spaceId: owner.spaceId })).toBe('hunter2');
  });

  it('POST accepts the grid column ids (col-<table>-<idx>) and rejects a duplicate key', async () => {
    const res = await as(owner).post(`/api/v3/tables/${tableId}/rows`)
      .send({ data: { [`col-${tableId}-1`]: 'by_col_id', [`col-${tableId}-2`]: 'v1' } });
    expect(res.status).toBe(201);
    expect(await secretsVault.getSecret('by_col_id', { spaceId: owner.spaceId })).toBe('v1');

    const dup = await as(owner).post(`/api/v3/tables/${tableId}/rows`)
      .send({ data: { key: 'by_col_id', value: 'v2' } });
    expect(dup.status).toBe(409);
  });

  it('POST validates key and value', async () => {
    expect((await as(owner).post(`/api/v3/tables/${tableId}/rows`).send({ data: { key: 'bad key!', value: 'x' } })).status).toBe(400);
    expect((await as(owner).post(`/api/v3/tables/${tableId}/rows`).send({ data: { key: 'no_value' } })).status).toBe(400);
  });

  it('GET lists the space secrets masked', async () => {
    const res = await as(owner).get(`/api/v3/tables/${tableId}/rows`);
    expect(res.status).toBe(200);
    const keys = res.body.data.rows.map((r) => r.data.key).sort();
    expect(keys).toEqual(['by_col_id', 'grid_key']);
    expect(res.body.data.rows.every((r) => r.data.value === '••••••••')).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('PUT re-encrypts the value; a masked echo keeps the old value; key cannot be renamed', async () => {
    const row = await vaultRow('grid_key');
    const res = await as(owner).put(`/api/v3/tables/${tableId}/rows/secret-${row.id}`)
      .send({ data: { value: 'rotated', description: 'rotated desc' } });
    expect(res.status).toBe(200);
    expect(await secretsVault.getSecret('grid_key', { spaceId: owner.spaceId })).toBe('rotated');
    expect((await vaultRow('grid_key')).description).toBe('rotated desc');

    const descOnly = await as(owner).put(`/api/v3/tables/${tableId}/rows/secret-${row.id}`)
      .send({ data: { key: 'grid_key', value: '••••••••', description: 'only desc' } });
    expect(descOnly.status).toBe(200);
    expect(await secretsVault.getSecret('grid_key', { spaceId: owner.spaceId })).toBe('rotated');
    expect((await vaultRow('grid_key')).description).toBe('only desc');

    const rename = await as(owner).put(`/api/v3/tables/${tableId}/rows/secret-${row.id}`)
      .send({ data: { key: 'renamed' } });
    expect(rename.status).toBe(400);
  });

  it('DELETE removes the secret from the vault', async () => {
    const row = await vaultRow('by_col_id');
    const res = await as(owner).delete(`/api/v3/tables/${tableId}/rows/secret-${row.id}`);
    expect(res.status).toBe(200);
    expect(await vaultRow('by_col_id')).toBeFalsy();
  });
});

describe('a space editor (not owner) is refused', () => {
  it('POST / PUT / DELETE → 403 and the vault is untouched', async () => {
    const before = await vaultRow('grid_key');
    const post = await as(editor).post(`/api/v3/tables/${tableId}/rows`).send({ data: { key: 'sneaky', value: 'x' } });
    const put = await as(editor).put(`/api/v3/tables/${tableId}/rows/secret-${before.id}`).send({ data: { value: 'hijack' } });
    const del = await as(editor).delete(`/api/v3/tables/${tableId}/rows/secret-${before.id}`);
    expect([post.status, put.status, del.status]).toEqual([403, 403, 403]);
    expect(await vaultRow('sneaky')).toBeFalsy();
    expect(await secretsVault.getSecret('grid_key', { spaceId: owner.spaceId })).toBe('rotated');
  });
});
