/**
 * Export/Import Round-Trip Tests - TDD Approach
 * ADR-020: Export/Import — Quick Backup & Restore
 * 
 * 🔴 RED → 🟢 GREEN → 🔵 REFACTOR
 * 
 * Test Levels:
 * - Level 1: Table Export/Import
 * - Level 2: Project Export/Import
 * - Level 3: Space Export/Import
 * - Access Control Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter, safeJsonParse, toBool } from '../../database/connection.js';
// Services to test (will be created)
import { ExportService } from '../ExportService.js';
import { ImportService } from '../ImportService.js';

// ============================================================
// Test Helpers
// ============================================================

async function createTestUser(options = {}) {
  const uniqueEmail = `test-export-${Date.now()}-${Math.random().toString(36).substring(7)}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified, role) VALUES (?, ?, ?, ?, ?, ?)',
    [uniqueEmail, 'hash', options.name || 'Test User', 'encrypted_key', 1, options.role || 'user']
  );
  return result.lastInsertRowid;
}

async function createTestSpace(ownerId, options = {}) {
  const result = await dbRun(
    'INSERT INTO spaces (owner_id, name, type, description) VALUES (?, ?, ?, ?)',
    [ownerId, options.name || 'Test Space', options.type || 'business', options.description || 'Test space for export']
  );
  return { id: result.lastInsertRowid, owner_id: ownerId, name: options.name || 'Test Space' };
}

async function createTestProject(spaceId, ownerId, options = {}) {
  const result = await dbRun(
    'INSERT INTO projects (space_id, owner_id, name, description, icon, type) VALUES (?, ?, ?, ?, ?, ?)',
    [spaceId, ownerId, options.name || 'Test Project', options.description || '', options.icon || '📁', options.type || 'business']
  );
  return { id: result.lastInsertRowid, space_id: spaceId, name: options.name || 'Test Project' };
}

async function createTestTable(projectId, options = {}) {
  const result = await dbRun(
    'INSERT INTO universal_tables (project_id, name, description, icon, is_system) VALUES (?, ?, ?, ?, ?)',
    [projectId, options.name || 'Test Table', options.description || '', options.icon || '📊', toBool(false)]
  );
  return { id: result.lastInsertRowid, project_id: projectId, name: options.name || 'Test Table' };
}

async function createTestColumn(tableId, options = {}) {
  const result = await dbRun(`
    INSERT INTO table_columns (
      table_id, column_name, display_name, type, config, 
      is_required, is_visible, order_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    tableId,
    options.name || 'test_column',
    options.displayName || options.name || 'Test Column',
    options.type || 'text',
    JSON.stringify(options.config || {}),
    toBool(options.isRequired || false),
    toBool(options.isVisible !== false),
    options.orderIndex || 0
  ]);
  return { 
    id: result.lastInsertRowid, 
    table_id: tableId, 
    name: options.name || 'test_column',
    column_type: options.type || 'text'
  };
}

function generateBaseId() {
  return 'base_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

async function createTestRow(tableId, data, userId = null) {
  const baseId = generateBaseId();
  const result = await dbRun(`
    INSERT INTO table_rows (table_id, base_id, data, created_by)
    VALUES (?, ?, ?, ?)
  `, [tableId, baseId, JSON.stringify(data), userId]);
  return { id: result.lastInsertRowid, table_id: tableId, data };
}

async function createTestDocument(projectId, options = {}) {
  try {
    const result = await dbRun(`
      INSERT INTO documents (project_id, title, content, status)
      VALUES (?, ?, ?, ?)
    `, [
      projectId, 
      options.title || 'Test Document', 
      JSON.stringify(options.content || { blocks: [] }),
      options.status || 'published'
    ]);
    return { id: result.lastInsertRowid, project_id: projectId, title: options.title || 'Test Document' };
  } catch (e) {
    // Documents table might not exist in test DB
    return null;
  }
}

async function createTestTableWithData(projectId, spec) {
  // Create table
  const table = await createTestTable(projectId, { name: spec.name });
  
  // Create columns
  for (let i = 0; i < spec.columns.length; i++) {
    const colSpec = spec.columns[i];
    await createTestColumn(table.id, {
      name: colSpec.name,
      displayName: colSpec.displayName || colSpec.name,
      type: colSpec.type,
      config: colSpec.config || {},
      orderIndex: i
    });
  }
  
  // Create rows
  if (spec.rows) {
    for (const rowData of spec.rows) {
      await createTestRow(table.id, rowData);
    }
  }
  
  return table;
}

async function getTableRows(tableId) {
  const rows = await dbAll('SELECT * FROM table_rows WHERE table_id = ? ORDER BY id', [tableId]);
  return rows.map(r => ({
    id: r.id,
    ...safeJsonParse(r.data)
  }));
}

async function getTableColumns(tableId) {
  return await dbAll('SELECT * FROM table_columns WHERE table_id = ? ORDER BY order_index', [tableId]);
}

async function cleanupTestData() {
  // Clean in reverse order of dependencies
  await dbRun('DELETE FROM table_rows WHERE table_id IN (SELECT id FROM universal_tables WHERE name LIKE ?)', ['%Test%']);
  await dbRun('DELETE FROM table_columns WHERE table_id IN (SELECT id FROM universal_tables WHERE name LIKE ?)', ['%Test%']);
  await dbRun('DELETE FROM universal_tables WHERE name LIKE ?', ['%Test%']);
  await dbRun('DELETE FROM documents WHERE title LIKE ?', ['%Test%']);
  await dbRun('DELETE FROM projects WHERE name LIKE ?', ['%Test%']);
  await dbRun('DELETE FROM spaces WHERE name LIKE ?', ['%Test%']);
  await dbRun('DELETE FROM users WHERE email LIKE ?', ['%test-export%']);
}

// ============================================================
// Test Suite
// ============================================================

describe('Export/Import Round-Trip', () => {
  
  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
  });

  afterEach(async () => {
    try {
      await cleanupTestData();
    } catch (e) {
      // Ignore cleanup errors
    }
    await destroyAdapter();
  });

  // =========================================================================
  // LEVEL 1: TABLE ROUND-TRIP
  // =========================================================================
  
  describe('Table Round-Trip', () => {
    let testSpace;
    let testProject;
    let testTable;
    let userId;
    
    beforeEach(async () => {
      userId = await createTestUser();
      testSpace = await createTestSpace(userId);
      testProject = await createTestProject(testSpace.id, userId);
      testTable = await createTestTableWithData(testProject.id, {
        name: 'customers',
        columns: [
          { name: 'name', type: 'text' },
          { name: 'email', type: 'email' },
          { name: 'status', type: 'select' },
          { name: 'api_key', type: 'apiKey' },
          { name: 'password', type: 'password' }
        ],
        rows: [
          { name: 'John', email: 'john@test.com', status: 'active', api_key: 'key123', password: 'hash123' },
          { name: 'Jane', email: 'jane@test.com', status: 'pending', api_key: 'key456', password: 'hash456' }
        ]
      });
    });
    
    it('exports table with FULL mode and imports identical copy', async () => {
      // 1. Export
      const exported = await ExportService.exportTable(testTable.id, { mode: 'full' });
      
      // 2. Verify export structure
      expect(exported.type).toBe('table');
      expect(exported.table.name).toBe('customers');
      expect(exported.columns).toHaveLength(5);
      expect(exported.rows).toHaveLength(2);
      expect(exported.meta.exported_at).toBeDefined();
      expect(exported.meta.mode).toBe('full');
      expect(exported.meta.godcrm_version).toBeDefined();
      
      // 3. Import to same project as new table
      const imported = await ImportService.importTable(testProject.id, exported, { 
        mode: 'create',
        newName: 'customers_copy'
      });
      
      // 4. Verify imported table matches original
      expect(imported.tableId).toBeDefined();
      expect(imported.rowsImported).toBe(2);
      expect(imported.columnsCreated).toBe(5);
      
      // 5. Deep comparison
      const originalRows = await getTableRows(testTable.id);
      const importedRows = await getTableRows(imported.tableId);
      
      expect(importedRows).toHaveLength(originalRows.length);
      expect(importedRows[0].name).toBe(originalRows[0].name);
      expect(importedRows[0].email).toBe(originalRows[0].email);
      expect(importedRows[0].api_key).toBe(originalRows[0].api_key); // Full mode = includes sensitive
    });
    
    it('exports table with SCHEMA_ONLY mode (no rows)', async () => {
      const exported = await ExportService.exportTable(testTable.id, { mode: 'schema_only' });
      
      expect(exported.columns).toHaveLength(5);
      expect(exported.rows).toHaveLength(0);
      expect(exported.meta.mode).toBe('schema_only');
      
      const imported = await ImportService.importTable(testProject.id, exported, { 
        mode: 'create',
        newName: 'empty_customers'
      });
      
      expect(imported.rowsImported).toBe(0);
      expect(imported.columnsCreated).toBe(5);
    });
    
    it('exports table with SANITIZED mode (clears sensitive columns)', async () => {
      const exported = await ExportService.exportTable(testTable.id, { mode: 'sanitized' });
      
      // Sensitive columns should have null values
      expect(exported.rows[0].api_key).toBeNull();
      expect(exported.rows[0].password).toBeNull();
      
      // Non-sensitive columns should be intact
      expect(exported.rows[0].name).toBe('John');
      expect(exported.rows[0].email).toBe('john@test.com');
      
      // Meta should indicate sanitized columns
      expect(exported.meta.sanitizedColumns).toContain('api_key');
      expect(exported.meta.sanitizedColumns).toContain('password');
    });
    
    it('detects sensitive columns by type', async () => {
      const sensitiveInfo = await ExportService.detectSensitiveColumns(testTable.id);
      
      expect(sensitiveInfo.hasSensitive).toBe(true);
      expect(sensitiveInfo.columns).toContainEqual(expect.objectContaining({ 
        name: 'api_key', 
        type: 'apiKey',
        reason: 'Column type is sensitive'
      }));
      expect(sensitiveInfo.columns).toContainEqual(expect.objectContaining({ 
        name: 'password', 
        type: 'password',
        reason: 'Column type is sensitive'
      }));
    });
    
    it('detects sensitive columns by name pattern', async () => {
      // Create table with sensitive-looking column names
      const tableWithPatterns = await createTestTableWithData(testProject.id, {
        name: 'credentials_test',
        columns: [
          { name: 'user_password', type: 'text' },
          { name: 'secret_token', type: 'text' },
          { name: 'private_key', type: 'text' },
          { name: 'description', type: 'text' }
        ],
        rows: [{ user_password: 'pwd', secret_token: 'tok', private_key: 'key', description: 'test' }]
      });
      
      const sensitiveInfo = await ExportService.detectSensitiveColumns(tableWithPatterns.id);
      
      expect(sensitiveInfo.hasSensitive).toBe(true);
      expect(sensitiveInfo.columns.map(c => c.name)).toContain('user_password');
      expect(sensitiveInfo.columns.map(c => c.name)).toContain('secret_token');
      expect(sensitiveInfo.columns.map(c => c.name)).toContain('private_key');
      expect(sensitiveInfo.columns.map(c => c.name)).not.toContain('description');
    });

    it('detects no sensitive columns in clean table', async () => {
      const cleanTable = await createTestTableWithData(testProject.id, {
        name: 'clean_table_test',
        columns: [
          { name: 'name', type: 'text' },
          { name: 'email', type: 'email' },
          { name: 'notes', type: 'text' }
        ],
        rows: []
      });
      
      const sensitiveInfo = await ExportService.detectSensitiveColumns(cleanTable.id);
      
      expect(sensitiveInfo.hasSensitive).toBe(false);
      expect(sensitiveInfo.columns).toHaveLength(0);
    });
  });
  
  // =========================================================================
  // LEVEL 2: PROJECT ROUND-TRIP
  // =========================================================================
  
  describe('Project Round-Trip', () => {
    let testSpace;
    let testProject;
    let userId;
    
    beforeEach(async () => {
      userId = await createTestUser();
      testSpace = await createTestSpace(userId);
      testProject = await createTestProject(testSpace.id, userId, { name: 'CRM Project' });
      
      // Create tables
      await createTestTableWithData(testProject.id, {
        name: 'customers',
        columns: [
          { name: 'name', type: 'text' },
          { name: 'email', type: 'email' }
        ],
        rows: [
          { name: 'Customer 1', email: 'c1@test.com' },
          { name: 'Customer 2', email: 'c2@test.com' }
        ]
      });
      
      await createTestTableWithData(testProject.id, {
        name: 'orders',
        columns: [
          { name: 'order_id', type: 'text' },
          { name: 'amount', type: 'number' }
        ],
        rows: [
          { order_id: 'ORD-001', amount: 100 }
        ]
      });
      
      await createTestTableWithData(testProject.id, {
        name: 'api_keys',
        columns: [
          { name: 'service', type: 'text' },
          { name: 'api_key', type: 'apiKey' }
        ],
        rows: [
          { service: 'Stripe', api_key: 'sk_test_123' }
        ]
      });
      
      // Create documents (may fail if table doesn't exist)
      const doc1 = await createTestDocument(testProject.id, { title: 'Test README' });
      const doc2 = await createTestDocument(testProject.id, { title: 'Test API Guide' });
      // Track how many docs were actually created
      testProject.docsCreated = [doc1, doc2].filter(Boolean).length;
    });
    
    it('exports project and imports identical copy to same space', async () => {
      // 1. Export project with all tables FULL
      const exported = await ExportService.exportProject(testProject.id, {
        tables: {
          'customers': 'full',
          'orders': 'full',
          'api_keys': 'full'
        },
        includeDocuments: true
      });
      
      // 2. Verify structure
      expect(exported.type).toBe('project');
      expect(exported.project.name).toBe('CRM Project');
      expect(exported.tables).toHaveLength(3);
      // Documents may be empty if table doesn't exist in test DB
      expect(exported.documents).toHaveLength(testProject.docsCreated || 0);
      
      // 3. Import to same space
      const imported = await ImportService.importProject(testSpace.id, exported, {
        mode: 'create',
        newName: 'CRM Project Copy'
      });
      
      // 4. Verify
      expect(imported.projectId).toBeDefined();
      expect(imported.tablesImported).toBe(3);
      expect(imported.documentsImported).toBe(testProject.docsCreated || 0);
      
      // 5. Verify project was created
      const newProject = await dbGet('SELECT * FROM projects WHERE id = ?', [imported.projectId]);
      expect(newProject.name).toBe('CRM Project Copy');
    });
    
    it('exports project with mixed table modes', async () => {
      const exported = await ExportService.exportProject(testProject.id, {
        tables: {
          'customers': 'full',
          'orders': 'schema_only',
          'api_keys': 'sanitized'
        },
        includeDocuments: true
      });
      
      // Verify each table exported correctly
      const customersTable = exported.tables.find(t => t.table.name === 'customers');
      const ordersTable = exported.tables.find(t => t.table.name === 'orders');
      const apiKeysTable = exported.tables.find(t => t.table.name === 'api_keys');
      
      expect(customersTable.rows.length).toBeGreaterThan(0);
      expect(ordersTable.rows).toHaveLength(0); // schema_only
      expect(apiKeysTable.meta.sanitizedColumns).toBeDefined();
      expect(apiKeysTable.rows[0].api_key).toBeNull(); // sanitized
    });
    
    it('excludes tables marked as exclude', async () => {
      const exported = await ExportService.exportProject(testProject.id, {
        tables: {
          'customers': 'full',
          'orders': 'exclude',
          'api_keys': 'exclude'
        }
      });
      
      expect(exported.tables).toHaveLength(1);
      expect(exported.tables[0].table.name).toBe('customers');
    });

    it('exports all tables with wildcard', async () => {
      const exported = await ExportService.exportProject(testProject.id, {
        tables: { '*': 'full' },
        includeDocuments: false
      });
      
      expect(exported.tables).toHaveLength(3);
      expect(exported.documents).toHaveLength(0);
    });
  });
  
  // =========================================================================
  // LEVEL 3: SPACE ROUND-TRIP
  // =========================================================================
  
  describe('Space Round-Trip', () => {
    let testSpace;
    let userId;
    
    beforeEach(async () => {
      userId = await createTestUser();
      testSpace = await createTestSpace(userId, { name: 'My Workspace' });
      
      // Create Project 1
      const project1 = await createTestProject(testSpace.id, userId, { name: 'CRM' });
      await createTestTableWithData(project1.id, {
        name: 'clients',
        columns: [{ name: 'name', type: 'text' }],
        rows: [{ name: 'Client 1' }]
      });
      
      // Create Project 2
      const project2 = await createTestProject(testSpace.id, userId, { name: 'Analytics' });
      await createTestTableWithData(project2.id, {
        name: 'reports',
        columns: [{ name: 'title', type: 'text' }],
        rows: [{ title: 'Report 1' }]
      });
    });
    
    it('exports space and imports as new space with identical content', async () => {
      // 1. Export entire space
      const exported = await ExportService.exportSpace(testSpace.id, {
        projects: {
          'CRM': { tables: { '*': 'full' } },
          'Analytics': { tables: { '*': 'full' } }
        },
        includeSettings: true
      }, { userId });
      
      // 2. Verify structure
      expect(exported.type).toBe('space');
      expect(exported.space.name).toBe('My Workspace');
      expect(exported.projects).toHaveLength(2);
      
      // 3. Import as new space
      const imported = await ImportService.importSpace(exported, {
        newName: 'My Workspace Copy',
        ownerId: userId
      });
      
      // 4. Verify
      expect(imported.spaceId).toBeDefined();
      expect(imported.projectsImported).toBe(2);
      
      // 5. Verify space was created
      const newSpace = await dbGet('SELECT * FROM spaces WHERE id = ?', [imported.spaceId]);
      expect(newSpace.name).toBe('My Workspace Copy');
      
      // 6. Verify projects were created
      const newProjects = await dbAll('SELECT * FROM projects WHERE space_id = ?', [imported.spaceId]);
      expect(newProjects).toHaveLength(2);
    });
    
    it('handles export when user is not admin/owner (should fail)', async () => {
      const regularUserId = await createTestUser({ name: 'Regular User' });
      
      await expect(
        ExportService.exportSpace(testSpace.id, {}, { userId: regularUserId })
      ).rejects.toThrow('Access denied: only admin or owner can export');
    });
  });
  
  // =========================================================================
  // ACCESS CONTROL TESTS
  // =========================================================================
  
  describe('Access Control', () => {
    let testSpace;
    let ownerId;
    
    beforeEach(async () => {
      ownerId = await createTestUser({ name: 'Space Owner' });
      testSpace = await createTestSpace(ownerId);
    });
    
    it('allows export for space owner', async () => {
      const canExport = await ExportService.canExport(ownerId, 'space', testSpace.id);
      expect(canExport).toBe(true);
    });
    
    it('denies export for non-member', async () => {
      const outsiderId = await createTestUser({ name: 'Outsider' });
      
      const canExport = await ExportService.canExport(outsiderId, 'space', testSpace.id);
      expect(canExport).toBe(false);
    });
    
    it('checks table export access through project and space', async () => {
      const project = await createTestProject(testSpace.id, ownerId);
      const table = await createTestTable(project.id);
      
      // Owner can export table
      const canExport = await ExportService.canExport(ownerId, 'table', table.id);
      expect(canExport).toBe(true);
      
      // Non-member cannot
      const outsiderId = await createTestUser({ name: 'Outsider2' });
      const cannotExport = await ExportService.canExport(outsiderId, 'table', table.id);
      expect(cannotExport).toBe(false);
    });
    
    it('checks project export access through space', async () => {
      const project = await createTestProject(testSpace.id, ownerId);
      
      // Owner can export project
      const canExport = await ExportService.canExport(ownerId, 'project', project.id);
      expect(canExport).toBe(true);
      
      // Non-member cannot
      const outsiderId = await createTestUser({ name: 'Outsider3' });
      const cannotExport = await ExportService.canExport(outsiderId, 'project', project.id);
      expect(cannotExport).toBe(false);
    });
  });

  // =========================================================================
  // EDGE CASES
  // =========================================================================

  describe('Edge Cases', () => {
    let testSpace;
    let testProject;
    let userId;

    beforeEach(async () => {
      userId = await createTestUser();
      testSpace = await createTestSpace(userId);
      testProject = await createTestProject(testSpace.id, userId);
    });

    it('handles empty table export', async () => {
      const emptyTable = await createTestTableWithData(testProject.id, {
        name: 'empty_table_test',
        columns: [{ name: 'name', type: 'text' }],
        rows: []
      });

      const exported = await ExportService.exportTable(emptyTable.id, { mode: 'full' });
      expect(exported.rows).toHaveLength(0);
      expect(exported.columns).toHaveLength(1);
    });

    it('handles table with no columns', async () => {
      const table = await createTestTable(testProject.id, { name: 'no_columns_test' });
      
      const exported = await ExportService.exportTable(table.id, { mode: 'full' });
      expect(exported.rows).toHaveLength(0);
      expect(exported.columns).toHaveLength(0);
    });

    it('handles project with no tables', async () => {
      const emptyProject = await createTestProject(testSpace.id, userId, { name: 'Empty Project Test' });
      
      const exported = await ExportService.exportProject(emptyProject.id, {
        tables: { '*': 'full' }
      });
      
      expect(exported.tables).toHaveLength(0);
    });

    it('rejects invalid export data on import', async () => {
      await expect(
        ImportService.importTable(testProject.id, { type: 'invalid' }, { mode: 'create' })
      ).rejects.toThrow('Invalid data type');
    });
  });
});
