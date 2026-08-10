/**
 * Columns API Routes Tests (v3)
 * Testing REST API endpoints for table columns
 * ADR-019: API Routes Refactoring
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import columnsRoutes from '../columns.js';
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

app.use('/api/v3', columnsRoutes);

// Helper functions
async function createTestUser() {
  const uniqueEmail = `test-columns-${Date.now()}@hltrn.cc`;
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

describe('Columns API Routes (v3)', () => {
  let userId, spaceId, projectId, tableId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    
    userId = await createTestUser();
    mockUserId = userId;
    spaceId = await createTestSpace(userId);
    projectId = await createTestProject(userId, spaceId);
    tableId = await createTestTable(projectId);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // GET /api/v3/tables/:tableId/columns
  // ============================================================
  describe('GET /api/v3/tables/:tableId/columns', () => {
    test('should return empty array for table with no columns', async () => {
      const response = await request(app)
        .get(`/api/v3/tables/${tableId}/columns`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    test('should return all columns for table ordered by order_index', async () => {
      await createTestColumn(tableId, 'email', 'Email', 'text', 1);
      await createTestColumn(tableId, 'name', 'Name', 'text', 0);

      const response = await request(app)
        .get(`/api/v3/tables/${tableId}/columns`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].name).toBe('name');
      expect(response.body.data[1].name).toBe('email');
    });

    test('should return 404 for non-existent table', async () => {
      const response = await request(app)
        .get('/api/v3/tables/99999/columns')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ============================================================
  // POST /api/v3/tables/:tableId/columns
  // ============================================================
  describe('POST /api/v3/tables/:tableId/columns', () => {
    test('should create column with valid data', async () => {
      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/columns`)
        .send({
          name: 'email',
          display_name: 'Email Address',
          column_type: 'text',
          is_required: true
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.name).toBe('email');
      expect(response.body.data.display_name).toBe('Email Address');
      expect(response.body.data.column_type).toBe('text');
      expect(response.body.data.is_required).toBeTruthy();
    });

    test('should reject missing required fields', async () => {
      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/columns`)
        .send({
          name: 'email'
          // missing display_name and column_type
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should reject invalid column type', async () => {
      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/columns`)
        .send({
          name: 'test',
          display_name: 'Test',
          column_type: 'invalid_type'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should reject duplicate column name', async () => {
      await createTestColumn(tableId, 'email', 'Email');
      
      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/columns`)
        .send({
          name: 'email',
          display_name: 'Another Email',
          column_type: 'text'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should return 404 for non-existent table', async () => {
      const response = await request(app)
        .post('/api/v3/tables/99999/columns')
        .send({
          name: 'email',
          display_name: 'Email',
          column_type: 'text'
        })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ============================================================
  // GET /api/v3/tables/:tableId/columns/:columnId
  // ============================================================
  describe('GET /api/v3/tables/:tableId/columns/:columnId', () => {
    test('should return single column by id', async () => {
      const columnId = await createTestColumn(tableId, 'email', 'Email', 'text');

      const response = await request(app)
        .get(`/api/v3/tables/${tableId}/columns/${columnId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(columnId);
      expect(response.body.data.name).toBe('email');
    });

    test('should return 404 for non-existent column', async () => {
      const response = await request(app)
        .get(`/api/v3/tables/${tableId}/columns/99999`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ============================================================
  // PATCH /api/v3/tables/:tableId/columns/:columnId
  // ============================================================
  describe('PATCH /api/v3/tables/:tableId/columns/:columnId', () => {
    test('should update column display_name', async () => {
      const columnId = await createTestColumn(tableId, 'email', 'Email', 'text');

      const response = await request(app)
        .patch(`/api/v3/tables/${tableId}/columns/${columnId}`)
        .send({ display_name: 'Email Address' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.display_name).toBe('Email Address');
    });

    test('should update column config', async () => {
      const columnId = await createTestColumn(tableId, 'status', 'Status', 'select');

      const response = await request(app)
        .patch(`/api/v3/tables/${tableId}/columns/${columnId}`)
        .send({ 
          config: { 
            options: [
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' }
            ]
          }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.config.options).toHaveLength(2);
    });

    test('should return 400 for empty update', async () => {
      const columnId = await createTestColumn(tableId, 'email', 'Email', 'text');

      const response = await request(app)
        .patch(`/api/v3/tables/${tableId}/columns/${columnId}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should return 404 for non-existent column', async () => {
      const response = await request(app)
        .patch(`/api/v3/tables/${tableId}/columns/99999`)
        .send({ display_name: 'New Name' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ============================================================
  // DELETE /api/v3/tables/:tableId/columns/:columnId
  // ============================================================
  describe('DELETE /api/v3/tables/:tableId/columns/:columnId', () => {
    test('should delete column', async () => {
      const columnId = await createTestColumn(tableId, 'email', 'Email', 'text');

      const response = await request(app)
        .delete(`/api/v3/tables/${tableId}/columns/${columnId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain('deleted');

      // Verify column is deleted
      const column = await dbGet('SELECT id FROM table_columns WHERE id = ?', [columnId]);
      expect(column).toBeNull();
    });

    test('should return 404 for non-existent column', async () => {
      const response = await request(app)
        .delete(`/api/v3/tables/${tableId}/columns/99999`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    // System columns protection (id, created_at, updated_at should not be deletable)
    test('should not delete system columns by name', async () => {
      // Create a column marked as system (is_locked = 1)
      const result = await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, config, is_required, order_index, is_visible, is_locked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tableId, 'id', 'ID', 'number', '{}', 1, 0, 1, 1]
      );
      const columnId = result.lastInsertRowid;

      const response = await request(app)
        .delete(`/api/v3/tables/${tableId}/columns/${columnId}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ============================================================
  // POST /api/v3/tables/:tableId/columns/reorder
  // ============================================================
  describe('POST /api/v3/tables/:tableId/columns/reorder', () => {
    test('should reorder columns', async () => {
      const col1 = await createTestColumn(tableId, 'first', 'First', 'text', 0);
      const col2 = await createTestColumn(tableId, 'second', 'Second', 'text', 1);
      const col3 = await createTestColumn(tableId, 'third', 'Third', 'text', 2);

      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/columns/reorder`)
        .send({
          order: [col3, col1, col2] // Reorder: third, first, second
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify order
      const columns = await dbAll(
        'SELECT id FROM table_columns WHERE table_id = ? ORDER BY order_index',
        [tableId]
      );
      expect(columns[0].id).toBe(col3);
      expect(columns[1].id).toBe(col1);
      expect(columns[2].id).toBe(col2);
    });

    test('should reject invalid order array', async () => {
      const response = await request(app)
        .post(`/api/v3/tables/${tableId}/columns/reorder`)
        .send({ order: 'invalid' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });
  });
});
