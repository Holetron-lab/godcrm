/**
 * Module API Routes Tests - ADR-065
 * Testing REST API endpoints for sidebar modules
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import moduleRoutes from '../modules.js';
import { dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
// Create test app
const app = express();
app.use(express.json());

// Mock authenticate middleware
app.use((req, res, next) => {
  req.user = { id: 1 };
  next();
});

app.use('/api/v3', moduleRoutes);

// Helper functions
async function createTestUser() {
  const uniqueEmail = `test-modules-${Date.now()}@hltrn.cc`;
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

describe('Module API Routes - ADR-065', () => {
  let userId, spaceId, projectId, dashboardId;

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
  // GET /api/v3/spaces/:spaceId/modules
  // ============================================================
  describe('GET /api/v3/spaces/:spaceId/modules', () => {
    test('should return empty array for space with no modules', async () => {
      const response = await request(app)
        .get(`/api/v3/spaces/${spaceId}/modules`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    test('should return all modules for space', async () => {
      const widgetId1 = await createTestWidget(dashboardId, 'table_view');
      const widgetId2 = await createTestWidget(dashboardId, 'kanban_board');

      // Register as modules via POST
      await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: widgetId1, sidebar_order: 0 })
        .expect(201);

      await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: widgetId2, sidebar_order: 1 })
        .expect(201);

      const response = await request(app)
        .get(`/api/v3/spaces/${spaceId}/modules`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].widget).toBeDefined();
      expect(response.body.data[1].widget).toBeDefined();
    });
  });

  // ============================================================
  // GET /api/v3/modules/:moduleId
  // ============================================================
  describe('GET /api/v3/modules/:moduleId', () => {
    test('should return module by id', async () => {
      const widgetId = await createTestWidget(dashboardId);

      const createRes = await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: widgetId, sidebar_order: 2, access_level: 'admin' })
        .expect(201);

      const moduleId = createRes.body.data.module_id;

      const response = await request(app)
        .get(`/api/v3/modules/${moduleId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.module_id).toBe(moduleId);
      expect(response.body.data.sidebar_order).toBe(2);
      expect(response.body.data.access_level).toBe('admin');
      expect(response.body.data.widget).toBeDefined();
    });

    test('should return 404 for non-existent module', async () => {
      const response = await request(app)
        .get('/api/v3/modules/99999')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // POST /api/v3/spaces/:spaceId/modules
  // ============================================================
  describe('POST /api/v3/spaces/:spaceId/modules', () => {
    test('should register widget as module', async () => {
      const widgetId = await createTestWidget(dashboardId);

      const response = await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({
          widget_id: widgetId,
          sidebar_order: 1,
          sidebar_icon: 'flask',
          access_level: 'member'
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.module_id).toBeDefined();
      expect(response.body.data.widget_id).toBe(widgetId);
      expect(response.body.data.sidebar_order).toBe(1);
      expect(response.body.data.sidebar_icon).toBe('flask');
    });

    test('should return 400 when widget_id missing', async () => {
      const response = await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ sidebar_order: 1 })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should return 404 for non-existent widget', async () => {
      const response = await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: 99999 })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should return 400 for invalid access_level', async () => {
      const widgetId = await createTestWidget(dashboardId);

      const response = await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: widgetId, access_level: 'superadmin' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should return 400 for already registered widget', async () => {
      const widgetId = await createTestWidget(dashboardId);

      await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: widgetId })
        .expect(201);

      const response = await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: widgetId })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // PATCH /api/v3/modules/:moduleId
  // ============================================================
  describe('PATCH /api/v3/modules/:moduleId', () => {
    test('should update module metadata', async () => {
      const widgetId = await createTestWidget(dashboardId);

      const createRes = await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: widgetId, sidebar_order: 0 })
        .expect(201);

      const moduleId = createRes.body.data.module_id;

      const response = await request(app)
        .patch(`/api/v3/modules/${moduleId}`)
        .send({ sidebar_order: 5, access_level: 'viewer', sidebar_icon: 'star' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.sidebar_order).toBe(5);
      expect(response.body.data.access_level).toBe('viewer');
      expect(response.body.data.sidebar_icon).toBe('star');
    });

    test('should return 404 for non-existent module', async () => {
      const response = await request(app)
        .patch('/api/v3/modules/99999')
        .send({ sidebar_order: 1 })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    test('should return 400 for invalid access_level', async () => {
      const widgetId = await createTestWidget(dashboardId);

      const createRes = await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: widgetId })
        .expect(201);

      const moduleId = createRes.body.data.module_id;

      const response = await request(app)
        .patch(`/api/v3/modules/${moduleId}`)
        .send({ access_level: 'invalid' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // DELETE /api/v3/modules/:moduleId
  // ============================================================
  describe('DELETE /api/v3/modules/:moduleId', () => {
    test('should delete module and return 204', async () => {
      const widgetId = await createTestWidget(dashboardId);

      const createRes = await request(app)
        .post(`/api/v3/spaces/${spaceId}/modules`)
        .send({ widget_id: widgetId })
        .expect(201);

      const moduleId = createRes.body.data.module_id;

      await request(app)
        .delete(`/api/v3/modules/${moduleId}`)
        .expect(204);

      // Verify deleted
      await request(app)
        .get(`/api/v3/modules/${moduleId}`)
        .expect(404);
    });

    test('should return 404 for non-existent module', async () => {
      const response = await request(app)
        .delete('/api/v3/modules/99999')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });
});
