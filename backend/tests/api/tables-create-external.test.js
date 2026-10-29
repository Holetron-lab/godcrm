// API v3: POST /tables with data_source_id + external_table_name (ticket 231940, AC#2/#3)
//
// Bug: the controller called `listTableColumns` on the DataSourceService CLASS (not an
// instance), so the import always threw, the error was swallowed and every external table
// was created with zero columns — a false success. Also every MySQL connection was opened
// with `password: ''`. mysql2 is mocked here so the test asserts (a) the decrypted stored
// password reaches the driver, (b) real columns land, (c) a schema failure creates nothing.
import { describe, test, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const createConnection = vi.fn();
vi.mock('mysql2/promise', () => ({ createConnection }));

const { dbRun, dbAll, dbGet, resetAdapter } = await import('../../database/connection.js');
const { encryptCredential } = await import('../../utils/encryption.js');
const tablesRouter = (await import('../../routes/v3/tables.js')).default;

const SECRET = 'fixture-ro-pw';
// Unique per run: godcrm_test is shared, and a baseline run may execute this file concurrently.
const DS_ID = `ds_test_external_231940_${process.pid}`;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v3', (req, _res, next) => { req.user = { id: 1, email: 'test@example.com', role: 'admin' }; next(); }, tablesRouter);
  return app;
}

function fakeConnection(describeImpl) {
  return { execute: vi.fn(describeImpl), query: vi.fn(describeImpl), end: vi.fn(async () => {}) };
}

describe('API v3: POST /tables — external MySQL table', () => {
  let app;
  let projectId;
  const createdTableIds = [];

  beforeAll(async () => {
    await resetAdapter();
    // Migration 094 adds these; the test DB is a copy of master A and may predate it.
    await dbRun('ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS db_password_encrypted TEXT');
    await dbRun('ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS ssh_private_key_encrypted TEXT');
    await dbRun('DELETE FROM data_sources WHERE id = $1', [DS_ID]);
    const project = await dbRun(
      `INSERT INTO projects (name, description, type, owner_id, created_at, updated_at)
       VALUES ('External MySQL Test Project', 'Test', 'default', 1, NOW(), NOW())`
    );
    projectId = project.lastInsertRowid;
    await dbRun(
      `INSERT INTO data_sources (id, workspace_id, created_by, name, type, db_host, db_port, db_name, db_username, db_password_encrypted)
       VALUES ($1, '1', 1, 'fixture', 'local_mysql', '127.0.0.1', 3307, 'shop', 'crm_ro', $2)`,
      [DS_ID, encryptCredential(SECRET)]
    );
    app = createTestApp();
  });

  afterEach(async () => {
    createConnection.mockReset();
    for (const id of createdTableIds) {
      await dbRun('DELETE FROM table_columns WHERE table_id = $1', [id]);
      await dbRun('DELETE FROM universal_tables WHERE id = $1', [id]);
    }
    createdTableIds.length = 0;
  });

  afterAll(async () => {
    await dbRun('DELETE FROM data_sources WHERE id = $1', [DS_ID]);
    if (projectId) await dbRun('DELETE FROM projects WHERE id = $1', [projectId]);
  });

  test('creates the table with the real external columns, connecting with the stored password', async () => {
    createConnection.mockResolvedValue(fakeConnection(async () => [[
      { Field: 'id', Type: 'int unsigned' },
      { Field: 'title', Type: 'varchar(255)' },
      { Field: 'price', Type: 'decimal(10,2)' },
      { Field: 'created_at', Type: 'datetime' },
    ]]));

    const res = await request(app)
      .post('/api/v3/tables')
      .send({ name: 'products_ext', project_id: projectId, data_source_id: DS_ID, external_table_name: 'products' });

    expect(res.status).toBe(200);
    const tableId = res.body?.data?.table?.id;
    expect(tableId).toBeTruthy();
    createdTableIds.push(tableId);

    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(createConnection.mock.calls[0][0]).toMatchObject({ host: '127.0.0.1', port: 3307, user: 'crm_ro', password: SECRET });

    const cols = await dbAll('SELECT column_name, type FROM table_columns WHERE table_id = $1 ORDER BY order_index', [tableId]);
    expect(cols.map(c => c.column_name)).toEqual(['id', 'title', 'price', 'created_at']);
    expect(cols.map(c => c.type)).toEqual(['number', 'text', 'number', 'date']);

    const row = await dbGet('SELECT data_source_id, source_table_name FROM universal_tables WHERE id = $1', [tableId]);
    expect(row).toMatchObject({ data_source_id: DS_ID, source_table_name: 'products' });
  });

  test('GET /rows/:rowId resolves the list-style ext_<table>_<index>_<mysqlId> id to the MySQL primary key', async () => {
    const execute = vi.fn(async (sql, params) => {
      if (/^DESCRIBE/.test(sql)) return [[{ Field: 'id', Type: 'int' }, { Field: 'title', Type: 'varchar(255)' }]];
      if (/^SELECT \* FROM/.test(sql)) return [String(params[0]) === '7' ? [{ id: 7, title: 'seven' }] : []];
      return [[]];
    });
    createConnection.mockResolvedValue({ execute, query: execute, end: vi.fn(async () => {}) });

    const create = await request(app)
      .post('/api/v3/tables')
      .send({ name: 'rows_ext', project_id: projectId, data_source_id: DS_ID, external_table_name: 'products' });
    const tableId = create.body?.data?.table?.id;
    expect(tableId).toBeTruthy();
    createdTableIds.push(tableId);

    const res = await request(app).get(`/api/v3/tables/${tableId}/rows/ext_${tableId}_0_7`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body?.data?.row?.data).toMatchObject({ id: 7, title: 'seven' });
    const selectCall = execute.mock.calls.find(([sql]) => /^SELECT \* FROM/.test(sql));
    expect(selectCall[1]).toEqual(['7']);
  });

  test('schema failure (no such table / bad password) → 502 and NO table is created', async () => {
    createConnection.mockResolvedValue(fakeConnection(async () => {
      throw Object.assign(new Error("Table 'shop.ghost' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
    }));

    const res = await request(app)
      .post('/api/v3/tables')
      .send({ name: 'ghost_ext', project_id: projectId, data_source_id: DS_ID, external_table_name: 'ghost' });

    expect(res.status).toBe(502);
    expect(res.body?.error?.code).toBe('EXTERNAL_SCHEMA_FAILED');
    expect(res.body?.error?.message).toMatch(/doesn't exist/);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);

    const leftover = await dbGet('SELECT COUNT(*)::int AS n FROM universal_tables WHERE project_id = $1 AND name = $2', [projectId, 'ghost_ext']);
    expect(leftover.n).toBe(0);
  });
});
