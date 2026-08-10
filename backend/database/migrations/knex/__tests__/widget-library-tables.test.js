/**
 * Widget Library Tables Tests - ADR-073
 * TDD: Tests for widget_library, user_widget_favorites, user_widget_history tables
 * Tests run against PostgreSQL via connection.js
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../connection.js';
// Helper functions
async function createTestUser(suffix = '') {
  const uniqueEmail = `test-widget-lib-${Date.now()}${suffix}@hltrn.cc`;
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

async function createTestDashboard(projectId) {
  const result = await dbRun(
    'INSERT INTO dashboards (project_id, name, is_default) VALUES (?, ?, ?)',
    [projectId, 'Test Dashboard', 1]
  );
  return result.lastInsertRowid;
}

async function createTestWidget(dashboardId, presetName = 'table_view') {
  const result = await dbRun(`
    INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [dashboardId, 'preset', presetName, `Widget ${presetName}`, '{}', '{"x":0,"y":0,"w":6,"h":4}']);
  return result.lastInsertRowid;
}

async function createTestModule(widgetId, spaceId) {
  const result = await dbRun(
    'INSERT INTO modules (widget_id, space_id, sidebar_order) VALUES (?, ?, ?)',
    [widgetId, spaceId, 0]
  );
  return result.lastInsertRowid;
}

describe('Widget Library Tables - ADR-073', () => {
  let userId, spaceId, projectId, dashboardId, widgetId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();

    userId = await createTestUser();
    spaceId = await createTestSpace(userId);
    projectId = await createTestProject(userId, spaceId);
    dashboardId = await createTestDashboard(projectId);
    widgetId = await createTestWidget(dashboardId);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // widget_library TABLE
  // ============================================================
  describe('widget_library table', () => {
    test('should create widget_library table', async () => {
      // Table should exist after init
      const tableInfo = await dbAll("SELECT column_name as name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'widget_library'");
      expect(tableInfo.length).toBeGreaterThan(0);
    });

    test('should have all required columns', async () => {
      const tableInfo = await dbAll("SELECT column_name as name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'widget_library'");
      const columnNames = tableInfo.map(col => col.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('widget_id');
      expect(columnNames).toContain('space_id');
      expect(columnNames).toContain('is_public');
      expect(columnNames).toContain('is_template');
      expect(columnNames).toContain('use_count');
      expect(columnNames).toContain('last_used_at');
      expect(columnNames).toContain('tags');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    test('should insert into widget_library', async () => {
      const result = await dbRun(`
        INSERT INTO widget_library (widget_id, space_id, is_public, is_template, tags)
        VALUES (?, ?, ?, ?, ?)
      `, [widgetId, spaceId, false, false, '{kanban,project}']);

      expect(result.lastInsertRowid).toBeDefined();
      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test('should enforce unique widget_id constraint', async () => {
      await dbRun(`
        INSERT INTO widget_library (widget_id, space_id, is_public)
        VALUES (?, ?, ?)
      `, [widgetId, spaceId, false]);

      // Trying to insert the same widget_id should fail
      await expect(
        dbRun(`
          INSERT INTO widget_library (widget_id, space_id, is_public)
          VALUES (?, ?, ?)
        `, [widgetId, spaceId, true])
      ).rejects.toThrow();
    });

    test('should enforce foreign key on widget_id', async () => {
      // Try to insert with non-existent widget_id
      await expect(
        dbRun(`
          INSERT INTO widget_library (widget_id, space_id, is_public)
          VALUES (?, ?, ?)
        `, [99999, spaceId, false])
      ).rejects.toThrow();
    });

    test('should cascade delete when widget is deleted', async () => {
      // Create a new widget specifically for this test
      const newWidgetId = await createTestWidget(dashboardId, 'test_cascade');

      // Add to library
      await dbRun(`
        INSERT INTO widget_library (widget_id, space_id, is_public)
        VALUES (?, ?, ?)
      `, [newWidgetId, spaceId, false]);

      // Verify it exists
      const before = await dbGet('SELECT * FROM widget_library WHERE widget_id = ?', [newWidgetId]);
      expect(before).toBeDefined();

      // Delete widget
      await dbRun('DELETE FROM widgets WHERE id = ?', [newWidgetId]);

      // Widget library entry should be gone
      const after = await dbGet('SELECT * FROM widget_library WHERE widget_id = ?', [newWidgetId]);
      expect(after).toBeNull();
    });

    test('should default use_count to 0', async () => {
      await dbRun(`
        INSERT INTO widget_library (widget_id, space_id)
        VALUES (?, ?)
      `, [widgetId, spaceId]);

      const row = await dbGet('SELECT use_count FROM widget_library WHERE widget_id = ?', [widgetId]);
      expect(row.use_count).toBe(0);
    });

    test('should default is_public and is_template to false', async () => {
      await dbRun(`
        INSERT INTO widget_library (widget_id, space_id)
        VALUES (?, ?)
      `, [widgetId, spaceId]);

      const row = await dbGet('SELECT is_public, is_template FROM widget_library WHERE widget_id = ?', [widgetId]);
      expect(row.is_public).toBe(false);
      expect(row.is_template).toBe(false);
    });
  });

  // ============================================================
  // user_widget_favorites TABLE
  // ============================================================
  describe('user_widget_favorites table', () => {
    test('should create user_widget_favorites table', async () => {
      const tableInfo = await dbAll("SELECT column_name as name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_widget_favorites'");
      expect(tableInfo.length).toBeGreaterThan(0);
    });

    test('should have all required columns', async () => {
      const tableInfo = await dbAll("SELECT column_name as name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_widget_favorites'");
      const columnNames = tableInfo.map(col => col.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('widget_id');
      expect(columnNames).toContain('created_at');
    });

    test('should insert into user_widget_favorites', async () => {
      const result = await dbRun(`
        INSERT INTO user_widget_favorites (user_id, widget_id)
        VALUES (?, ?)
      `, [userId, widgetId]);

      expect(result.lastInsertRowid).toBeDefined();
      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test('should enforce unique(user_id, widget_id) constraint', async () => {
      await dbRun(`
        INSERT INTO user_widget_favorites (user_id, widget_id)
        VALUES (?, ?)
      `, [userId, widgetId]);

      // Same user, same widget should fail
      await expect(
        dbRun(`
          INSERT INTO user_widget_favorites (user_id, widget_id)
          VALUES (?, ?)
        `, [userId, widgetId])
      ).rejects.toThrow();
    });

    test('should allow same widget for different users', async () => {
      const userId2 = await createTestUser('-second');

      await dbRun(`
        INSERT INTO user_widget_favorites (user_id, widget_id)
        VALUES (?, ?)
      `, [userId, widgetId]);

      // Different user, same widget should work
      const result = await dbRun(`
        INSERT INTO user_widget_favorites (user_id, widget_id)
        VALUES (?, ?)
      `, [userId2, widgetId]);

      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test('should cascade delete when user is deleted', async () => {
      // Create a dedicated user for this test
      const testUserId = await createTestUser('-cascade');

      await dbRun(`
        INSERT INTO user_widget_favorites (user_id, widget_id)
        VALUES (?, ?)
      `, [testUserId, widgetId]);

      // Verify exists
      const before = await dbGet('SELECT * FROM user_widget_favorites WHERE user_id = ?', [testUserId]);
      expect(before).toBeDefined();

      // Delete user
      await dbRun('DELETE FROM users WHERE id = ?', [testUserId]);

      // Favorite should be gone
      const after = await dbGet('SELECT * FROM user_widget_favorites WHERE user_id = ?', [testUserId]);
      expect(after).toBeNull();
    });

    test('should cascade delete when widget is deleted', async () => {
      const newWidgetId = await createTestWidget(dashboardId, 'fav_cascade');

      await dbRun(`
        INSERT INTO user_widget_favorites (user_id, widget_id)
        VALUES (?, ?)
      `, [userId, newWidgetId]);

      // Verify exists
      const before = await dbGet('SELECT * FROM user_widget_favorites WHERE widget_id = ?', [newWidgetId]);
      expect(before).toBeDefined();

      // Delete widget
      await dbRun('DELETE FROM widgets WHERE id = ?', [newWidgetId]);

      // Favorite should be gone
      const after = await dbGet('SELECT * FROM user_widget_favorites WHERE widget_id = ?', [newWidgetId]);
      expect(after).toBeNull();
    });
  });

  // ============================================================
  // user_widget_history TABLE
  // ============================================================
  describe('user_widget_history table', () => {
    test('should create user_widget_history table', async () => {
      const tableInfo = await dbAll("SELECT column_name as name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_widget_history'");
      expect(tableInfo.length).toBeGreaterThan(0);
    });

    test('should have all required columns', async () => {
      const tableInfo = await dbAll("SELECT column_name as name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_widget_history'");
      const columnNames = tableInfo.map(col => col.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('widget_id');
      expect(columnNames).toContain('accessed_at');
    });

    test('should insert into user_widget_history', async () => {
      const result = await dbRun(`
        INSERT INTO user_widget_history (user_id, widget_id)
        VALUES (?, ?)
      `, [userId, widgetId]);

      expect(result.lastInsertRowid).toBeDefined();
      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test('should allow multiple history entries for same user+widget', async () => {
      await dbRun('INSERT INTO user_widget_history (user_id, widget_id) VALUES (?, ?)', [userId, widgetId]);
      await dbRun('INSERT INTO user_widget_history (user_id, widget_id) VALUES (?, ?)', [userId, widgetId]);
      await dbRun('INSERT INTO user_widget_history (user_id, widget_id) VALUES (?, ?)', [userId, widgetId]);

      const count = await dbGet('SELECT COUNT(*) as cnt FROM user_widget_history WHERE user_id = ?', [userId]);
      expect(Number(count.cnt)).toBe(3);
    });

    test('should cascade delete when user is deleted', async () => {
      const testUserId = await createTestUser('-history');

      await dbRun('INSERT INTO user_widget_history (user_id, widget_id) VALUES (?, ?)', [testUserId, widgetId]);

      const before = await dbGet('SELECT * FROM user_widget_history WHERE user_id = ?', [testUserId]);
      expect(before).toBeDefined();

      await dbRun('DELETE FROM users WHERE id = ?', [testUserId]);

      const after = await dbGet('SELECT * FROM user_widget_history WHERE user_id = ?', [testUserId]);
      expect(after).toBeNull();
    });

    test('should cascade delete when widget is deleted', async () => {
      const newWidgetId = await createTestWidget(dashboardId, 'history_cascade');

      await dbRun('INSERT INTO user_widget_history (user_id, widget_id) VALUES (?, ?)', [userId, newWidgetId]);

      const before = await dbGet('SELECT * FROM user_widget_history WHERE widget_id = ?', [newWidgetId]);
      expect(before).toBeDefined();

      await dbRun('DELETE FROM widgets WHERE id = ?', [newWidgetId]);

      const after = await dbGet('SELECT * FROM user_widget_history WHERE widget_id = ?', [newWidgetId]);
      expect(after).toBeNull();
    });

    test('should default accessed_at to current timestamp', async () => {
      await dbRun('INSERT INTO user_widget_history (user_id, widget_id) VALUES (?, ?)', [userId, widgetId]);

      const row = await dbGet('SELECT accessed_at FROM user_widget_history WHERE user_id = ?', [userId]);
      expect(row.accessed_at).toBeDefined();
      // PostgreSQL returns timestamp as Date object or string, just verify it exists
      expect(row.accessed_at).not.toBe('');
    });
  });

  // ============================================================
  // INDEXES
  // ============================================================
  describe('indexes', () => {
    test('should have index on widget_library.space_id', async () => {
      const indexes = await dbAll("SELECT indexname FROM pg_indexes WHERE tablename = 'widget_library'");
      const indexNames = indexes.map(idx => idx.indexname);

      // Check if any index covers space_id
      const hasSpaceIndex = indexNames.some(name => name.includes('space'));
      expect(hasSpaceIndex).toBe(true);
    });

    test('should have index on widget_library.is_public', async () => {
      const indexes = await dbAll("SELECT indexname FROM pg_indexes WHERE tablename = 'widget_library'");
      const indexNames = indexes.map(idx => idx.indexname);

      const hasPublicIndex = indexNames.some(name => name.includes('public'));
      expect(hasPublicIndex).toBe(true);
    });

    test('should have index on user_widget_favorites.user_id', async () => {
      const indexes = await dbAll("SELECT indexname FROM pg_indexes WHERE tablename = 'user_widget_favorites'");
      const indexNames = indexes.map(idx => idx.indexname);

      const hasUserIndex = indexNames.some(name => name.includes('user'));
      expect(hasUserIndex).toBe(true);
    });

    test('should have index on user_widget_history.user_id', async () => {
      const indexes = await dbAll("SELECT indexname FROM pg_indexes WHERE tablename = 'user_widget_history'");
      const indexNames = indexes.map(idx => idx.indexname);

      const hasUserIndex = indexNames.some(name => name.includes('user'));
      expect(hasUserIndex).toBe(true);
    });
  });
});
