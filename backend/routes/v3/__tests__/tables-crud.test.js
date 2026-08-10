/**
 * Tables API Routes Tests (v3) - ADR-064 Phase 2, Task 6
 * Testing REST API endpoints for table CRUD operations
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import tablesRoutes from '../tables.js';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
const app = express();
app.use(express.json());

let mockUserId = 1;
app.use((req, _res, next) => {
  req.user = { id: mockUserId, role: 'owner' };
  next();
});

app.use('/api/v3', tablesRoutes);

async function createTestUser() {
  const email = `test-tables-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)',
    [email, 'hash', 'Test User', 'encrypted_key', 1]
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

describe('Tables API Routes (v3) - ADR-064', () => {
  let userId, spaceId, projectId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();

    // Add columns that migrations skip (workspace_tables → universal_tables rename issue)
    const missingCols = [
      'display_name TEXT',
      'data_source_id INTEGER',
      'source_table_name TEXT',
      'source_id_column TEXT',
      'sync_enabled INTEGER DEFAULT 0',
      'sync_interval_minutes INTEGER',
      'last_sync_at TEXT',
      'parent_table_id INTEGER',
      'show_in_nav INTEGER DEFAULT 1',
      'config TEXT'
    ];
    for (const col of missingCols) {
      try {
        await dbRun(`ALTER TABLE universal_tables ADD COLUMN ${col}`);
      } catch {
        // Column may already exist
      }
    }

    userId = await createTestUser();
    mockUserId = userId;
    spaceId = await createTestSpace(userId);
    projectId = await createTestProject(userId, spaceId);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // GET /api/v3/tables
  // ============================================================
  describe('GET /api/v3/tables', () => {
    test('should return all tables for user', async () => {
      await createTestTable(projectId, 'Table A');
      await createTestTable(projectId, 'Table B');

      const res = await request(app)
        .get('/api/v3/tables')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================
  // GET /api/v3/tables/:tableId
  // ============================================================
  describe('GET /api/v3/tables/:tableId', () => {
    test('should return table by id with columns', async () => {
      const tableId = await createTestTable(projectId, 'My Table');

      const res = await request(app)
        .get(`/api/v3/tables/${tableId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(tableId);
    });

    test('should return 404 for non-existent table', async () => {
      const res = await request(app)
        .get('/api/v3/tables/99999')
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================
  // POST /api/v3/tables
  // ============================================================
  describe('POST /api/v3/tables', () => {
    test('should create table with valid data', async () => {
      const res = await request(app)
        .post('/api/v3/tables')
        .send({ project_id: projectId, name: 'new_table' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.table).toBeDefined();
      expect(res.body.data.table.name).toBe('new_table');
    });

    test('should reject missing project_id', async () => {
      const res = await request(app)
        .post('/api/v3/tables')
        .send({ name: 'no_project' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    test('should reject missing name', async () => {
      const res = await request(app)
        .post('/api/v3/tables')
        .send({ project_id: projectId })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================
  // PATCH /api/v3/tables/:tableId (display settings)
  // ============================================================
  describe('PATCH /api/v3/tables/:tableId', () => {
    test('should update table display name', async () => {
      const tableId = await createTestTable(projectId, 'old_display');

      const res = await request(app)
        .patch(`/api/v3/tables/${tableId}`)
        .send({ displayName: 'New Display Name' })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updated = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [tableId]);
      expect(updated.display_name).toBe('New Display Name');
    });
  });

  // ============================================================
  // DELETE /api/v3/tables/:tableId
  // ============================================================
  describe('DELETE /api/v3/tables/:tableId', () => {
    test('should delete table owned by user', async () => {
      const tableId = await createTestTable(projectId, 'delete_me');

      const res = await request(app)
        .delete(`/api/v3/tables/${tableId}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [tableId]);
      expect(table).toBeNull();
    });

    test('should return 404 for non-existent table', async () => {
      const res = await request(app)
        .delete('/api/v3/tables/99999')
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================
  // GET /api/v3/tables/:tableId/rows/:rowId
  // ============================================================
  describe('GET /api/v3/tables/:tableId/rows/:rowId', () => {
    let tableId, col1Id, col2Id;

    beforeEach(async () => {
      tableId = await createTestTable(projectId, 'Row Test Table');
      // Create columns
      const col1 = await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, config, is_required, order_index, is_visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tableId, 'name', 'Name', 'text', '{}', 0, 0, 1]
      );
      col1Id = col1.lastInsertRowid;
      const col2 = await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, config, is_required, order_index, is_visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tableId, 'email', 'Email', 'text', '{}', 0, 1, 1]
      );
      col2Id = col2.lastInsertRowid;
    });

    test('should return a single row by numeric ID', async () => {
      const rowData = { [col1Id]: 'John Doe', [col2Id]: 'john@test.com' };
      const baseId = `row_test_${Date.now()}`;
      const insertResult = await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [tableId, baseId, JSON.stringify(rowData), userId]
      );
      const rowId = insertResult.lastInsertRowid;

      const res = await request(app)
        .get(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.row).toBeDefined();
      expect(res.body.data.row.id).toBe(rowId);
      expect(res.body.data.row.table_id).toBe(tableId);
      expect(res.body.data.row.data[String(col1Id)]).toBe('John Doe');
      expect(res.body.data.row.data[String(col2Id)]).toBe('john@test.com');
      expect(res.body.data.row.created_at).toBeDefined();
      expect(res.body.data.row.updated_at).toBeDefined();
    });

    test('should return a single row by base_id', async () => {
      const rowData = { [col1Id]: 'Jane Doe', [col2Id]: 'jane@test.com' };
      const baseId = `row_base_test_${Date.now()}`;
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [tableId, baseId, JSON.stringify(rowData), userId]
      );

      const res = await request(app)
        .get(`/api/v3/tables/${tableId}/rows/${baseId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.row).toBeDefined();
      expect(res.body.data.row.base_id).toBe(baseId);
      expect(res.body.data.row.data[String(col1Id)]).toBe('Jane Doe');
    });

    test('should include column metadata in response', async () => {
      const rowData = { [col1Id]: 'Alice', [col2Id]: 'alice@test.com' };
      const baseId = `row_cols_${Date.now()}`;
      const insertResult = await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [tableId, baseId, JSON.stringify(rowData), userId]
      );
      const rowId = insertResult.lastInsertRowid;

      const res = await request(app)
        .get(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.columns).toBeDefined();
      expect(Array.isArray(res.body.data.columns)).toBe(true);
      expect(res.body.data.columns.length).toBe(2);
      expect(res.body.data.columns[0].column_name).toBe('name');
      expect(res.body.data.columns[0].display_name).toBe('Name');
      expect(res.body.data.columns[0].type).toBe('text');
      expect(res.body.data.columns[1].column_name).toBe('email');
    });

    test('should return 404 for non-existent row', async () => {
      const res = await request(app)
        .get(`/api/v3/tables/${tableId}/rows/99999`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    test('should return 404 for non-existent table', async () => {
      const res = await request(app)
        .get('/api/v3/tables/99999/rows/1')
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ============================================================
  // GET /api/v3/projects/:projectId/tables
  // ============================================================
  describe('GET /api/v3/projects/:projectId/tables', () => {
    test('should return tables for specific project', async () => {
      await createTestTable(projectId, 'proj_table');

      const res = await request(app)
        .get(`/api/v3/projects/${projectId}/tables`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ============================================================
  // PUT /api/v3/tables/:tableId/rows/:rowId — Select Column Resolution
  // ADR-098 fix: text values should be auto-resolved to numeric IDs
  // ============================================================
  describe('PUT /api/v3/tables/:tableId/rows/:rowId - select column resolution', () => {
    let tableId, textColId, selectColId, relatedTableId;

    // Helper to create a table row with auto-generated base_id
    async function insertRow(tblId, data) {
      const baseId = `row_${tblId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [tblId, baseId, JSON.stringify(data), userId]
      );
      return result.lastInsertRowid;
    }

    beforeEach(async () => {
      // Create main table
      tableId = await createTestTable(projectId, 'Select Test Table');

      // Create related lookup table (like ticket states table 1706)
      const relResult = await dbRun(
        'INSERT INTO universal_tables (project_id, name, description) VALUES (?, ?, ?)',
        [projectId, 'states_lookup', 'States Lookup']
      );
      relatedTableId = relResult.lastInsertRowid;

      // Insert lookup options (like backlog=24275, done=24278)
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [relatedTableId, `state_backlog_${Date.now()}`, JSON.stringify({ name: 'backlog', color: '#6b7280' }), userId]
      );
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [relatedTableId, `state_done_${Date.now()}`, JSON.stringify({ name: 'done', color: '#22c55e' }), userId]
      );
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [relatedTableId, `state_inprogress_${Date.now()}`, JSON.stringify({ name: 'in progress', color: '#3b82f6' }), userId]
      );

      // Create text column
      const col1 = await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, config, is_required, order_index, is_visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tableId, 'what', 'What', 'text', '{}', 0, 0, 1]
      );
      textColId = col1.lastInsertRowid;

      // Create select column with relation (like state column in tickets)
      const col2 = await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, config, is_required, order_index, is_visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tableId, 'state', 'State', 'select', JSON.stringify({
          relation: {
            enabled: true,
            tableId: String(relatedTableId),
            valueColumn: 'id',
            labelColumn: 'name',
          }
        }), 0, 1, 1]
      );
      selectColId = col2.lastInsertRowid;
    });

    test('should convert text state value to numeric ID', async () => {
      // Get one of the lookup row IDs for backlog
      const backlogRow = await dbGet(
        `SELECT id FROM table_rows WHERE table_id = ? AND data::text LIKE '%backlog%'`,
        [relatedTableId]
      );

      // Create a row with numeric state
      const rowId = await insertRow(tableId, { what: 'Test task', state: backlogRow.id });

      // Update with TEXT value "done" — should be resolved to numeric ID
      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { state: 'done' } })
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify the stored value is a number, not a string
      const updatedRow = await dbGet(
        'SELECT data FROM table_rows WHERE id = ? AND table_id = ?',
        [rowId, tableId]
      );
      const storedData = typeof updatedRow.data === 'string' ? JSON.parse(updatedRow.data) : updatedRow.data;
      expect(typeof storedData.state).toBe('number');

      // It should match the "done" row's ID
      const doneRow = await dbGet(
        `SELECT id FROM table_rows WHERE table_id = ? AND data::text LIKE '%done%'`,
        [relatedTableId]
      );
      expect(storedData.state).toBe(doneRow.id);
    });

    test('should pass through numeric state values unchanged', async () => {
      const backlogRow = await dbGet(
        `SELECT id FROM table_rows WHERE table_id = ? AND data::text LIKE '%backlog%'`,
        [relatedTableId]
      );

      const rowId = await insertRow(tableId, { what: 'Test task', state: backlogRow.id });

      const doneRow = await dbGet(
        `SELECT id FROM table_rows WHERE table_id = ? AND data::text LIKE '%done%'`,
        [relatedTableId]
      );

      // Update with numeric ID directly — should pass through
      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { state: doneRow.id } })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updatedRow = await dbGet(
        'SELECT data FROM table_rows WHERE id = ? AND table_id = ?',
        [rowId, tableId]
      );
      const storedData = typeof updatedRow.data === 'string' ? JSON.parse(updatedRow.data) : updatedRow.data;
      expect(storedData.state).toBe(doneRow.id);
    });

    test('should return 400 for invalid text state value', async () => {
      const rowId = await insertRow(tableId, { what: 'Test task', state: 1 });

      // Try to set state to a non-existent text value
      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { state: 'nonexistent_state' } })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Invalid select values');
    });

    test('should handle case-insensitive text resolution', async () => {
      const rowId = await insertRow(tableId, { what: 'Test task', state: 1 });

      // Use mixed case "Backlog" — should resolve case-insensitively
      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { state: 'Backlog' } })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updatedRow = await dbGet(
        'SELECT data FROM table_rows WHERE id = ? AND table_id = ?',
        [rowId, tableId]
      );
      const storedData = typeof updatedRow.data === 'string' ? JSON.parse(updatedRow.data) : updatedRow.data;
      expect(typeof storedData.state).toBe('number');
    });

    test('should not affect non-select columns', async () => {
      const rowId = await insertRow(tableId, { what: 'Old task' });

      // Update text column — should pass through without any resolution
      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { what: 'New task name' } })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updatedRow = await dbGet(
        'SELECT data FROM table_rows WHERE id = ? AND table_id = ?',
        [rowId, tableId]
      );
      const storedData = typeof updatedRow.data === 'string' ? JSON.parse(updatedRow.data) : updatedRow.data;
      expect(storedData.what).toBe('New task name');
    });

    test('should convert numeric string to number for select columns', async () => {
      const backlogRow = await dbGet(
        `SELECT id FROM table_rows WHERE table_id = ? AND data::text LIKE '%backlog%'`,
        [relatedTableId]
      );

      const rowId = await insertRow(tableId, { what: 'Test task' });

      // Pass numeric ID as string "12345" — should be converted to number
      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { state: String(backlogRow.id) } })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updatedRow = await dbGet(
        'SELECT data FROM table_rows WHERE id = ? AND table_id = ?',
        [rowId, tableId]
      );
      const storedData = typeof updatedRow.data === 'string' ? JSON.parse(updatedRow.data) : updatedRow.data;
      expect(typeof storedData.state).toBe('number');
      expect(storedData.state).toBe(backlogRow.id);
    });

    test('should reject invalid numeric ID for relation-based select', async () => {
      const rowId = await insertRow(tableId, { what: 'Test task', state: 1 });

      // Pass a numeric ID that does not exist in the related table
      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { state: 999999 } })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Invalid select values');
      expect(res.body.error.message).toContain('invalid option ID');
    });

    test('should reject invalid numeric string ID for relation-based select', async () => {
      const rowId = await insertRow(tableId, { what: 'Test task', state: 1 });

      // Pass a numeric string ID that does not exist in the related table
      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { state: '999999' } })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Invalid select values');
      expect(res.body.error.message).toContain('invalid option ID');
    });

    test('should include valid IDs in error message for invalid numeric ID', async () => {
      const rowId = await insertRow(tableId, { what: 'Test task' });

      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { state: 999999 } })
        .expect(400);

      // Error message should list valid IDs so the caller knows what to use
      expect(res.body.error.message).toContain('Valid IDs:');
    });

    test('should include valid labels in error message for invalid text value', async () => {
      const rowId = await insertRow(tableId, { what: 'Test task' });

      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { state: 'nonexistent_state' } })
        .expect(400);

      // Error message should list valid text labels
      expect(res.body.error.message).toContain('backlog');
    });
  });

  // ============================================================
  // PUT /api/v3/tables/:tableId/rows/:rowId — Static Options Select
  // ============================================================
  describe('PUT /api/v3/tables/:tableId/rows/:rowId - static options select', () => {
    let tableId, phaseColId;

    // Helper to create a table row with auto-generated base_id
    async function insertRow(tblId, data) {
      const baseId = `row_${tblId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [tblId, baseId, JSON.stringify(data), userId]
      );
      return result.lastInsertRowid;
    }

    beforeEach(async () => {
      tableId = await createTestTable(projectId, 'Phase Test Table');

      // Create select column with static options (like phase/cycle)
      const col = await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, config, is_required, order_index, is_visible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tableId, 'phase', 'Phase', 'select', JSON.stringify({
          options: [
            { label: 'Phase 0', value: 'phase_0', color: '#ef4444' },
            { label: 'Phase 1', value: 'phase_1', color: '#f59e0b' },
            { label: 'Phase 2', value: 'phase_2', color: '#3b82f6' },
          ]
        }), 0, 0, 1]
      );
      phaseColId = col.lastInsertRowid;
    });

    test('should accept valid static option value', async () => {
      const rowId = await insertRow(tableId, { phase: 'phase_0' });

      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { phase: 'phase_1' } })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    test('should resolve static option by label text', async () => {
      const rowId = await insertRow(tableId, { phase: 'phase_0' });

      // Use label text "Phase 1" instead of value "phase_1"
      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { phase: 'Phase 1' } })
        .expect(200);

      expect(res.body.success).toBe(true);

      const updatedRow = await dbGet(
        'SELECT data FROM table_rows WHERE id = ? AND table_id = ?',
        [rowId, tableId]
      );
      const storedData = typeof updatedRow.data === 'string' ? JSON.parse(updatedRow.data) : updatedRow.data;
      expect(storedData.phase).toBe('phase_1');
    });

    test('should reject invalid static option', async () => {
      const rowId = await insertRow(tableId, { phase: 'phase_0' });

      const res = await request(app)
        .put(`/api/v3/tables/${tableId}/rows/${rowId}`)
        .send({ data: { phase: 'Phase 99' } })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Invalid select values');
    });
  });
});
