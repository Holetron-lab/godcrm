/**
 * Widget Library Routes Tests - TDD (ADR-073)
 * Testing /api/v3/widget-library endpoints
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import widgetLibraryRoutes from '../widget-library.js';
import { createWidget } from '../../../services/WidgetService.js';
import { registerWidget, toggleFavorite, trackUsage } from '../../../services/WidgetLibraryService.js';
import { dbRun, destroyAdapter, resetAdapter, toBool } from '../../../database/connection.js';
// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock authentication middleware - inject user into req
  app.use((req, res, next) => {
    req.user = { id: req.headers['x-test-user-id'] ? parseInt(req.headers['x-test-user-id']) : 1 };
    next();
  });

  app.use('/api/v3', widgetLibraryRoutes);
  return app;
}

// Helper functions
async function createTestUser(suffix = '') {
  const uniqueEmail = `test-wl-route-${Date.now()}${suffix}@hltrn.cc`;
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

async function createTestWidget(dashboardId, options = {}) {
  const { title = 'Test Widget', presetName = 'table_view' } = options;
  return await createWidget({
    dashboard_id: dashboardId,
    widget_type: 'preset',
    preset_name: presetName,
    title,
    config: {},
    position: { x: 0, y: 0, w: 6, h: 4 }
  });
}

describe('Widget Library Routes - ADR-073', () => {
  let app;
  let userId;
  let spaceId;
  let projectId;
  let dashboardId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();

    app = createTestApp();
    userId = await createTestUser();
    spaceId = await createTestSpace(userId);
    projectId = await createTestProject(userId, spaceId);
    dashboardId = await createTestDashboard(projectId);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // GET /api/v3/widget-library
  // ============================================================
  describe('GET /api/v3/widget-library', () => {
    test('should return library widgets for space', async () => {
      const widget = await createTestWidget(dashboardId, { title: 'Sales Board' });
      await registerWidget(widget.id, spaceId);

      const res = await request(app)
        .get('/api/v3/widget-library')
        .query({ space_id: spaceId })
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].title).toBe('Sales Board');
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.categories).toBeDefined();
    });

    test('should require space_id query parameter', async () => {
      const res = await request(app)
        .get('/api/v3/widget-library')
        .set('x-test-user-id', userId)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('space_id');
    });

    test('should filter by category', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Widget 1' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Widget 2' });
      await registerWidget(widget1.id, spaceId);
      await registerWidget(widget2.id, spaceId);
      await toggleFavorite(userId, widget1.id);

      const res = await request(app)
        .get('/api/v3/widget-library')
        .query({ space_id: spaceId, category: 'favorites' })
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].widget_id).toBe(widget1.id);
    });

    test('should search by title', async () => {
      const widget1 = await createTestWidget(dashboardId, { title: 'Sales Pipeline' });
      const widget2 = await createTestWidget(dashboardId, { title: 'Tasks Board' });
      await registerWidget(widget1.id, spaceId);
      await registerWidget(widget2.id, spaceId);

      const res = await request(app)
        .get('/api/v3/widget-library')
        .query({ space_id: spaceId, search: 'Sales' })
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].title).toBe('Sales Pipeline');
    });

    test('should support pagination', async () => {
      // Create 5 widgets
      for (let i = 0; i < 5; i++) {
        const widget = await createTestWidget(dashboardId, { title: `Widget ${i}` });
        await registerWidget(widget.id, spaceId);
      }

      const res = await request(app)
        .get('/api/v3/widget-library')
        .query({ space_id: spaceId, limit: 2, offset: 0 })
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.total).toBe(5);
    });

    test('should include public widgets when include_public=true', async () => {
      // Create another space with public widget
      const otherUserId = await createTestUser('-other');
      const otherSpaceId = await createTestSpace(otherUserId, 'Other Space');
      const otherProjectId = await createTestProject(otherUserId, otherSpaceId);
      const otherDashboardId = await createTestDashboard(otherProjectId);
      const publicWidget = await createTestWidget(otherDashboardId, { title: 'Public Widget' });
      await registerWidget(publicWidget.id, otherSpaceId, { is_public: true });

      const res = await request(app)
        .get('/api/v3/widget-library')
        .query({ space_id: spaceId, include_public: true })
        .set('x-test-user-id', userId)
        .expect(200);

      const widgetIds = res.body.data.items.map(w => w.widget_id);
      expect(widgetIds).toContain(publicWidget.id);
    });
  });

  // ============================================================
  // GET /api/v3/widget-library/favorites
  // ============================================================
  describe('GET /api/v3/widget-library/favorites', () => {
    test('should return user favorites', async () => {
      const widget = await createTestWidget(dashboardId, { title: 'Favorite Widget' });
      await registerWidget(widget.id, spaceId);
      await toggleFavorite(userId, widget.id);

      const res = await request(app)
        .get('/api/v3/widget-library/favorites')
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Favorite Widget');
    });

    test('should return empty array when no favorites', async () => {
      const res = await request(app)
        .get('/api/v3/widget-library/favorites')
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });
  });

  // ============================================================
  // GET /api/v3/widget-library/recent
  // ============================================================
  describe('GET /api/v3/widget-library/recent', () => {
    test('should return recently used widgets', async () => {
      const widget = await createTestWidget(dashboardId, { title: 'Recent Widget' });
      await registerWidget(widget.id, spaceId);
      await trackUsage(userId, widget.id);

      const res = await request(app)
        .get('/api/v3/widget-library/recent')
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Recent Widget');
    });

    test('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        const widget = await createTestWidget(dashboardId, { title: `Widget ${i}` });
        await registerWidget(widget.id, spaceId);
        await trackUsage(userId, widget.id);
      }

      const res = await request(app)
        .get('/api/v3/widget-library/recent')
        .query({ limit: 3 })
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.data).toHaveLength(3);
    });
  });

  // ============================================================
  // POST /api/v3/widget-library/:widgetId/favorite
  // ============================================================
  describe('POST /api/v3/widget-library/:widgetId/favorite', () => {
    test('should toggle favorite on', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidget(widget.id, spaceId);

      const res = await request(app)
        .post(`/api/v3/widget-library/${widget.id}/favorite`)
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.is_favorite).toBe(true);
      expect(res.body.data.widget_id).toBe(widget.id);
    });

    test('should toggle favorite off', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidget(widget.id, spaceId);
      await toggleFavorite(userId, widget.id); // Add first

      const res = await request(app)
        .post(`/api/v3/widget-library/${widget.id}/favorite`)
        .set('x-test-user-id', userId)
        .expect(200);

      expect(res.body.data.is_favorite).toBe(false);
    });

    test('should return 404 for non-existent widget', async () => {
      const res = await request(app)
        .post('/api/v3/widget-library/99999/favorite')
        .set('x-test-user-id', userId)
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================
  // POST /api/v3/dashboards/:dashboardId/widgets/from-library
  // ============================================================
  describe('POST /api/v3/dashboards/:dashboardId/widgets/from-library', () => {
    test('should add widget as reference', async () => {
      const sourceWidget = await createTestWidget(dashboardId, { title: 'Source Widget', presetName: 'kanban_board' });
      await registerWidget(sourceWidget.id, spaceId);

      const targetDashboardId = (await dbRun(
        'INSERT INTO dashboards (project_id, name, is_default) VALUES (?, ?, ?)',
        [projectId, 'Target Dashboard', 0]
      )).lastInsertRowid;

      const res = await request(app)
        .post(`/api/v3/dashboards/${targetDashboardId}/widgets/from-library`)
        .set('x-test-user-id', userId)
        .send({
          source_widget_id: sourceWidget.id,
          mode: 'reference',
          position: { x: 0, y: 0, w: 6, h: 4 }
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.widget).toBeDefined();
      expect(res.body.data.widget.source_widget_id).toBe(sourceWidget.id);
      expect(res.body.data.mode_used).toBe('reference');
    });

    test('should add widget as copy', async () => {
      const sourceWidget = await createTestWidget(dashboardId, { title: 'Source Widget' });
      await registerWidget(sourceWidget.id, spaceId);

      const targetDashboardId = (await dbRun(
        'INSERT INTO dashboards (project_id, name, is_default) VALUES (?, ?, ?)',
        [projectId, 'Target Dashboard 2', 0]
      )).lastInsertRowid;

      const res = await request(app)
        .post(`/api/v3/dashboards/${targetDashboardId}/widgets/from-library`)
        .set('x-test-user-id', userId)
        .send({
          source_widget_id: sourceWidget.id,
          mode: 'copy',
          position: { x: 0, y: 0, w: 6, h: 4 }
        })
        .expect(201);

      expect(res.body.data.widget.source_widget_id).toBeNull();
      expect(res.body.data.mode_used).toBe('copy');
    });

    test('should require source_widget_id', async () => {
      const res = await request(app)
        .post(`/api/v3/dashboards/${dashboardId}/widgets/from-library`)
        .set('x-test-user-id', userId)
        .send({
          mode: 'reference',
          position: { x: 0, y: 0, w: 6, h: 4 }
        })
        .expect(400);

      expect(res.body.error.message).toContain('source_widget_id');
    });

    test('should require valid mode', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidget(widget.id, spaceId);

      const res = await request(app)
        .post(`/api/v3/dashboards/${dashboardId}/widgets/from-library`)
        .set('x-test-user-id', userId)
        .send({
          source_widget_id: widget.id,
          mode: 'invalid',
          position: { x: 0, y: 0, w: 6, h: 4 }
        })
        .expect(400);

      expect(res.body.error.message).toContain('Invalid mode');
    });

    test('should return 404 for non-existent dashboard', async () => {
      const widget = await createTestWidget(dashboardId);
      await registerWidget(widget.id, spaceId);

      const res = await request(app)
        .post('/api/v3/dashboards/99999/widgets/from-library')
        .set('x-test-user-id', userId)
        .send({
          source_widget_id: widget.id,
          mode: 'reference',
          position: { x: 0, y: 0, w: 6, h: 4 }
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    test('should return 404 for non-existent source widget', async () => {
      const res = await request(app)
        .post(`/api/v3/dashboards/${dashboardId}/widgets/from-library`)
        .set('x-test-user-id', userId)
        .send({
          source_widget_id: 99999,
          mode: 'reference',
          position: { x: 0, y: 0, w: 6, h: 4 }
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });
});
