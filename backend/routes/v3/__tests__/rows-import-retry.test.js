// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import router from '../rows.js';
import { dbGet, dbAll, dbRun } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';

let workspace;
let stranger;
let user;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = user; next(); });
app.use('/api/v3', router);
const send = payload => request(app).post(`/api/v3/tables/${workspace.tableId}/rows/import`).send(payload);

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  workspace = await createEphemeralWorkspace({ label: 'excel-retry', dashboard: false });
  stranger = await createEphemeralWorkspace({ label: 'excel-stranger', dashboard: false, table: false });
  await dbRun('INSERT INTO table_columns (table_id, column_name, type) VALUES (?, ?, ?)', [workspace.tableId, 'name', 'text']);
  user = { id: workspace.userId, role: 'viewer' };
});
afterAll(async () => {
  if (stranger) {
    await dbRun('DELETE FROM user_access_permissions WHERE user_id = ?', [stranger.userId]);
    await stranger.cleanup();
  }
  if (workspace) await workspace.cleanup();
});

describe('atomic import and retry', () => {
  it('serializes concurrent retries and rejects changed payload for the same key', async () => {
    const body = { mode: 'add', importId: randomUUID(), rows: [{ name: '00123' }, { name: 'Кириллица' }] };
    const replies = await Promise.all([send(body), send(body)]);
    expect(replies.map(r => r.status)).toEqual([200, 200]);
    expect(replies.map(r => r.body.data.stats.added).sort()).toEqual([0, 2]);
    expect(replies.map(r => r.body.data.replayed).sort()).toEqual([false, true]);
    expect((await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [workspace.tableId]))).toHaveLength(2);
    const changed = await send({ ...body, rows: [{ name: 'different' }] });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('IMPORT_CONFLICT');
  });

  it('rejects invalid later rows atomically, then accepts a corrected retry', async () => {
    const before = await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [workspace.tableId]);
    const importId = randomUUID();
    const invalid = await send({ importId, rows: [{ name: 'first' }, { unknown: 'invalid column' }] });
    expect(invalid.status).toBe(400);
    expect((await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [workspace.tableId]))).toHaveLength(before.length);
    expect((await send({ importId, rows: [{ name: 'first' }, { name: 'second' }] })).status).toBe(200);
  });

  it('rejects invalid keys/modes and typed values before writing', async () => {
    expect((await send({ importId: 'bad', rows: [{ name: 'a' }] })).status).toBe(400);
    expect((await send({ importId: randomUUID(), mode: 'update', rows: [{ name: 'a' }] })).status).toBe(400);
    expect((await send({ importId: randomUUID(), rows: [{ name: { formula: '1+1' } }] })).status).toBe(400);
    expect((await send({ importId: randomUUID(), rows: [{ name: 123 }] })).status).toBe(400);
  });

  it('uses space write permissions and enforces project-restricted API keys', async () => {
    const payload = { importId: randomUUID(), rows: [{ name: 'rights' }] };
    user = { id: workspace.userId, role: 'admin', projectId: stranger.projectId };
    expect((await send(payload)).status).toBe(403);
    user = { id: stranger.userId, role: 'viewer' };
    expect((await send(payload)).status).toBe(403);
    await dbRun('INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by) VALUES (?, ?, ?, ?)',
      [stranger.userId, workspace.spaceId, 'editor', workspace.userId]);
    expect((await send(payload)).status).toBe(200);
    await dbRun('UPDATE user_access_permissions SET access_level = ? WHERE user_id = ? AND space_id = ?',
      ['viewer', stranger.userId, workspace.spaceId]);
    expect((await send({ ...payload, importId: randomUUID() })).status).toBe(403);
    user = { id: workspace.userId, role: 'viewer' };
  });

  it('persists typed Excel values without losing leading zeros or datetime seconds', async () => {
    for (const [name, type] of [['amount', 'number'], ['enabled', 'checkbox'], ['day', 'date'], ['moment', 'datetime']]) {
      await dbRun('INSERT INTO table_columns (table_id, column_name, type) VALUES (?, ?, ?)', [workspace.tableId, name, type]);
    }
    const row = { name: '00042', amount: 12.5, enabled: false, day: '2026-10-08', moment: '2026-10-08T12:34:56' };
    const result = await send({ importId: randomUUID(), rows: [row] });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const saved = await dbGet('SELECT data FROM table_rows WHERE table_id = ? ORDER BY id DESC LIMIT 1', [workspace.tableId]);
    expect(typeof saved.data === 'string' ? JSON.parse(saved.data) : saved.data).toEqual(row);
  });
});
