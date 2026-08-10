// API v3: POST /tables — table_type persistence (SC-SIM kit discoverability)
//
// Bug: the generic create-table endpoint silently dropped `table_type`, so
// module-kit tables (e.g. SC-SIM `sim_runs`) were born with table_type=NULL and
// could not be discovered per-project — the editor fell back to a hard-coded
// global table id. Fix: accept `table_type`/`tableType` on create and surface it
// on the list endpoint so a project's own runs table is discoverable by type.
import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbRun, resetAdapter } from '../../database/connection.js';
import tablesRouter from '../../routes/v3/tables.js';

const mockAuthMiddleware = (req, res, next) => {
  req.user = { id: 1, email: 'test@example.com', role: 'admin' };
  next();
};

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v3', mockAuthMiddleware, tablesRouter);
  return app;
}

describe('API v3: POST /tables — table_type persistence', () => {
  let app;
  let testProjectId;
  const createdTableIds = [];

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await resetAdapter();
    const projectResult = await dbRun(
      `INSERT INTO projects (name, description, type, owner_id, created_at, updated_at)
       VALUES ($1, 'Test', 'default', 1, NOW(), NOW())`,
      ['Sim Kit Test Project']
    );
    testProjectId = projectResult.lastInsertRowid;
  });

  afterEach(async () => {
    for (const id of createdTableIds) {
      await dbRun('DELETE FROM table_columns WHERE table_id = $1', [id]);
      await dbRun('DELETE FROM universal_tables WHERE id = $1', [id]);
    }
    createdTableIds.length = 0;
    if (testProjectId) await dbRun('DELETE FROM projects WHERE id = $1', [testProjectId]);
  });

  test('persists snake_case table_type on create and returns it on list', async () => {
    const create = await request(app)
      .post('/api/v3/tables')
      .send({ name: 'sim_runs', project_id: testProjectId, table_type: 'sim_runs', columns: [] });
    expect(create.status).toBe(200);
    const tableId = create.body?.data?.table?.id;
    expect(tableId).toBeTruthy();
    createdTableIds.push(tableId);

    const list = await request(app).get(`/api/v3/tables?project_id=${testProjectId}`);
    expect(list.status).toBe(200);
    const row = (list.body?.data || []).find((t) => t.id === tableId);
    expect(row).toBeTruthy();
    expect(row.table_type).toBe('sim_runs');
  });

  test('accepts the camelCase `tableType` the widget presets declare', async () => {
    const create = await request(app)
      .post('/api/v3/tables')
      .send({ name: 'sim_schemes', project_id: testProjectId, tableType: 'sim_schemes', columns: [] });
    expect(create.status).toBe(200);
    const tableId = create.body?.data?.table?.id;
    createdTableIds.push(tableId);

    const list = await request(app).get(`/api/v3/tables?project_id=${testProjectId}`);
    const row = (list.body?.data || []).find((t) => t.id === tableId);
    expect(row?.table_type).toBe('sim_schemes');
  });

  test('omitting table_type stays NULL (legacy behaviour preserved)', async () => {
    const create = await request(app)
      .post('/api/v3/tables')
      .send({ name: 'plain_table', project_id: testProjectId, columns: [] });
    expect(create.status).toBe(200);
    const tableId = create.body?.data?.table?.id;
    createdTableIds.push(tableId);

    const list = await request(app).get(`/api/v3/tables?project_id=${testProjectId}`);
    const row = (list.body?.data || []).find((t) => t.id === tableId);
    expect(row?.table_type ?? null).toBeNull();
  });
});
