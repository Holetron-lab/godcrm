// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import router from '../tableCreateController.js';
import { dbGet, dbAll, dbRun } from '../../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';

let workspace;
let user;
const ids = new Set();
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = user; next(); });
app.use('/api/v3', router);
const send = body => request(app).post('/api/v3/tables').send(body);

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  workspace = await createEphemeralWorkspace({ label: 'excel-create-retry', dashboard: false, table: false });
  user = { id: workspace.userId, role: 'viewer' };
});
afterAll(async () => {
  for (const id of ids) {
    await dbRun('DELETE FROM table_columns WHERE table_id = ?', [id]);
    await dbRun('DELETE FROM universal_tables WHERE id = ?', [id]);
  }
  if (workspace) await workspace.cleanup();
});

it('recovers a lost creation response and serializes concurrent retries', async () => {
  const body = { importId: randomUUID(), name: 'excel_retry', projectId: workspace.projectId,
    columns: [{ name: 'name', displayName: 'Имя', type: 'text' }] };
  const replies = await Promise.all([send(body), send(body)]);
  replies.forEach(r => { if (r.body.data?.table?.id) ids.add(r.body.data.table.id); });
  expect(replies.map(r => r.status), JSON.stringify(replies.map(r => r.body))).toEqual([200, 200]);
  expect(replies[0].body.data.table.id).toBe(replies[1].body.data.table.id);
  expect(replies[0].body.data.columns[0].id).toBe(replies[1].body.data.columns[0].id);
  expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [workspace.projectId])).toHaveLength(1);
  const changed = await send({ ...body, name: 'other' });
  if (changed.body.data?.table?.id) ids.add(changed.body.data.table.id);
  expect(changed.status).toBe(409);
});

it('validates importId and rejects restricted project credentials', async () => {
  const body = { importId: 'invalid', name: 'excel_bad', projectId: workspace.projectId };
  const invalid = await send(body);
  if (invalid.body.data?.table?.id) ids.add(invalid.body.data.table.id);
  expect(invalid.status).toBe(400);
  user = { id: workspace.userId, role: 'admin', projectId: workspace.projectId + 1 };
  const denied = await send({ ...body, importId: randomUUID() });
  if (denied.body.data?.table?.id) ids.add(denied.body.data.table.id);
  expect(denied.status).toBe(403);
});
