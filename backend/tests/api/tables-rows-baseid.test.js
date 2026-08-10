// API v3: Table Rows - Update by base_id Tests
// Bug fix: Support updating rows by base_id (string) not just numeric id
import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../../database/connection.js';
import tablesRouter from '../../routes/v3/tables.js';
import { generateBaseId } from '../../utils/baseId.js';

// Mock auth middleware for tests
const mockAuthMiddleware = (req, res, next) => {
  req.user = { id: 1, email: 'test@example.com', role: 'admin' };
  next();
};

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v3', mockAuthMiddleware, tablesRouter);
  return app;
}

// Minimal database setup for this test
async function setupMinimalTestDb() {
  await resetAdapter();
  // Tables already exist in PostgreSQL - no need to CREATE
}

describe('API v3: PUT /tables/:tableId/rows/:rowId - base_id support', () => {
  let app;
  let testTableId;
  let testRowId;
  let testBaseId;
  let testColumnId;
  let testProjectId;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await setupMinimalTestDb();

    // Create test project
    const projectResult = await dbRun(`
      INSERT INTO projects (name, description, type, owner_id, created_at, updated_at)
      VALUES ($1, 'Test', 'default', 1, NOW(), NOW())
    `, ['Test Project']);
    testProjectId = projectResult.lastInsertRowid;

    // Create test table
    const tableResult = await dbRun(`
      INSERT INTO universal_tables (project_id, name, display_name, is_system, created_at, updated_at)
      VALUES ($1, 'test_users', 'Test Users', 0, NOW(), NOW())
    `, [testProjectId]);
    testTableId = tableResult.lastInsertRowid;

    // Create test column
    const columnResult = await dbRun(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, created_at, updated_at)
      VALUES ($1, 'role', 'Role', 'text', 0, 1, NOW(), NOW())
    `, [testTableId]);
    testColumnId = columnResult.lastInsertRowid;

    // Create test row with base_id
    testBaseId = generateBaseId();
    const rowResult = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
    `, [testTableId, testBaseId, JSON.stringify({ [testColumnId]: 'viewer' })]);
    testRowId = rowResult.lastInsertRowid;
  });

  afterEach(async () => {
    // Cleanup test data
    if (testTableId) {
      await dbRun('DELETE FROM table_rows WHERE table_id = $1', [testTableId]);
      await dbRun('DELETE FROM table_columns WHERE table_id = $1', [testTableId]);
      await dbRun('DELETE FROM universal_tables WHERE id = $1', [testTableId]);
    }
    if (testProjectId) {
      await dbRun('DELETE FROM projects WHERE id = $1', [testProjectId]);
    }
  });

  test('should update row by numeric id', async () => {
    const res = await request(app)
      .put(`/api/v3/tables/${testTableId}/rows/${testRowId}`)
      .send({ data: { [testColumnId]: 'admin' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify update - route normalizes column_id keys to column names
    const row = await dbGet('SELECT data FROM table_rows WHERE id = $1', [testRowId]);
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    expect(data.role || data[testColumnId]).toBe('admin');
  });

  test('should update row by base_id (string)', async () => {
    const res = await request(app)
      .put(`/api/v3/tables/${testTableId}/rows/${testBaseId}`)
      .send({ data: { [testColumnId]: 'editor' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify update - route normalizes column_id keys to column names
    const row = await dbGet('SELECT data FROM table_rows WHERE base_id = $1', [testBaseId]);
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    expect(data.role || data[testColumnId]).toBe('editor');
  });

  test('should return 404 for non-existent base_id', async () => {
    const res = await request(app)
      .put(`/api/v3/tables/${testTableId}/rows/NONEXIST`)
      .send({ data: { [testColumnId]: 'admin' } });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('should return 404 for non-existent numeric id', async () => {
    const res = await request(app)
      .put(`/api/v3/tables/${testTableId}/rows/999999`)
      .send({ data: { [testColumnId]: 'admin' } });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('should merge data correctly when updating by base_id', async () => {
    // First add another column value
    await dbRun(`
      UPDATE table_rows SET data = $1 WHERE id = $2
    `, [JSON.stringify({ [testColumnId]: 'viewer', name: 'Test User' }), testRowId]);

    // Update only role
    const res = await request(app)
      .put(`/api/v3/tables/${testTableId}/rows/${testBaseId}`)
      .send({ data: { [testColumnId]: 'owner' } });

    expect(res.status).toBe(200);

    // Verify data merge - route normalizes column_id keys to column names
    const row = await dbGet('SELECT data FROM table_rows WHERE base_id = $1', [testBaseId]);
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    expect(data.role || data[testColumnId]).toBe('owner');
    expect(data.name).toBe('Test User'); // Should preserve existing data
  });

  test('should handle user-prefixed base_id format', async () => {
    // Some base_ids have format like user-123456789-abcdef
    const userBaseId = `user-${Date.now()}-test123`;

    await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
    `, [testTableId, userBaseId, JSON.stringify({ [testColumnId]: 'viewer' })]);

    const res = await request(app)
      .put(`/api/v3/tables/${testTableId}/rows/${userBaseId}`)
      .send({ data: { [testColumnId]: 'admin' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify update - route normalizes column_id keys to column names
    const row = await dbGet('SELECT data FROM table_rows WHERE base_id = $1', [userBaseId]);
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    expect(data.role || data[testColumnId]).toBe('admin');
  });
});
