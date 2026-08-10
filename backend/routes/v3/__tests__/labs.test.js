/**
 * ADR-043: Laboratories Feature Tests
 * 
 * TDD: Tests for Labs tables creation and basic functionality
 * 
 * Acceptance Criteria:
 * - AC1: labs_projects table exists with proper schema
 * - AC2: labs_nodes table exists with proper schema  
 * - AC3: labs_edges table exists with proper schema
 * - AC4: labs_ai_templates table exists with proper schema
 * - AC5: AI Operators table has extended columns
 * - AC6: All indexes are created properly
 */

process.env.SKIP_DEV_USER = 'true';
const JWT_SECRET = 'test-secret-key';
process.env.JWT_SECRET = JWT_SECRET;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbRun, dbGet, dbAll, isPostgres } from '../../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';

describe('ADR-043: Labs Tables Migration', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  describe('Table Creation', () => {
    it('should have labs table with correct schema', async () => {
      // Check table exists
      const tableQuery = isPostgres() 
        ? `SELECT table_name FROM information_schema.tables WHERE table_name = 'labs'`
        : `SELECT name FROM sqlite_master WHERE type='table' AND name='labs'`;
      
      const table = await dbGet(tableQuery);
      expect(table).toBeTruthy();

      // Check columns exist
      const columnsQuery = isPostgres()
        ? `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'labs' ORDER BY ordinal_position`
        : `PRAGMA table_info(labs)`;
      
      const columns = await dbAll(columnsQuery);
      expect(columns.length).toBeGreaterThan(0);
      
      // Check for key columns
      const columnNames = isPostgres() 
        ? columns.map(c => c.column_name)
        : columns.map(c => c.name);
      
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('space_id');
      expect(columnNames).toContain('lab_id');
      expect(columnNames).toContain('title');
      expect(columnNames).toContain('settings');
      expect(columnNames).toContain('ai_default_provider_id');
      expect(columnNames).toContain('ai_default_agent_id');
    });

    it('should have labs_nodes table with correct schema', async () => {
      const tableQuery = isPostgres() 
        ? `SELECT table_name FROM information_schema.tables WHERE table_name = 'labs_nodes'`
        : `SELECT name FROM sqlite_master WHERE type='table' AND name='labs_nodes'`;
      
      const table = await dbGet(tableQuery);
      expect(table).toBeTruthy();

      const columnsQuery = isPostgres()
        ? `SELECT column_name FROM information_schema.columns WHERE table_name = 'labs_nodes'`
        : `PRAGMA table_info(labs_nodes)`;
      
      const columns = await dbAll(columnsQuery);
      const columnNames = isPostgres() 
        ? columns.map(c => c.column_name)
        : columns.map(c => c.name);
      
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('lab_id');
      expect(columnNames).toContain('node_id');
      expect(columnNames).toContain('type');
      expect(columnNames).toContain('ai_config');
      expect(columnNames).toContain('ai_visible');
    });

    it('should have labs_edges table with correct schema', async () => {
      const tableQuery = isPostgres() 
        ? `SELECT table_name FROM information_schema.tables WHERE table_name = 'labs_edges'`
        : `SELECT name FROM sqlite_master WHERE type='table' AND name='labs_edges'`;
      
      const table = await dbGet(tableQuery);
      expect(table).toBeTruthy();

      const columnsQuery = isPostgres()
        ? `SELECT column_name FROM information_schema.columns WHERE table_name = 'labs_edges'`
        : `PRAGMA table_info(labs_edges)`;
      
      const columns = await dbAll(columnsQuery);
      const columnNames = isPostgres() 
        ? columns.map(c => c.column_name)
        : columns.map(c => c.name);
      
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('lab_id');
      expect(columnNames).toContain('edge_id');
      expect(columnNames).toContain('source_node_id');
      expect(columnNames).toContain('target_node_id');
    });

    it('should have labs_ai_templates table with correct schema', async () => {
      const tableQuery = isPostgres() 
        ? `SELECT table_name FROM information_schema.tables WHERE table_name = 'labs_ai_templates'`
        : `SELECT name FROM sqlite_master WHERE type='table' AND name='labs_ai_templates'`;
      
      const table = await dbGet(tableQuery);
      expect(table).toBeTruthy();

      const columnsQuery = isPostgres()
        ? `SELECT column_name FROM information_schema.columns WHERE table_name = 'labs_ai_templates'`
        : `PRAGMA table_info(labs_ai_templates)`;
      
      const columns = await dbAll(columnsQuery);
      const columnNames = isPostgres() 
        ? columns.map(c => c.column_name)
        : columns.map(c => c.name);
      
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('mindworkflow_id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('system_prompt');
      expect(columnNames).toContain('routing_config');
    });
  });

  describe('Indexes', () => {
    it('should have proper indexes on labs', async () => {
      const indexQuery = isPostgres()
        ? `SELECT indexname FROM pg_indexes WHERE tablename = 'labs'`
        : `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='labs'`;
      
      const indexes = await dbAll(indexQuery);
      const indexNames = indexes.map(i => i.indexname || i.name);
      
      expect(indexNames.some(name => name.includes('space'))).toBe(true);
      expect(indexNames.some(name => name.includes('lab_id'))).toBe(true);
    });

    it('should have proper indexes on labs_nodes', async () => {
      const indexQuery = isPostgres()
        ? `SELECT indexname FROM pg_indexes WHERE tablename = 'labs_nodes'`
        : `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='labs_nodes'`;
      
      const indexes = await dbAll(indexQuery);
      const indexNames = indexes.map(i => i.indexname || i.name);
      
      expect(indexNames.some(name => name.includes('lab'))).toBe(true);
    });
  });

  describe('Basic Operations', () => {
    it('should allow inserting and querying labs', async () => {
      // Create a test user first
      const ts = Date.now();
      const userResult = await dbRun(`
        INSERT INTO users (email, password_hash, name, role, encryption_key_encrypted, created_at)
        VALUES ($1, 'hash123', 'Test User', 'admin', 'enc123', NOW())
      `, [`test-labs-${ts}@test.com`]);
      
      const userId = userResult.lastInsertRowid;

      // Create a test space
      const spaceResult = await dbRun(`
        INSERT INTO spaces (owner_id, name, type, settings, created_at)
        VALUES (?, ?, ?, ?, NOW())
      `, [userId, 'Test Space', 'business', JSON.stringify({})]);
      
      const spaceId = spaceResult.lastInsertRowid;

      // This test will verify the tables work after migration
      const testData = {
        space_id: spaceId,
        lab_id: `test-lab-${ts}`,
        title: 'Test Lab Project',
        description: 'Test description',
        settings: JSON.stringify({ theme: 'dark' })
      };

      const insertQuery = isPostgres()
        ? `INSERT INTO labs (space_id, lab_id, title, description, settings) 
           VALUES ($1, $2, $3, $4, $5) RETURNING id`
        : `INSERT INTO labs (space_id, lab_id, title, description, settings) 
           VALUES (?, ?, ?, ?, ?)`;

      const result = await dbRun(insertQuery, [
        testData.space_id,
        testData.lab_id, 
        testData.title,
        testData.description,
        testData.settings
      ]);

      expect(result).toBeTruthy();
      
      // Query back the data
      const selectQuery = isPostgres()
        ? `SELECT * FROM labs WHERE lab_id = $1`
        : `SELECT * FROM labs WHERE lab_id = ?`;
        
      const retrieved = await dbGet(selectQuery, [testData.lab_id]);
      expect(retrieved).toBeTruthy();
      expect(retrieved.title).toBe(testData.title);
    });
  });
});