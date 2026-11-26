import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace, fixtureToken } from '../../../tests/helpers/workspace-fixture.js';
import { generateBaseId } from '../../../utils/baseId.js';
import router from '../module-install.js';

let ws;
let currentUserId;
let extraUserId;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: currentUserId }; next(); });
app.use('/modules', router);

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'module-export-route', table: false });
  currentUserId = ws.userId;
  extraUserId = null;
  const table = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'items']);
  ws.tableId = table.lastInsertRowid;
  await dbRun(
    "INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'name', 'Name', 'text', 1, 1)",
    [ws.tableId],
  );
});

afterEach(async () => {
  await dbRun('DELETE FROM user_access_permissions WHERE user_id = ?', [extraUserId]);
  if (extraUserId) await dbRun('DELETE FROM users WHERE id = ?', [extraUserId]);
  await dbRun('DELETE FROM table_rows WHERE table_id = ?', [ws.tableId]);
  await dbRun('DELETE FROM table_columns WHERE table_id = ?', [ws.tableId]);
  await ws.cleanup();
});

afterAll(destroyAdapter);

describe('ADR-207 W5 export routes', () => {
  it('exports project and space blueprints for the space owner with explicit seed selection', async () => {
    await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [ws.tableId, generateBaseId(), JSON.stringify({ name: 'Seed item' })]);

    const project = await request(app).post('/modules/export/project').send({
      project_id: ws.projectId,
      key: 'route_project_export',
    });
    expect(project.status).toBe(200);
    expect(project.body.data.blueprint).toMatchObject({
      key: 'route_project_export', schema: 2, seed: [],
      projects: [{ key: 'main' }],
      tables: [{ key: 'items', project: 'main', name: 'items' }],
    });

    const space = await request(app).post('/modules/export/space').send({
      space_id: ws.spaceId,
      key: 'route_space_export',
      seed_table_ids: [ws.tableId],
    });
    expect(space.status).toBe(200);
    expect(space.body.data.blueprint.seed).toEqual([{ table: 'items', key: ['name'], rows: [{ name: 'Seed item' }] }]);
  });

  it('rejects a member and malformed input without exporting data', async () => {
    const token = fixtureToken();
    const user = await dbRun(
      `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified)
       VALUES (?, 'hash', ?, 'key', 1)`,
      [`module-export-member-${token}@test.godcrm.local`, `Member ${token}`],
    );
    extraUserId = user.lastInsertRowid;
    await dbRun(
      "INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by) VALUES (?, ?, 'editor', ?)",
      [extraUserId, ws.spaceId, ws.userId],
    );

    currentUserId = extraUserId;
    const denied = await request(app).post('/modules/export/space').send({ space_id: ws.spaceId });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain('Seed item');

    currentUserId = ws.userId;
    const malformed = await request(app).post('/modules/export/project').send({
      project_id: ws.projectId,
      include_seed: true,
    });
    expect(malformed.status).toBe(400);
    const missing = await request(app).post('/modules/export/project').send({ project_id: 2147483647 });
    expect(missing.status).toBe(404);
  });
});
