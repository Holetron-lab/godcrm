/**
 * WidgetLibraryService Tests - TDD (ADR-073)
 * Testing widget library operations for the Widget Picker system
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  getLibraryWidgets,
  getFavorites,
  getRecent,
  toggleFavorite,
  trackUsage,
  addFromLibrary,
  registerWidget,
  unregisterWidget
} from '../WidgetLibraryService.js';
import { createWidget, getWidgetById } from '../WidgetService.js';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter, toBool } from '../../database/connection.js';
// Helper functions (matching existing test patterns)
async function createTestUser(suffix = '') {
  const uniqueEmail = `test-widgetlib-${Date.now()}${suffix}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)',
    [uniqueEmail, 'hash', 'Test User', 'encrypted_key', 1]
  );
  return result.lastInsertRowid;
}

async function createTestSpace(ownerId, name = 'Test Space') {
  const result = await dbRun(
    'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
    [ownerId, name, 'business']
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
    [projectId, 'Test Dashboard', toBool(true)]
  );
  return result.lastInsertRowid;
}

async function createTestTable(spaceId, name = 'Test Table') {
  const result = await dbRun(
    'INSERT INTO universal_tables (space_id, name, type) VALUES (?, ?, ?)',
    [spaceId, name, 'data']
  );
  return result.lastInsertRowid;
}

async function createTestWidget(dashboardId, options = {}) {
  const {
    presetName = 'table_view',
    title = `Widget ${presetName}`,
    tableId = null
  } = options;

  const config = tableId ? { table_id: tableId } : {};

  return await createWidget({
    dashboard_id: dashboardId,
    widget_type: 'preset',
    preset_name: presetName,
    title,
    config,
    position: { x: 0, y: 0, w: 6, h: 4 }
  });
}

async function registerWidgetInLibrary(widgetId, spaceId, options = {}) {
  const {
    is_public = false,
    is_template = false,
    tags = null
  } = options;

  const result = await dbRun(
    'INSERT INTO widget_library (widget_id, space_id, is_public, is_template, tags) VALUES (?, ?, ?, ?, ?)',
    [widgetId, spaceId, is_public ? 1 : 0, is_template ? 1 : 0, tags ? `{${tags.join(',')}}` : null]
  );
  return result.lastInsertRowid;
}

describe('WidgetLibraryService - ADR-073', () => {
  let userId;
  let spaceId;
  let projectId;
  let dashboardId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();

    userId = await createTestUser();
    spaceId = await createTestSpace(userId);
    projectId = await createTestProject(userId, spaceId);
    dashboardId = await createTestDashboard(projectId);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // getLibraryWidgets
  // ============================================================
  describe('getLibraryWidgets', () => {
    test('should return widgets from current space', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      const result = await getLibraryWidgets(spaceId, { userId });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].widget_id).toBe(widget.id);
      expect(result.items[0].is_own_space).toBe(true);
    });

    test('should include public widgets from other spaces when include_public=true', async () => {
      // Create another space with a public widget
      const otherUserId = await createTestUser('-other');
      const otherSpaceId = await createTestSpace(otherUserId, 'Other Space');
      const otherProjectId = await createTestProject(otherUserId, otherSpaceId);
      const otherDashboardId = await createTestDashboard(otherProjectId);
      const publicWidget = await createTestWidget(otherDashboardId, { title: 'Public Widget' });
      await registerWidgetInLibrary(publicWidget.id, otherSpaceId, { is_public: true });

      // Create local widget
      const localWidget = await createTestWidget(dashboardId, { title: 'Local Widget' });
      await registerWidgetInLibrary(localWidget.id, spaceId);

      const result = await getLibraryWidgets(spaceId, { userId, include_public: true });

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      const widgetIds = result.items.map(w => w.widget_id);
      expect(widgetIds).toContain(publicWidget.id);
      expect(widgetIds).toContain(localWidget.id);
    });

    test('should not include non-public widgets from other spaces', async () => {
      // Create another space with a private widget
      const otherUserId = await createTestUser('-other2');
      const otherSpaceId = await createTestSpace(otherUserId, 'Other Space 2');
      const otherProjectId = await createTestProject(otherUserId, otherSpaceId);
      const otherDashboardId = await createTestDashboard(otherProjectId);
      const privateWidget = await createTestWidget(otherDashboardId, { title: 'Private Widget' });
      await registerWidgetInLibrary(privateWidget.id, otherSpaceId, { is_public: false });

      const result = await getLibraryWidgets(spaceId, { userId, include_public: true });

      const widgetIds = result.items.map(w => w.widget_id);
      expect(widgetIds).not.toContain(privateWidget.id);
    });

    test('should filter by category favorites', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Widget 1' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Widget 2' });
      await registerWidgetInLibrary(widget1.id, spaceId);
      await registerWidgetInLibrary(widget2.id, spaceId);

      // Add widget1 to favorites
      await toggleFavorite(userId, widget1.id);

      const result = await getLibraryWidgets(spaceId, { userId, category: 'favorites' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].widget_id).toBe(widget1.id);
    });

    test('should filter by category recent', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Widget 1' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Widget 2' });
      await registerWidgetInLibrary(widget1.id, spaceId);
      await registerWidgetInLibrary(widget2.id, spaceId);

      // Track usage of widget1
      await trackUsage(userId, widget1.id);

      const result = await getLibraryWidgets(spaceId, { userId, category: 'recent' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].widget_id).toBe(widget1.id);
    });

    test('should filter by category this_space', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      const result = await getLibraryWidgets(spaceId, { userId, category: 'this_space' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].is_own_space).toBe(true);
    });

    test('should search by title', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Sales Dashboard' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Tasks Board' });
      await registerWidgetInLibrary(widget1.id, spaceId);
      await registerWidgetInLibrary(widget2.id, spaceId);

      const result = await getLibraryWidgets(spaceId, { userId, search: 'Sales' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Sales Dashboard');
    });

    test('should search by tags', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Widget 1' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Widget 2' });
      await registerWidgetInLibrary(widget1.id, spaceId, { tags: ['kanban', 'sales'] });
      await registerWidgetInLibrary(widget2.id, spaceId, { tags: ['table', 'contacts'] });

      const result = await getLibraryWidgets(spaceId, { userId, search: 'kanban' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].widget_id).toBe(widget1.id);
    });

    test('should include is_favorite flag for current user', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);
      await toggleFavorite(userId, widget.id);

      const result = await getLibraryWidgets(spaceId, { userId });

      expect(result.items[0].is_favorite).toBe(true);
    });

    test('should paginate results', async () => {
      // Create 5 widgets
      for (let i = 0; i < 5; i++) {
        const widget = await createTestWidget(dashboardId, { title: `Widget ${i}` });
        await registerWidgetInLibrary(widget.id, spaceId);
      }

      const page1 = await getLibraryWidgets(spaceId, { userId, limit: 2, offset: 0 });
      const page2 = await getLibraryWidgets(spaceId, { userId, limit: 2, offset: 2 });

      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page2.total).toBe(5);
    });

    test('should return categories counts', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Widget 1' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Widget 2' });
      await registerWidgetInLibrary(widget1.id, spaceId);
      await registerWidgetInLibrary(widget2.id, spaceId);
      await toggleFavorite(userId, widget1.id);
      await trackUsage(userId, widget2.id);

      const result = await getLibraryWidgets(spaceId, { userId });

      expect(result.categories).toBeDefined();
      expect(result.categories.favorites).toBe(1);
      expect(result.categories.recent).toBe(1);
      expect(result.categories.this_space).toBe(2);
    });
  });

  // ============================================================
  // toggleFavorite
  // ============================================================
  describe('toggleFavorite', () => {
    test('should add to favorites if not favorited', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      const result = await toggleFavorite(userId, widget.id);

      expect(result.is_favorite).toBe(true);

      // Verify in database
      const fav = await dbGet('SELECT * FROM user_widget_favorites WHERE user_id = ? AND widget_id = ?', [userId, widget.id]);
      expect(fav).toBeDefined();
    });

    test('should remove from favorites if already favorited', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      // Add to favorites first
      await toggleFavorite(userId, widget.id);
      // Then toggle again
      const result = await toggleFavorite(userId, widget.id);

      expect(result.is_favorite).toBe(false);

      // Verify removed from database
      const fav = await dbGet('SELECT * FROM user_widget_favorites WHERE user_id = ? AND widget_id = ?', [userId, widget.id]);
      expect(fav).toBeFalsy();
    });

    test('should return new favorite status', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      const result1 = await toggleFavorite(userId, widget.id);
      expect(result1.is_favorite).toBe(true);

      const result2 = await toggleFavorite(userId, widget.id);
      expect(result2.is_favorite).toBe(false);
    });

    test('should throw error for non-existent widget', async () => {
      await expect(toggleFavorite(userId, 99999))
        .rejects.toThrow('Widget not found');
    });
  });

  // ============================================================
  // trackUsage
  // ============================================================
  describe('trackUsage', () => {
    test('should increment use_count', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      const before = await dbGet('SELECT use_count FROM widget_library WHERE widget_id = ?', [widget.id]);
      expect(before.use_count).toBe(0);

      await trackUsage(userId, widget.id);

      const after = await dbGet('SELECT use_count FROM widget_library WHERE widget_id = ?', [widget.id]);
      expect(after.use_count).toBe(1);
    });

    test('should update last_used_at', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      const before = await dbGet('SELECT last_used_at FROM widget_library WHERE widget_id = ?', [widget.id]);
      expect(before.last_used_at).toBeNull();

      await trackUsage(userId, widget.id);

      const after = await dbGet('SELECT last_used_at FROM widget_library WHERE widget_id = ?', [widget.id]);
      expect(after.last_used_at).not.toBeNull();
    });

    test('should add entry to user_widget_history', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      await trackUsage(userId, widget.id);

      const history = await dbGet('SELECT * FROM user_widget_history WHERE user_id = ? AND widget_id = ?', [userId, widget.id]);
      expect(history).toBeDefined();
      expect(history.accessed_at).not.toBeNull();
    });

    test('should track multiple usages', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      await trackUsage(userId, widget.id);
      await trackUsage(userId, widget.id);
      await trackUsage(userId, widget.id);

      const lib = await dbGet('SELECT use_count FROM widget_library WHERE widget_id = ?', [widget.id]);
      expect(lib.use_count).toBe(3);

      const history = await dbAll('SELECT * FROM user_widget_history WHERE user_id = ? AND widget_id = ?', [userId, widget.id]);
      expect(history.length).toBe(3);
    });

    test('should throw error for non-existent widget', async () => {
      await expect(trackUsage(userId, 99999))
        .rejects.toThrow('Widget not found');
    });
  });

  // ============================================================
  // getFavorites
  // ============================================================
  describe('getFavorites', () => {
    test('should return user favorites', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Fav 1' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Not Fav' });
      await registerWidgetInLibrary(widget1.id, spaceId);
      await registerWidgetInLibrary(widget2.id, spaceId);

      await toggleFavorite(userId, widget1.id);

      const favorites = await getFavorites(userId);

      expect(favorites).toHaveLength(1);
      expect(favorites[0].widget_id).toBe(widget1.id);
    });

    test('should return empty array when no favorites', async () => {
      const favorites = await getFavorites(userId);
      expect(favorites).toEqual([]);
    });
  });

  // ============================================================
  // getRecent
  // ============================================================
  describe('getRecent', () => {
    test('should return recently used widgets', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Recent 1' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Not Recent' });
      await registerWidgetInLibrary(widget1.id, spaceId);
      await registerWidgetInLibrary(widget2.id, spaceId);

      await trackUsage(userId, widget1.id);

      const recent = await getRecent(userId);

      expect(recent).toHaveLength(1);
      expect(recent[0].widget_id).toBe(widget1.id);
    });

    test('should respect limit parameter', async () => {
      // Create and track usage for 5 widgets
      for (let i = 0; i < 5; i++) {
        const widget = await createTestWidget(dashboardId, { title: `Widget ${i}` });
        await registerWidgetInLibrary(widget.id, spaceId);
        await trackUsage(userId, widget.id);
      }

      const recent = await getRecent(userId, 3);

      expect(recent).toHaveLength(3);
    });

    test('should return empty array when no recent widgets', async () => {
      const recent = await getRecent(userId);
      expect(recent).toEqual([]);
    });

    test('should order by most recent first', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Widget 1' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Widget 2' });
      await registerWidgetInLibrary(widget1.id, spaceId);
      await registerWidgetInLibrary(widget2.id, spaceId);

      await trackUsage(userId, widget1.id);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await trackUsage(userId, widget2.id);

      const recent = await getRecent(userId);

      // Most recent (widget2) should be first
      expect(recent[0].widget_id).toBe(widget2.id);
    });
  });

  // ============================================================
  // addFromLibrary
  // ============================================================
  describe('addFromLibrary', () => {
    test('should create reference widget when mode=reference', async () => {
      const sourceWidget = await createTestWidget(dashboardId, { title: 'Source Widget', presetName: 'kanban_board' });
      await registerWidgetInLibrary(sourceWidget.id, spaceId);

      // Create another dashboard to add to
      const targetDashboardId = (await dbRun(
        'INSERT INTO dashboards (project_id, name, is_default) VALUES (?, ?, ?)',
        [projectId, 'Target Dashboard', 0]
      )).lastInsertRowid;

      const result = await addFromLibrary(targetDashboardId, sourceWidget.id, 'reference', { x: 0, y: 0, w: 6, h: 4 }, userId);

      expect(result.widget).toBeDefined();
      expect(result.widget.source_widget_id).toBe(sourceWidget.id);
      expect(result.widget.dashboard_id).toBe(targetDashboardId);
      expect(result.mode_used).toBe('reference');
    });

    test('should create copied widget when mode=copy', async () => {
      const sourceWidget = await createTestWidget(dashboardId, { title: 'Source Widget', presetName: 'table_view' });
      await registerWidgetInLibrary(sourceWidget.id, spaceId);

      const targetDashboardId = (await dbRun(
        'INSERT INTO dashboards (project_id, name, is_default) VALUES (?, ?, ?)',
        [projectId, 'Target Dashboard 2', 0]
      )).lastInsertRowid;

      const result = await addFromLibrary(targetDashboardId, sourceWidget.id, 'copy', { x: 0, y: 0, w: 6, h: 4 }, userId);

      expect(result.widget).toBeDefined();
      expect(result.widget.source_widget_id).toBeNull();
      expect(result.widget.title).toBe('Source Widget');
      expect(result.widget.preset_name).toBe('table_view');
      expect(result.mode_used).toBe('copy');
    });

    test('should track usage on add', async () => {
      const sourceWidget = await createTestWidget(dashboardId, { title: 'Source Widget' });
      await registerWidgetInLibrary(sourceWidget.id, spaceId);

      const targetDashboardId = (await dbRun(
        'INSERT INTO dashboards (project_id, name, is_default) VALUES (?, ?, ?)',
        [projectId, 'Target Dashboard 3', 0]
      )).lastInsertRowid;

      await addFromLibrary(targetDashboardId, sourceWidget.id, 'reference', { x: 0, y: 0, w: 6, h: 4 }, userId);

      const lib = await dbGet('SELECT use_count FROM widget_library WHERE widget_id = ?', [sourceWidget.id]);
      expect(lib.use_count).toBe(1);
    });

    test('should throw error for non-existent source widget', async () => {
      await expect(addFromLibrary(dashboardId, 99999, 'reference', { x: 0, y: 0, w: 6, h: 4 }, userId))
        .rejects.toThrow('Source widget not found');
    });

    test('should throw error for non-existent dashboard', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      await expect(addFromLibrary(99999, widget.id, 'reference', { x: 0, y: 0, w: 6, h: 4 }, userId))
        .rejects.toThrow('Dashboard not found');
    });

    test('should throw error for invalid mode', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidgetInLibrary(widget.id, spaceId);

      await expect(addFromLibrary(dashboardId, widget.id, 'invalid', { x: 0, y: 0, w: 6, h: 4 }, userId))
        .rejects.toThrow('Invalid mode');
    });
  });

  // ============================================================
  // registerWidget
  // ============================================================
  describe('registerWidget', () => {
    test('should register widget in library', async () => {
      const widget = await createTestWidget(dashboardId);

      const result = await registerWidget(widget.id, spaceId);

      expect(result).toBeDefined();
      expect(result.widget_id).toBe(widget.id);
      expect(result.space_id).toBe(spaceId);
    });

    test('should set is_public flag', async () => {
      const widget = await createTestWidget(dashboardId);

      const result = await registerWidget(widget.id, spaceId, { is_public: true });

      expect(result.is_public).toBeTruthy();
    });

    test('should set tags', async () => {
      const widget = await createTestWidget(dashboardId);

      const result = await registerWidget(widget.id, spaceId, { tags: ['kanban', 'sales'] });

      const tags = typeof result.tags === 'string' ? JSON.parse(result.tags) : result.tags;
      expect(tags).toEqual(['kanban', 'sales']);
    });

    test('should throw error for non-existent widget', async () => {
      await expect(registerWidget(99999, spaceId))
        .rejects.toThrow('Widget not found');
    });

    test('should throw error for non-existent space', async () => {
      const widget = await createTestWidget(dashboardId);

      await expect(registerWidget(widget.id, 99999))
        .rejects.toThrow('Space not found');
    });

    test('should throw error if widget already in library', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidget(widget.id, spaceId);

      await expect(registerWidget(widget.id, spaceId))
        .rejects.toThrow('already in library');
    });
  });

  // ============================================================
  // unregisterWidget
  // ============================================================
  describe('unregisterWidget', () => {
    test('should remove widget from library', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidget(widget.id, spaceId);

      await unregisterWidget(widget.id);

      const lib = await dbGet('SELECT * FROM widget_library WHERE widget_id = ?', [widget.id]);
      expect(lib).toBeFalsy();
    });

    test('should not delete the widget itself', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidget(widget.id, spaceId);

      await unregisterWidget(widget.id);

      const w = await getWidgetById(widget.id);
      expect(w).toBeDefined();
    });

    test('should throw error for widget not in library', async () => {
      const widget = await createTestWidget(dashboardId);

      await expect(unregisterWidget(widget.id))
        .rejects.toThrow('Widget not in library');
    });
  });
});
