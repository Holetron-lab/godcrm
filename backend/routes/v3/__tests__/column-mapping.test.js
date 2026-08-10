/**
 * ADR-069: Column Mapping API Tests
 * TDD RED Phase - Tests for /api/v3/column-mapping/* endpoints
 *
 * NOTE: The column-mapping route uses PostgreSQL-style $1 parameter placeholders
 * which are not compatible with SQLite (better-sqlite3) in test environment.
 * Tests that hit the database are skipped in SQLite mode.
 *
 * Endpoints:
 * - GET /api/v3/column-mapping/defaults - Get standard fields
 * - GET /api/v3/column-mapping/:tableId - Get mappings for a table
 * - POST /api/v3/column-mapping/:tableId - Save mappings for a table
 * - DELETE /api/v3/column-mapping/:tableId - Delete mappings for a table
 */

// Set env vars BEFORE imports
process.env.SKIP_DEV_USER = 'true';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { dbRun, dbGet, dbAll, isPostgres } from '../../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';

const JWT_SECRET = 'test-secret-key';

// Column-mapping route uses PostgreSQL $1 placeholders which don't work with SQLite
const isSQLite = !isPostgres();

describe('ADR-069: Column Mapping API', () => {
  let app;
  let authToken;
  let testUserId;
  let testTableId;
  let testProjectId;

  beforeAll(async () => {
    // Initialize test database
    await setupTestDatabase();

    // Create table_column_mappings table if it doesn't exist (for test environment)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS table_column_mappings (
        id SERIAL PRIMARY KEY,
        table_id INTEGER NOT NULL,
        standard_field VARCHAR(50) NOT NULL,
        column_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(table_id, standard_field)
      )
    `);

    // Create test user
    const ts = Date.now();
    const userResult = await dbRun(`
      INSERT INTO users (email, password_hash, name, role, encryption_key_encrypted, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [`column-mapping-test-${ts}@test.com`, 'hash123', 'Column Mapping Test User', 'admin', 'enc123']);
    testUserId = userResult.lastInsertRowid;

    // Generate auth token
    authToken = jwt.sign({ id: testUserId, userId: testUserId, email: `column-mapping-test-${ts}@test.com`, role: 'admin' }, JWT_SECRET);

    // Create test project (type is NOT NULL in schema)
    const projectResult = await dbRun(`
      INSERT INTO projects (name, description, type, owner_id, created_at)
      VALUES (?, ?, 'business', ?, NOW())
    `, [`Column Mapping Test Project ${ts}`, 'Test project for column mapping', testUserId]);
    testProjectId = projectResult.lastInsertRowid;

    // The column-mapping route queries a 'tables' table (not universal_tables)
    // tables already exists in PG with columns: id, name, display_name, icon
    const tableResult = await dbRun(`
      INSERT INTO tables (id, name, display_name) VALUES ($1, $2, $3)
    `, [90000 + (ts % 10000), `tickets_${ts}`, `Tickets ${ts}`]);
    testTableId = tableResult.lastInsertRowid;

    // Create Express app with routes
    app = express();
    app.use(express.json());

    // Mock auth middleware
    app.use((req, res, next) => {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        try {
          req.user = jwt.verify(token, JWT_SECRET);
        } catch (e) {
          // Invalid token
        }
      }
      next();
    });

    // Import and mount column-mapping routes
    const columnMappingRoutes = await import('../column-mapping.js');
    app.use('/api/v3/column-mapping', columnMappingRoutes.default);
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Clean up mappings before each test
    await dbRun('DELETE FROM table_column_mappings WHERE table_id = ?', [testTableId]);
  });

  // ==========================================
  // GET /defaults - Standard fields (no DB query, works in SQLite)
  // ==========================================
  describe('GET /api/v3/column-mapping/defaults', () => {
    it('should return list of standard fields', async () => {
      const response = await request(app)
        .get('/api/v3/column-mapping/defaults')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('standardFields');
      expect(Array.isArray(response.body.data.standardFields)).toBe(true);
      expect(response.body.data.standardFields.length).toBeGreaterThan(0);

      // Check structure of standard fields
      const titleField = response.body.data.standardFields.find(f => f.key === 'title');
      expect(titleField).toBeDefined();
      expect(titleField.label).toBe('Заголовок');
      expect(titleField.required).toBe(true);
    });

    it('should include all expected standard fields', async () => {
      const response = await request(app)
        .get('/api/v3/column-mapping/defaults')
        .set('Authorization', `Bearer ${authToken}`);

      const fields = response.body.data.standardFields;
      const keys = fields.map(f => f.key);

      expect(keys).toContain('title');
      expect(keys).toContain('description');
      expect(keys).toContain('priority');
      expect(keys).toContain('status');
      expect(keys).toContain('assignee');
      expect(keys).toContain('dueDate');
      expect(keys).toContain('type');
      expect(keys).toContain('createdBy');
    });
  });

  // ==========================================
  // GET /:tableId - Get mappings
  // Note: Route uses $1 placeholders - only works in PostgreSQL
  // ==========================================
  describe('GET /api/v3/column-mapping/:tableId', () => {
    it.skipIf(isSQLite)('should return empty mappings for table without mappings', async () => {
      const response = await request(app)
        .get(`/api/v3/column-mapping/${testTableId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tableId).toBe(testTableId);
      expect(response.body.data.mappings).toEqual({});
    });

    it.skipIf(isSQLite)('should return mappings for table with existing mappings', async () => {
      // Insert test mapping
      await dbRun(`
        INSERT INTO table_column_mappings (table_id, standard_field, column_name)
        VALUES (?, ?, ?)
      `, [testTableId, 'title', 'name']);

      await dbRun(`
        INSERT INTO table_column_mappings (table_id, standard_field, column_name)
        VALUES (?, ?, ?)
      `, [testTableId, 'description', 'details']);

      const response = await request(app)
        .get(`/api/v3/column-mapping/${testTableId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tableId).toBe(testTableId);
      expect(response.body.data.mappings).toEqual({
        title: 'name',
        description: 'details'
      });
    });

    it('should return 400 for invalid table ID', async () => {
      const response = await request(app)
        .get('/api/v3/column-mapping/invalid')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================
  // POST /:tableId - Save mappings
  // ==========================================
  describe('POST /api/v3/column-mapping/:tableId', () => {
    it.skipIf(isSQLite)('should save new mappings', async () => {
      const mappings = {
        title: 'name',
        description: 'details',
        priority: 'priority_id',
        status: 'state_id'
      };

      const response = await request(app)
        .post(`/api/v3/column-mapping/${testTableId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ mappings });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tableId).toBe(testTableId);
      expect(response.body.data.mappings).toEqual(mappings);

      // Verify in database
      const dbMappings = await dbAll(
        'SELECT standard_field, column_name FROM table_column_mappings WHERE table_id = ?',
        [testTableId]
      );
      expect(dbMappings.length).toBe(4);
    });

    it('should return 400 for missing mappings object', async () => {
      const response = await request(app)
        .post(`/api/v3/column-mapping/${testTableId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for array instead of object', async () => {
      const response = await request(app)
        .post(`/api/v3/column-mapping/${testTableId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ mappings: ['title', 'description'] });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ==========================================
  // DELETE /:tableId - Delete mappings
  // ==========================================
  describe('DELETE /api/v3/column-mapping/:tableId', () => {
    it.skipIf(isSQLite)('should delete all mappings for a table', async () => {
      // Insert test mappings
      await dbRun(`
        INSERT INTO table_column_mappings (table_id, standard_field, column_name)
        VALUES (?, ?, ?)
      `, [testTableId, 'title', 'name']);
      await dbRun(`
        INSERT INTO table_column_mappings (table_id, standard_field, column_name)
        VALUES (?, ?, ?)
      `, [testTableId, 'description', 'details']);

      const response = await request(app)
        .delete(`/api/v3/column-mapping/${testTableId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);

      // Verify deleted in database
      const dbMappings = await dbAll(
        'SELECT * FROM table_column_mappings WHERE table_id = ?',
        [testTableId]
      );
      expect(dbMappings.length).toBe(0);
    });

    it.skipIf(isSQLite)('should return success even if no mappings exist', async () => {
      const response = await request(app)
        .delete(`/api/v3/column-mapping/${testTableId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
