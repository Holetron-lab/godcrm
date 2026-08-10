/**
 * Rows API Routes Tests (v3)
 * Testing REST API endpoints for table rows
 * ADR-019: API Routes Refactoring
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import rowsRoutes from '../rows.js';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
// Create test app
const app = express();
app.use(express.json());

// Mock authenticate middleware
let mockUserId = 1;
app.use((req, res, next) => {
  req.user = { id: mockUserId, role: 'owner' };
  next();
});

app.use('/api/v3', rowsRoutes);

// Helper functions
async function createTestUser() {
  const uniqueEmail = `test-rows-${Date.now()}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)',
    [uniqueEmail, 'hash', 'Test User', 'encrypted_key', 1]
  );
  return result.lastInsertRowid;
}

async function createTestSpace(ownerId) {
  const result = await dbRun(
    'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
    [ownerId, 'Test Space', 'business']
  );
  return result.lastInsertRowid;
}

async function createTestProject(ownerId, spaceId) {
  const result = await dbRun(
    'INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, ?, ?)',
    [ownerId, spaceId, 'Test Project', 'business']
  );
  return result.lastInsertRowid;
}

async function createTestTable(projectId, name = 'Test Table') {
  const result = await dbRun(
    'INSERT INTO universal_tables (project_id, name, description) VALUES (?, ?, ?)',
    [projectId, name.toLowerCase().replace(/\s+/g, '_'), name]
  );
  return result.lastInsertRowid;
}

async function createTestColumn(tableId, name, displayName, type = 'text', orderIndex = 0) {
  const result = await dbRun(
    `INSERT INTO table_columns (table_id, column_name, display_name, type, config, is_required, order_index, is_visible)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tableId, name, displayName, type, '{}', 0, orderIndex, 1]
  );
  return result.lastInsertRowid;
}

async function createTestRow(tableId, data, createdBy = 1) {
  const baseId = `row_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const result = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_by)
     VALUES (?, ?, ?, ?)`,
    [tableId, baseId, JSON.stringify(data), createdBy]
  );
  return result.lastInsertRowid;
}

describe('Rows API Routes (v3)', () => {
  let userId, spaceId, projectId, tableId, col1Id, col2Id;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    
    userId = await createTestUser();
    mockUserId = userId;
    spaceId = await createTestSpace(userId);
    projectId = await createTestProject(userId, spaceId);
    tableId = await createTestTable(projectId);
    
    // Create two columns for testing
    col1Id = await createTestColumn(tableId, 'name', 'Name', 'text', 0);
    col2Id = await createTestColumn(tableId, 'email', 'Email', 'text', 1);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // POST /api/v3/tables/:tableId/rows/import
  // ============================================================
  describe('POST /api/v3/tables/:tableId/rows/import', () => {
    test('should import rows in add mode', async () => {
      const rows = [
        { [col1Id]: 'John Doe', [col2Id]: 'john@test.com' },
        { [col1Id]: 'Jane Doe', [col2Id]: 'jane@test.com' }
      ];

      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/rows/import`)
        .send({ rows, mode: 'add' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.stats.added).toBe(2);
      expect(response.body.data.stats.updated).toBe(0);
    });

    test('should import rows with update mode', async () => {
      // First, add a row
      const rowId = await createTestRow(tableId, { [col1Id]: 'John', [col2Id]: 'john@old.com' });
      
      const rows = [
        { [col1Id]: 'John', [col2Id]: 'john@new.com' }
      ];

      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/rows/import`)
        .send({ 
          rows, 
          mode: 'update',
          idMapping: { csvColumn: col1Id, tableColumn: col1Id },
          addNewIds: false
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.stats.updated).toBe(1);
    });

    test('should reject empty rows array', async () => {
      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/rows/import`)
        .send({ rows: [], mode: 'add' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should reject missing rows', async () => {
      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/rows/import`)
        .send({ mode: 'add' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should return 404 for non-existent table', async () => {
      const response = await request(app)
        .post('/api/v3/tables/99999/rows/import')
        .send({ rows: [{ name: 'Test' }], mode: 'add' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ============================================================
  // POST /api/v3/tables/:tableId/rows/batch-update
  // ============================================================
  describe('POST /api/v3/tables/:tableId/rows/batch-update', () => {
    test('should batch update multiple rows', async () => {
      const row1Id = await createTestRow(tableId, { [col1Id]: 'John', [col2Id]: 'john@test.com' });
      const row2Id = await createTestRow(tableId, { [col1Id]: 'Jane', [col2Id]: 'jane@test.com' });

      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/rows/batch-update`)
        .send({
          rows: [
            { id: row1Id, data: { [col1Id]: 'John Updated' } },
            { id: row2Id, data: { [col1Id]: 'Jane Updated' } }
          ]
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.updated).toBe(2);

      // Verify updates
      const updated1 = await dbGet('SELECT data FROM table_rows WHERE id = ?', [row1Id]);
      const data = typeof updated1.data === 'string' ? JSON.parse(updated1.data) : updated1.data;
      expect(data[col1Id]).toBe('John Updated');
    });

    test('should reject empty rows array', async () => {
      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/rows/batch-update`)
        .send({ rows: [] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ============================================================
  // POST /api/v3/tables/:tableId/rows/batch-delete
  // ============================================================
  describe('POST /api/v3/tables/:tableId/rows/batch-delete', () => {
    test('should batch delete multiple rows', async () => {
      const row1Id = await createTestRow(tableId, { [col1Id]: 'John' });
      const row2Id = await createTestRow(tableId, { [col1Id]: 'Jane' });
      const row3Id = await createTestRow(tableId, { [col1Id]: 'Bob' });

      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/rows/batch-delete`)
        .send({ ids: [row1Id, row2Id] })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(2);

      // Verify row3 still exists
      const remaining = await dbGet('SELECT id FROM table_rows WHERE id = ?', [row3Id]);
      expect(remaining).toBeDefined();
      expect(remaining.id).toBe(row3Id);
    });

    test('should reject empty ids array', async () => {
      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/rows/batch-delete`)
        .send({ ids: [] })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });
  });
});
