// Regression: a role edit must replace the old numeric/name alias, including
// demotions. Exercise the real writers, DB readback and the space ACL reader.
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbGet, dbRun } from '../../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';
import { generateBaseId } from '../../../../utils/baseId.js';
import { checkUserAccessViaTableV2 } from '../../../../services/space/access.js';
import { dataToolHandlers } from '../../../../services/agent-tools/data-tools.js';
import tablesRouter from '../index.js';

let ws, roleId, activeId, rowId;
const app = express();
app.use(express.json());
app.use('/api/v3', (req, _res, next) => {
  req.user = { id: ws.userId, email: ws.email, role: 'user' };
  next();
}, tablesRouter);

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  ws = await createEphemeralWorkspace({ label: 'role-aliases' });
  for (const [name, type] of [['role', 'select'], ['active', 'checkbox'], ['system_user_id', 'number'], ['note', 'text']]) {
    const config = name === 'role' ? { options: ['owner', 'admin', 'editor', 'viewer', 'denied'] } : {};
    const col = await dbRun('INSERT INTO table_columns (table_id, column_name, display_name, type, config) VALUES (?, ?, ?, ?, ?)',
      [ws.tableId, name, name, type, JSON.stringify(config)]);
    if (name === 'role') roleId = col.lastInsertRowid;
    if (name === 'active') activeId = col.lastInsertRowid;
  }
});
beforeEach(async () => {
  await dbRun('DELETE FROM table_rows WHERE table_id = ?', [ws.tableId]);
});
afterAll(async () => {
  if (!ws) return;
  await dbRun('DELETE FROM table_rows WHERE table_id = ?', [ws.tableId]);
  await dbRun('DELETE FROM table_columns WHERE table_id = ?', [ws.tableId]);
  await ws.cleanup();
  expect(await dbGet('SELECT id FROM users WHERE id = ?', [ws.userId])).toBeNull();
});

async function seed(data) {
  const row = await dbRun('INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
    [ws.tableId, generateBaseId(), JSON.stringify({ system_user_id: ws.userId, active: true, note: 'keep', ...data }), ws.userId]);
  rowId = row.lastInsertRowid;
}
async function readback() {
  const res = await request(app).get(`/api/v3/tables/${ws.tableId}/rows/${rowId}`);
  expect(res.status).toBe(200);
  return res.body.data.row.data;
}
const access = () => checkUserAccessViaTableV2(ws.userId, {
  users_table_id: ws.tableId, role_column_id: String(roleId),
  role_mappings: ['admin', 'viewer'].map(role => ({ columnValue: role, accessLevel: role })),
});

describe.each(['REST', 'REST batch', 'MCP', 'MCP batch'])('%s role updates', (writer) => {
  async function write(data) {
    if (writer === 'REST') {
      const res = await request(app).put(`/api/v3/tables/${ws.tableId}/rows/${rowId}`).send({ data });
      expect(res.status).toBe(200);
    } else if (writer === 'REST batch') {
      const res = await request(app).post(`/api/v3/tables/${ws.tableId}/rows/batch-update`).send({ updates: [{ rowId, data }] });
      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(1);
      expect(res.body.data.errors).toBeUndefined();
    } else if (writer === 'MCP') {
      const res = await dataToolHandlers.update_table_row({ table_id: ws.tableId, row_id: rowId, data, response: 'full' }, ws.userId);
      expect(res.success).toBe(true);
      expect(res.data).toMatchObject(data);
    } else {
      const res = await dataToolHandlers.batch_update_rows({ table_id: ws.tableId, updates: [{ row_id: rowId, data }] }, ws.userId);
      expect(res.failed).toEqual([]);
      expect(res.success).toEqual([rowId]);
    }
  }

  it.each([
    ['viewer', 'admin', 'name'], ['admin', 'viewer', 'name'],
    ['viewer', 'admin', 'id'], ['admin', 'viewer', 'id'],
  ])('%s → %s, patch by %s', async (oldRole, newRole, key) => {
    await seed({ [roleId]: oldRole, role: oldRole });
    await write({ [key === 'name' ? 'role' : roleId]: newRole });
    const data = await readback();
    expect(data.note).toBe('keep');
    expect([data.role, data[roleId]].filter(v => v !== undefined)).toEqual([newRole]);
    expect(await access()).toEqual({ allowed: true, accessLevel: newRole });
  });

  it('does not resolve an untouched role conflict during an unrelated edit', async () => {
    await seed({ [roleId]: 'viewer', role: 'admin' });
    await write({ note: 'edited' });
    expect(await readback()).toMatchObject({ [roleId]: 'viewer', role: 'admin', note: 'edited' });
    expect(await access()).toEqual({ allowed: true, accessLevel: 'viewer' });
  });

  it('clears a role without reviving its old alias', async () => {
    await seed({ [roleId]: 'admin', role: 'admin' });
    await write({ role: null });
    expect(await readback()).not.toHaveProperty(String(roleId));
    expect(await access()).toEqual({ allowed: false, accessLevel: null });
  });

  it('disables membership even when an old active alias is true', async () => {
    await seed({ role: 'admin', [activeId]: true });
    await write({ active: false });
    expect(await readback()).not.toHaveProperty(String(activeId));
    expect(await access()).toEqual({ allowed: false, accessLevel: 'denied' });
  });
});
