// Bug 1552/229245 — Fleet Audit WP-5 BE: server-side space-membership gate on
// the tables write API.
//
// Before: POST/PUT/DELETE /tables/:id/rows, the batch variants, POST /tables and
// PATCH /tables/:id ran `checkTableAccess` only for project-restricted API keys.
// Any authenticated user — including a global `viewer` with no row in the space's
// users table and no user_access_permissions grant — could create, edit and
// delete rows in a stranger's `internal` space (QA sweep, devcrm 2026-09-10).
//
// Policy (ADR-203 D3 default): the global role never gates space tools. Writes
// need a space role of editor or above, resolved the two ways the tables API
// already knows — legacy spaces.access_control and user_access_permissions —
// with space/project ownership winning. Global admin/owner bypass matches the
// existing DELETE /tables/:id gate.
//
// DB-backed (godcrm_test, ADR-0009) — the gate is a real query chain over
// spaces/projects/user_access_permissions and mocking it would test the mock.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbRun, dbGet } from '../../../../database/connection.js';
import { generateBaseId } from '../../../../utils/baseId.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';
import tablesRouter from '../index.js';

let currentUser = null;
const app = express();
app.use(express.json());
app.use('/api/v3', (req, _res, next) => { req.user = currentUser; next(); }, tablesRouter);
const as = (user) => { currentUser = user; return request(app); };

// Both fixture users get global role `viewer` on the JWT — the whole point is
// that the global role must not decide anything here.
const viewer = (ws) => ({ id: ws.userId, email: ws.email, role: 'viewer' });

let owner;     // owns the space + project + table
let stranger;  // no relation to owner's space at all
const extraTableIds = [];

async function seedRow() {
  const r = await dbRun(
    'INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
    [owner.tableId, generateBaseId(), JSON.stringify({ title: 'seed' }), owner.userId]
  );
  return r.lastInsertRowid;
}

const rowExists = async (id) => !!(await dbGet('SELECT id FROM table_rows WHERE id = ?', [id]));

beforeAll(async () => {
  owner = await createEphemeralWorkspace({ label: 'wp5-owner', dashboard: false });
  stranger = await createEphemeralWorkspace({ label: 'wp5-stranger', dashboard: false, table: false });
  await dbRun('INSERT INTO table_columns (table_id, column_name, type) VALUES (?, ?, ?)', [owner.tableId, 'title', 'text']);
});

afterAll(async () => {
  for (const id of extraTableIds) {
    await dbRun('DELETE FROM table_columns WHERE table_id = ?', [id]);
    await dbRun('DELETE FROM universal_tables WHERE id = ?', [id]);
  }
  await dbRun('DELETE FROM user_access_permissions WHERE user_id = ?', [stranger.userId]);
  await dbRun('DELETE FROM table_columns WHERE table_id = ?', [owner.tableId]);
  await stranger.cleanup();
  await owner.cleanup();
});

describe('global viewer with NO membership in the space → 403 on every write', () => {
  it('POST /tables/:id/rows', async () => {
    const res = await as(viewer(stranger)).post(`/api/v3/tables/${owner.tableId}/rows`).send({ data: { title: 'probe' } });
    expect(res.status).toBe(403);
    const leaked = await dbGet("SELECT id FROM table_rows WHERE table_id = ? AND data->>'title' = 'probe'", [owner.tableId]);
    expect(leaked).toBeFalsy();
  });

  it('PUT /tables/:id/rows/:rowId leaves the row untouched', async () => {
    const rowId = await seedRow();
    const res = await as(viewer(stranger)).put(`/api/v3/tables/${owner.tableId}/rows/${rowId}`).send({ data: { title: 'hijacked' } });
    expect(res.status).toBe(403);
    const row = await dbGet('SELECT data FROM table_rows WHERE id = ?', [rowId]);
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    expect(data.title).toBe('seed');
  });

  it('DELETE /tables/:id/rows/:rowId keeps the row', async () => {
    const rowId = await seedRow();
    const res = await as(viewer(stranger)).delete(`/api/v3/tables/${owner.tableId}/rows/${rowId}`);
    expect(res.status).toBe(403);
    expect(await rowExists(rowId)).toBe(true);
  });

  it('POST batch-update / batch-delete', async () => {
    const rowId = await seedRow();
    const upd = await as(viewer(stranger)).post(`/api/v3/tables/${owner.tableId}/rows/batch-update`).send({ updates: [{ id: rowId, data: { title: 'x' } }] });
    expect(upd.status).toBe(403);
    const del = await as(viewer(stranger)).post(`/api/v3/tables/${owner.tableId}/rows/batch-delete`).send({ rowIds: [rowId] });
    expect(del.status).toBe(403);
    expect(await rowExists(rowId)).toBe(true);
  });

  it('POST /tables into the foreign project', async () => {
    const res = await as(viewer(stranger)).post('/api/v3/tables').send({ project_id: owner.projectId, name: 'wp5_probe_table' });
    expect(res.status).toBe(403);
    const leaked = await dbGet('SELECT id FROM universal_tables WHERE project_id = ? AND name = ?', [owner.projectId, 'wp5_probe_table']);
    if (leaked) extraTableIds.push(leaked.id);
    expect(leaked).toBeFalsy();
  });

  it('PATCH /tables/:id', async () => {
    const res = await as(viewer(stranger)).patch(`/api/v3/tables/${owner.tableId}`).send({ name: 'renamed-by-stranger' });
    expect(res.status).toBe(403);
    const t = await dbGet('SELECT name FROM universal_tables WHERE id = ?', [owner.tableId]);
    expect(t.name).not.toBe('renamed-by-stranger');
  });
});

describe('global viewer who OWNS the space keeps every owner tool (D3)', () => {
  it('POST → PUT → DELETE row', async () => {
    const post = await as(viewer(owner)).post(`/api/v3/tables/${owner.tableId}/rows`).send({ data: { title: 'mine' } });
    expect(post.status).toBe(201);
    const rowId = post.body?.data?.id ?? post.body?.data?.row?.id ?? post.body?.id;
    expect(rowId).toBeTruthy();

    const put = await as(viewer(owner)).put(`/api/v3/tables/${owner.tableId}/rows/${rowId}`).send({ data: { title: 'mine-edited' } });
    expect(put.status).toBe(200);

    const del = await as(viewer(owner)).delete(`/api/v3/tables/${owner.tableId}/rows/${rowId}`);
    expect(del.status).toBe(200);
    expect(await rowExists(rowId)).toBe(false);
  });

  it('POST /tables and PATCH /tables/:id', async () => {
    const post = await as(viewer(owner)).post('/api/v3/tables').send({ project_id: owner.projectId, name: 'wp5_owner_table' });
    expect(post.status).toBe(200); // POST /tables answers 200, not 201 (pre-existing)
    const created = await dbGet('SELECT id FROM universal_tables WHERE project_id = ? AND name = ?', [owner.projectId, 'wp5_owner_table']);
    expect(created).toBeTruthy();
    extraTableIds.push(created.id);

    const patch = await as(viewer(owner)).patch(`/api/v3/tables/${created.id}`).send({ name: 'wp5_owner_table-2' });
    expect(patch.status).toBe(200);
  });
});

describe('membership via user_access_permissions', () => {
  it('editor grant at space level opens writes; viewer grant does not', async () => {
    await dbRun(
      'INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by) VALUES (?, ?, ?, ?)',
      [stranger.userId, owner.spaceId, 'editor', owner.userId]
    );
    const asEditor = await as(viewer(stranger)).post(`/api/v3/tables/${owner.tableId}/rows`).send({ data: { title: 'by-editor' } });
    expect(asEditor.status).toBe(201);

    await dbRun('UPDATE user_access_permissions SET access_level = ? WHERE user_id = ? AND space_id = ?', ['viewer', stranger.userId, owner.spaceId]);
    const asViewer = await as(viewer(stranger)).post(`/api/v3/tables/${owner.tableId}/rows`).send({ data: { title: 'by-space-viewer' } });
    expect(asViewer.status).toBe(403);

    await dbRun('DELETE FROM user_access_permissions WHERE user_id = ? AND space_id = ?', [stranger.userId, owner.spaceId]);
  });
});

describe('membership via legacy spaces.access_control (UserAccessPanel users table)', () => {
  // Mirrors Space 11 on master A: rows keyed by column *id*, role mapped through role_mappings.
  let usersTableId, userIdColId, roleColId, memberRowId;

  beforeAll(async () => {
    const t = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [owner.projectId, 'wp5-space-users']);
    usersTableId = t.lastInsertRowid;
    extraTableIds.push(usersTableId);
    userIdColId = (await dbRun('INSERT INTO table_columns (table_id, column_name, type) VALUES (?, ?, ?)', [usersTableId, 'system_user_id', 'number'])).lastInsertRowid;
    roleColId = (await dbRun('INSERT INTO table_columns (table_id, column_name, type) VALUES (?, ?, ?)', [usersTableId, 'role', 'select'])).lastInsertRowid;
    memberRowId = (await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
      [usersTableId, generateBaseId(), JSON.stringify({ [userIdColId]: stranger.userId, [roleColId]: 'admin' })]
    )).lastInsertRowid;
    await dbRun('UPDATE spaces SET access_control = ? WHERE id = ?', [JSON.stringify({
      enabled: true,
      users_table_id: usersTableId,
      role_column_id: String(roleColId),
      role_mappings: [
        { columnValue: 'admin', accessLevel: 'admin' },
        { columnValue: 'viewer', accessLevel: 'viewer' }
      ]
    }), owner.spaceId]);
  });

  afterAll(async () => {
    await dbRun('UPDATE spaces SET access_control = NULL WHERE id = ?', [owner.spaceId]);
    await dbRun('DELETE FROM table_rows WHERE table_id = ?', [usersTableId]);
  });

  it('row keyed by column id with mapped role admin → writes; viewer → 403', async () => {
    const asAdmin = await as(viewer(stranger)).post(`/api/v3/tables/${owner.tableId}/rows`).send({ data: { title: 'by-legacy-admin' } });
    expect(asAdmin.status).toBe(201);

    await dbRun('UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify({ [userIdColId]: stranger.userId, [roleColId]: 'viewer' }), memberRowId]);
    const asViewer = await as(viewer(stranger)).post(`/api/v3/tables/${owner.tableId}/rows`).send({ data: { title: 'by-legacy-viewer' } });
    expect(asViewer.status).toBe(403);
  });
});

describe('global admin bypass (unchanged convention, same as DELETE /tables/:id)', () => {
  it('admin with no membership still writes', async () => {
    const res = await as({ id: stranger.userId, email: stranger.email, role: 'admin' })
      .post(`/api/v3/tables/${owner.tableId}/rows`).send({ data: { title: 'by-admin' } });
    expect(res.status).toBe(201);
  });
});
