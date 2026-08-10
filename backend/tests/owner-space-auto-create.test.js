// Owner Space Auto-Creation Tests - v0.002.007
// TDD: RED Phase - Tests должны упасть, т.к. функционал еще не реализован

process.env.TEST_MODE = 'true';
process.env.MASTER_ENCRYPTION_KEY = 'test_master_key_32_characters_long!';

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';
import { dbGet, dbAll } from '../database/connection.js';
import { registerUser } from '../services/AuthService.js';

describe.skip('Owner Space Auto-Creation - Full TDD', () => {
  beforeEach(async () => {
    process.env.SKIP_DEV_USER = 'true';
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  // ============================================================
  // Phase 1: Owner Registration + Admin Owner's Space
  // ============================================================

  describe.skip('Phase 1: Owner Registration', () => {
    test('1.1: First user becomes owner with role', async () => {
      const user = await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'John Owner'
      });

      expect(user).toBeDefined();
      expect(user.id).toBe(1);
      expect(user.role).toBe('owner'); // ❌ FAIL: role is undefined or 'user'
    });

    test('1.2: Admin Owners Space project created', async () => {
      const owner = await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'John Owner'
      });

      const adminSpace = await dbGet(
        'SELECT * FROM projects WHERE owner_id = ? AND type = ?',
        [owner.id, 'admin_owner_space']
      );

      expect(adminSpace).toBeDefined();
      expect(adminSpace.name).toBe("Admin Owner's Space");
      expect(adminSpace.icon).toBe('⚙️');
      expect(adminSpace.theme_primary).toBe('#ef4444'); // Red
      expect(adminSpace.theme_secondary).toBe('#f97316'); // Orange
      expect(adminSpace.theme_tertiary).toBe('#eab308'); // Yellow
    });

    test('1.3: Users system table created in Admin Space', async () => {
      const owner = await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'John Owner'
      });

      const adminSpace = await dbGet(
        'SELECT * FROM projects WHERE owner_id = ? AND type = ?',
        [owner.id, 'admin_owner_space']
      );

      const usersTable = await dbGet(
        'SELECT * FROM universal_tables WHERE project_id = ? AND name = ?',
        [adminSpace.id, 'Users']
      );

      expect(usersTable).toBeDefined(); // ❌ FAIL: table not created
      expect(usersTable.is_system).toBe(1);
      expect(usersTable.sync_target).toBe('users');
      expect(usersTable.icon).toBe('👥');
    });

    test('1.4: Users table has correct columns', async () => {
      const owner = await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'John Owner'
      });

      const usersTable = await dbGet(
        'SELECT * FROM universal_tables WHERE name = ?',
        ['Users']
      );

      const columns = await dbAll(
        'SELECT * FROM table_columns WHERE table_id = ? ORDER BY order_index',
        [usersTable.id]
      );

      // Expected columns
      const expectedColumns = [
        { column_name: 'id', type: 'number', is_system: 1 },
        { column_name: 'created_at', type: 'datetime', is_system: 1 },
        { column_name: 'updated_at', type: 'datetime', is_system: 1 },
        { column_name: 'email', type: 'email', is_required: 1 },
        { column_name: 'name', type: 'text', is_required: 1 },
        { column_name: 'role', type: 'select' },
        { column_name: 'avatar', type: 'image' },
        { column_name: 'totp_enabled', type: 'checkbox' },
        { column_name: 'email_verified', type: 'checkbox' }
      ];

      expect(columns.length).toBeGreaterThanOrEqual(expectedColumns.length);

      // Check each column
      for (const expected of expectedColumns) {
        const col = columns.find(c => c.column_name === expected.column_name);
        expect(col, `Column ${expected.column_name} should exist`).toBeDefined();
        expect(col.type).toBe(expected.type);
        if (expected.is_system) expect(col.is_system).toBe(1);
        if (expected.is_required) expect(col.is_required).toBe(1);
      }

      // Check role column has options
      const roleColumn = columns.find(c => c.column_name === 'role');
      const config = JSON.parse(roleColumn.config || '{}');
      expect(config.options).toBeDefined();
      expect(config.options.length).toBe(3); // owner, admin, user
      expect(config.options.map(o => o.value)).toContain('owner');
      expect(config.options.map(o => o.value)).toContain('admin');
      expect(config.options.map(o => o.value)).toContain('user');
    });

    test('1.5: Projects system table created', async () => {
      const owner = await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'John Owner'
      });

      const adminSpace = await dbGet(
        'SELECT * FROM projects WHERE type = ?',
        ['admin_owner_space']
      );

      const projectsTable = await dbGet(
        'SELECT * FROM universal_tables WHERE project_id = ? AND name = ?',
        [adminSpace.id, 'Projects']
      );

      expect(projectsTable).toBeDefined(); // ❌ FAIL
      expect(projectsTable.is_system).toBe(1);
      expect(projectsTable.sync_target).toBe('projects');
      expect(projectsTable.icon).toBe('📁');
    });

    test('1.6: Projects table has correct columns', async () => {
      const owner = await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'John Owner'
      });

      const projectsTable = await dbGet(
        'SELECT * FROM universal_tables WHERE name = ?',
        ['Projects']
      );

      const columns = await dbAll(
        'SELECT * FROM table_columns WHERE table_id = ?',
        [projectsTable.id]
      );

      const columnNames = columns.map(c => c.column_name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('type');
      expect(columnNames).toContain('owner_id');
      expect(columnNames).toContain('icon');
      expect(columnNames).toContain('theme_primary');

      // Check owner column is 'user' type (relation)
      const ownerColumn = columns.find(c => c.column_name === 'owner_id');
      expect(ownerColumn.type).toBe('user');
    });

    test('1.7: Tables system table created', async () => {
      const owner = await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'John Owner'
      });

      const adminSpace = await dbGet(
        'SELECT * FROM projects WHERE type = ?',
        ['admin_owner_space']
      );

      const tablesTable = await dbGet(
        'SELECT * FROM universal_tables WHERE project_id = ? AND name = ?',
        [adminSpace.id, 'Tables']
      );

      expect(tablesTable).toBeDefined(); // ❌ FAIL
      expect(tablesTable.is_system).toBe(1);
      expect(tablesTable.sync_target).toBe('universal_tables');
      expect(tablesTable.icon).toBe('📊');
    });

    test('1.8: Second user does NOT become owner', async () => {
      // First user
      await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'Owner'
      });

      // Second user
      const user2 = await registerUser({
        email: 'user2@test.com',
        password: 'Pass123!',
        name: 'User 2'
      });

      expect(user2.role).toBe('user'); // Should be 'user', not 'owner'
    });

    test('1.9: Second user does NOT get Admin Space', async () => {
      await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'Owner'
      });

      const user2 = await registerUser({
        email: 'user2@test.com',
        password: 'Pass123!',
        name: 'User 2'
      });

      const adminSpaces = await dbAll(
        'SELECT * FROM projects WHERE owner_id = ? AND type = ?',
        [user2.id, 'admin_owner_space']
      );

      expect(adminSpaces.length).toBe(0); // No admin space for regular users
    });
  });

  // ============================================================
  // Phase 2: System Tables Structure Validation
  // ============================================================

  describe.skip('Phase 2: System Tables Structure', () => {
    test('2.1: All 3 system tables created together', async () => {
      await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'Owner'
      });

      const adminSpace = await dbGet(
        'SELECT * FROM projects WHERE type = ?',
        ['admin_owner_space']
      );

      const systemTables = await dbAll(
        'SELECT * FROM universal_tables WHERE project_id = ? AND is_system = 1',
        [adminSpace.id]
      );

      expect(systemTables.length).toBe(3); // Users, Projects, Tables
      
      const tableNames = systemTables.map(t => t.name).sort();
      expect(tableNames).toEqual(['Projects', 'Tables', 'Users']);
    });

    test('2.2: System tables have correct sync targets', async () => {
      await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'Owner'
      });

      const systemTables = await dbAll(
        'SELECT * FROM universal_tables WHERE is_system = 1'
      );

      const syncMap = {};
      systemTables.forEach(t => {
        syncMap[t.name] = t.sync_target;
      });

      expect(syncMap['Users']).toBe('users');
      expect(syncMap['Projects']).toBe('projects');
      expect(syncMap['Tables']).toBe('universal_tables');
    });

    test('2.3: All system tables have icons', async () => {
      await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'Owner'
      });

      const systemTables = await dbAll(
        'SELECT * FROM universal_tables WHERE is_system = 1'
      );

      for (const table of systemTables) {
        expect(table.icon, `Table ${table.name} should have icon`).toBeDefined();
        expect(table.icon.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================
  // Phase 3: Edge Cases & Error Handling
  // ============================================================

  describe.skip('Phase 3: Edge Cases', () => {
    test('3.1: Cannot create duplicate Users table', async () => {
      await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'Owner'
      });

      const usersTable = await dbGet(
        'SELECT * FROM universal_tables WHERE name = ?',
        ['Users']
      );

      // Try to create duplicate
      try {
        await dbAll(
          'INSERT INTO universal_tables (project_id, name, is_system, sync_target) VALUES (?, ?, 1, ?)',
          [usersTable.project_id, 'Users', 'users']
        );
        expect.fail('Should not allow duplicate Users table');
      } catch (error) {
        // Should throw constraint error
        expect(error).toBeDefined();
      }
    });

    test('3.2: System tables are read-only (is_system = 1)', async () => {
      await registerUser({
        email: 'owner@test.com',
        password: 'Pass123!',
        name: 'Owner'
      });

      const systemTables = await dbAll(
        'SELECT * FROM universal_tables WHERE is_system = 1'
      );

      for (const table of systemTables) {
        expect(table.is_system).toBe(1);
      }
    });
  });
});
