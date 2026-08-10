/**
 * SystemTablesCreator Tests - TDD Approach
 * Sprint 0: Variables Table Infrastructure (ADR-026)
 * 
 * 🔴 RED → 🟢 GREEN → 🔵 REFACTOR
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { 
  createVariablesTable,
  ensureCoreSystemTablesForSpace
} from '../SystemTablesCreator.js';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter, toBool } from '../../database/connection.js';
// ============================================================
// Helper Functions
// ============================================================

async function createTestUser() {
  const uniqueEmail = `test-systables-${Date.now()}@hltrn.cc`;
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
    [ownerId, spaceId, 'Test Project', 'custom']
  );
  return result.lastInsertRowid;
}

// ============================================================
// TESTS
// ============================================================

describe('SystemTablesCreator - Variables Table (ADR-026)', () => {
  let userId;
  let spaceId;
  let projectId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    
    // Create test data
    userId = await createTestUser();
    spaceId = await createTestSpace(userId);
    projectId = await createTestProject(userId, spaceId);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // 🔴 RED PHASE: createVariablesTable
  // ============================================================
  
  describe('createVariablesTable()', () => {
    /**
     * BEHAVIOR: When I create a Variables table for a project
     * GIVEN a valid project ID
     * THEN a universal_table with name "Variables" is created
     * AND it has the correct columns for storing space variables
     */
    test('should create Variables table with correct schema', async () => {
      // Act
      const tableId = await createVariablesTable(projectId);
      
      // Assert: Table exists
      expect(tableId).toBeDefined();
      expect(typeof tableId).toBe('number');
      
      // Assert: Table has correct metadata
      const table = await dbGet(
        'SELECT * FROM universal_tables WHERE id = ?',
        [tableId]
      );
      expect(table).toBeDefined();
      expect(table.name).toBe('Variables');
      expect(table.description).toBe('Space calculated variables');
      expect(table.icon).toBe('🧮');
      expect(table.project_id).toBe(projectId);
    });

    test('should create Variables table with all required columns', async () => {
      // Act
      const tableId = await createVariablesTable(projectId);
      
      // Assert: Get all columns
      const columns = await dbAll(
        'SELECT * FROM table_columns WHERE table_id = ? ORDER BY order_index',
        [tableId]
      );
      
      // Expected columns from ADR-026:
      // name, scope_type, scope_ref, formula, description, 
      // stream_id, order_index, cached_value, cached_at, dependencies
      expect(columns.length).toBeGreaterThanOrEqual(10);
      
      // Create a map for easy lookup
      const columnMap = new Map(columns.map(c => [c.column_name, c]));
      
      // Check required columns exist
      expect(columnMap.has('name')).toBe(true);
      expect(columnMap.has('scope_type')).toBe(true);
      expect(columnMap.has('scope_ref')).toBe(true);
      expect(columnMap.has('formula')).toBe(true);
      expect(columnMap.has('description')).toBe(true);
      expect(columnMap.has('stream_id')).toBe(true);
      expect(columnMap.has('order_index')).toBe(true);
      expect(columnMap.has('cached_value')).toBe(true);
      expect(columnMap.has('cached_at')).toBe(true);
      expect(columnMap.has('dependencies')).toBe(true);
    });

    test('should create name column as required text field', async () => {
      // Act
      const tableId = await createVariablesTable(projectId);
      
      // Get name column
      const nameCol = await dbGet(
        'SELECT * FROM table_columns WHERE table_id = ? AND column_name = ?',
        [tableId, 'name']
      );
      
      // Assert
      expect(nameCol).toBeDefined();
      expect(nameCol.type).toBe('text');
      expect(nameCol.display_name).toBe('Name');
      // is_required should be truthy (1 or true)
      expect(!!nameCol.is_required).toBe(true);
    });

    test('should create scope_type column as select with correct options', async () => {
      // Act
      const tableId = await createVariablesTable(projectId);
      
      // Get scope_type column
      const scopeCol = await dbGet(
        'SELECT * FROM table_columns WHERE table_id = ? AND column_name = ?',
        [tableId, 'scope_type']
      );
      
      // Assert
      expect(scopeCol).toBeDefined();
      expect(scopeCol.type).toBe('select');
      expect(scopeCol.display_name).toBe('Scope');
      
      // Check options
      const config = JSON.parse(scopeCol.config || '{}');
      expect(config.options).toBeDefined();
      expect(Array.isArray(config.options)).toBe(true);
      
      const optionValues = config.options.map(o => o.value);
      expect(optionValues).toContain('space');
      expect(optionValues).toContain('table');
      expect(optionValues).toContain('dashboard');
    });

    test('should create formula column as textarea for long formulas', async () => {
      // Act
      const tableId = await createVariablesTable(projectId);
      
      // Get formula column
      const formulaCol = await dbGet(
        'SELECT * FROM table_columns WHERE table_id = ? AND column_name = ?',
        [tableId, 'formula']
      );
      
      // Assert
      expect(formulaCol).toBeDefined();
      expect(formulaCol.type).toBe('textarea');
      expect(formulaCol.display_name).toBe('Formula');
    });

    test('should create cached_value and cached_at as readonly columns', async () => {
      // Act
      const tableId = await createVariablesTable(projectId);
      
      // Get cached columns
      const cachedValueCol = await dbGet(
        'SELECT * FROM table_columns WHERE table_id = ? AND column_name = ?',
        [tableId, 'cached_value']
      );
      const cachedAtCol = await dbGet(
        'SELECT * FROM table_columns WHERE table_id = ? AND column_name = ?',
        [tableId, 'cached_at']
      );
      
      // Assert - these should be system/readonly
      expect(cachedValueCol).toBeDefined();
      expect(cachedAtCol).toBeDefined();
      expect(cachedAtCol.type).toBe('datetime');
    });

    test('should create dependencies column as json for storing dep graph', async () => {
      // Act
      const tableId = await createVariablesTable(projectId);
      
      // Get dependencies column
      const depsCol = await dbGet(
        'SELECT * FROM table_columns WHERE table_id = ? AND column_name = ?',
        [tableId, 'dependencies']
      );
      
      // Assert
      expect(depsCol).toBeDefined();
      expect(depsCol.type).toBe('json');
      expect(!!depsCol.is_system).toBe(true);
    });
  });

  // ============================================================
  // 🔴 RED PHASE: ensureCoreSystemTablesForSpace includes Variables
  // ============================================================
  
  describe('ensureCoreSystemTablesForSpace() with Variables', () => {
    /**
     * BEHAVIOR: When ensuring core system tables for a space
     * THEN Variables table should be created alongside Projects, Tables, Files
     */
    test('should create Variables table when ensuring system tables', async () => {
      // Act
      const result = await ensureCoreSystemTablesForSpace(spaceId);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.variablesTableId).toBeDefined();
      expect(typeof result.variablesTableId).toBe('number');
    });

    test('should not duplicate Variables table on second call', async () => {
      // Act - call twice
      const result1 = await ensureCoreSystemTablesForSpace(spaceId);
      const result2 = await ensureCoreSystemTablesForSpace(spaceId);
      
      // Assert - same table ID
      expect(result1.variablesTableId).toBe(result2.variablesTableId);
    });
  });
});
