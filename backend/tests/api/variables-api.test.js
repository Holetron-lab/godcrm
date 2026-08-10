// API v3: Variables API Tests (ADR-026)
// Tests for GET/POST /api/v3/spaces/:id/variables
import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../../database/connection.js';
import spacesRouter from '../../routes/v3/spaces.js';
// Mock auth middleware for tests
const mockAuthMiddleware = (req, res, next) => {
  req.user = { id: 1, email: 'test@example.com', role: 'user' };
  next();
};

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v3/spaces', mockAuthMiddleware, spacesRouter);
  return app;
}

describe('API v3: Variables API (ADR-026)', () => {
  let app;
  let testSpaceId;
  let variablesTableId;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    
    // Create test user first (unique email to avoid collision)
    const testEmail = `var-test-${Date.now()}@test.com`;
    const userResult = await dbRun(
      `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)`,
      [testEmail, 'hash', 'Test User', 'encrypted_key', 1]
    );
    const testUserId = userResult.lastInsertRowid;

    // Create test space (correct schema from init-v2.js)
    await dbRun(
      `INSERT INTO spaces (name, owner_id, type) VALUES (?, ?, ?)`,
      ['Test Space Vars', testUserId, 'business']
    );
    const space = await dbGet(`SELECT id FROM spaces WHERE name = 'Test Space Vars' AND owner_id = ?`, [testUserId]);
    testSpaceId = space.id;
    
    // Create system_data project (correct schema - no position column)
    await dbRun(
      `INSERT INTO projects (space_id, name, type, owner_id) VALUES (?, ?, ?, ?)`,
      [testSpaceId, 'System Data', 'system_data', testUserId]
    );
    const project = await dbGet(`SELECT id FROM projects WHERE space_id = ? AND type = 'system_data'`, [testSpaceId]);
    
    // Create Variables table (using universal_tables not workspace_tables)
    await dbRun(
      `INSERT INTO universal_tables (project_id, name, table_type) VALUES (?, ?, ?)`,
      [project.id, 'Variables', 'config']
    );
    const table = await dbGet(`SELECT id FROM universal_tables WHERE project_id = ? AND name = 'Variables'`, [project.id]);
    variablesTableId = table.id;
    
    // Create required columns for Variables table (correct schema from init-v2.js)
    const columns = [
      { column_name: 'name', type: 'text', config: JSON.stringify({ required: true }) },
      { column_name: 'scope_type', type: 'select', config: JSON.stringify({ options: ['space', 'table', 'dashboard'] }) },
      { column_name: 'scope_id', type: 'number', config: JSON.stringify({}) },
      { column_name: 'formula', type: 'textarea', config: JSON.stringify({}) },
      { column_name: 'cached_value', type: 'text', config: JSON.stringify({ readonly: true }) },
      { column_name: 'cached_at', type: 'datetime', config: JSON.stringify({ readonly: true }) },
      { column_name: 'dependencies', type: 'json', config: JSON.stringify({}) }
    ];
    
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      await dbRun(
        `INSERT INTO table_columns (table_id, column_name, type, config, order_index) VALUES (?, ?, ?, ?, ?)`,
        [variablesTableId, col.column_name, col.type, col.config, i]
      );
    }
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  describe('GET /api/v3/spaces/:spaceId/variables', () => {
    test('should return empty list when no variables exist', async () => {
      const res = await request(app).get(`/api/v3/spaces/${testSpaceId}/variables`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.variables).toEqual([]);
      expect(res.body.data.tableId).toBe(variablesTableId);
    });

    test('should return variables from Variables table', async () => {
      // Add a variable row with JSON data (table_rows uses data column)
      const variableData = JSON.stringify({
        name: '$tax_rate',
        formula: '0.20',
        scope_type: 'space'
      });
      
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)`,
        [variablesTableId, 'var_001', variableData]
      );

      const res = await request(app).get(`/api/v3/spaces/${testSpaceId}/variables`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.variables).toHaveLength(1);
      expect(res.body.data.variables[0].name).toBe('$tax_rate');
      expect(res.body.data.variables[0].formula).toBe('0.20');
      expect(res.body.data.variables[0].scope).toBe('space');  // API uses 'scope' not 'scope_type'
    });

    test('should return 404 for non-existent space', async () => {
      const res = await request(app).get('/api/v3/spaces/99999/variables');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v3/spaces/:spaceId/variables/recalculate', () => {
    test('should recalculate all variables', async () => {
      // Add a simple constant variable using JSON data format
      const variableData = JSON.stringify({
        name: '$constant',
        formula: '42'
      });
      
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)`,
        [variablesTableId, 'var_001', variableData]
      );

      const res = await request(app).post(`/api/v3/spaces/${testSpaceId}/variables/recalculate`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.calculated).toBeGreaterThanOrEqual(1);
      expect(res.body.data.errors).toEqual([]);
    });

    test('should return 404 for non-existent space', async () => {
      const res = await request(app).post('/api/v3/spaces/99999/variables/recalculate');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
