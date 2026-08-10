/**
 * Widget API Routes Tests
 * Testing REST API endpoints for widgets
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import widgetRoutes from '../widgets.js';
import { dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
// Create test app
const app = express();
app.use(express.json());

// Mock authenticate middleware
app.use((req, res, next) => {
  req.user = { id: 1 };
  next();
});

app.use('/api/v3', widgetRoutes);

// Helper functions
async function createTestUser() {
  const uniqueEmail = `test-widgets-${Date.now()}@hltrn.cc`;
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

describe('Widget API Routes', () => {
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
  // GET /api/v3/dashboards/:dashboardId/widgets
  // ============================================================
  describe('GET /api/v3/dashboards/:dashboardId/widgets', () => {
    test('should return empty array for dashboard with no widgets', async () => {
      const response = await request(app)
        .get(`/api/v3/dashboards/${dashboardId}/widgets`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    test('should return all widgets for dashboard', async () => {
      // Create 2 widgets
      await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Widget 1', '{}', '{"x":0,"y":0,"w":6,"h":4}']);

      await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'project_stats', 'Widget 2', '{}', '{"x":6,"y":0,"w":6,"h":4}']);

      const response = await request(app)
        .get(`/api/v3/dashboards/${dashboardId}/widgets`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    test('should return 404 for non-existent dashboard', async () => {
      const response = await request(app)
        .get('/api/v3/dashboards/99999/widgets')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // POST /api/v3/dashboards/:dashboardId/widgets
  // ============================================================
  describe('POST /api/v3/dashboards/:dashboardId/widgets', () => {
    test('should create preset widget', async () => {
      const widgetData = {
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Active Clients',
        description: 'View all active clients',
        icon: '📊',
        config: { table_id: 1 },
        position: { x: 0, y: 0, w: 6, h: 4 }
      };

      const response = await request(app)
        .post(`/api/v3/dashboards/${dashboardId}/widgets`)
        .send(widgetData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.widget_type).toBe('preset');
      expect(response.body.data.preset_name).toBe('table_view');
      expect(response.body.data.title).toBe('Active Clients');
    });

    test('should create custom widget', async () => {
      const widgetData = {
        widget_type: 'custom',
        code: 'export default function() { return <div>Test</div>; }',
        title: 'Custom Widget',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      };

      const response = await request(app)
        .post(`/api/v3/dashboards/${dashboardId}/widgets`)
        .send(widgetData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.widget_type).toBe('custom');
      expect(response.body.data.code).toBeDefined();
    });

    test('should return 400 for missing widget_type', async () => {
      const response = await request(app)
        .post(`/api/v3/dashboards/${dashboardId}/widgets`)
        .send({ title: 'Test' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should return 400 for invalid widget_type', async () => {
      const response = await request(app)
        .post(`/api/v3/dashboards/${dashboardId}/widgets`)
        .send({
          widget_type: 'invalid',
          title: 'Test',
          config: {},
          position: { x: 0, y: 0, w: 6, h: 4 }
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // GET /api/v3/widgets/:widgetId
  // ============================================================
  describe('GET /api/v3/widgets/:widgetId', () => {
    test('should return widget by id', async () => {
      const result = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Test Widget', '{}', '{"x":0,"y":0,"w":6,"h":4}']);

      const response = await request(app)
        .get(`/api/v3/widgets/${result.lastInsertRowid}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('Test Widget');
    });

    test('should return 404 for non-existent widget', async () => {
      const response = await request(app)
        .get('/api/v3/widgets/99999')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // PATCH /api/v3/widgets/:widgetId
  // ============================================================
  describe('PATCH /api/v3/widgets/:widgetId', () => {
    test('should update widget title', async () => {
      const result = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Old Title', '{}', '{"x":0,"y":0,"w":6,"h":4}']);

      const response = await request(app)
        .patch(`/api/v3/widgets/${result.lastInsertRowid}`)
        .send({ title: 'New Title' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('New Title');
    });

    test('should update widget config', async () => {
      const result = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Test', '{"table_id":1}', '{"x":0,"y":0,"w":6,"h":4}']);

      const response = await request(app)
        .patch(`/api/v3/widgets/${result.lastInsertRowid}`)
        .send({ config: { table_id: 2, filters: [] } })
        .expect(200);

      expect(response.body.data.config.table_id).toBe(2);
    });

    test('should return 404 for non-existent widget', async () => {
      const response = await request(app)
        .patch('/api/v3/widgets/99999')
        .send({ title: 'New' })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    // ADR-0005 §C-11 — rename guard
    test('should reject rename when atom_refs_count > 0 without ?force', async () => {
      // 1. Create widget
      const widgetRes = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Old Title', '{}', '{"x":0,"y":0,"w":6,"h":4}']);
      const widgetId = widgetRes.lastInsertRowid;

      // 2. Insert an atoms_v2 row (table 3574) referencing this widget so
      //    countAtomRefs returns > 0.
      await dbRun(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `, [3574, `b_${Date.now()}`, JSON.stringify({ widget_ref: String(widgetId), document_id: 1 })]);

      const response = await request(app)
        .patch(`/api/v3/widgets/${widgetId}`)
        .send({ title: 'New Title' })
        .expect(409);

      expect(response.body.error).toBe('widget_in_use_rename');
      expect(response.body.atom_refs_count).toBeGreaterThanOrEqual(1);
      expect(response.body.hint).toMatch(/force=1/);
    });

    test('should allow rename when atom_refs_count > 0 and ?force=1', async () => {
      const widgetRes = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Old Title', '{}', '{"x":0,"y":0,"w":6,"h":4}']);
      const widgetId = widgetRes.lastInsertRowid;

      await dbRun(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `, [3574, `b_${Date.now()}_2`, JSON.stringify({ widget_ref: String(widgetId), document_id: 1 })]);

      const response = await request(app)
        .patch(`/api/v3/widgets/${widgetId}?force=1`)
        .send({ title: 'New Title' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('New Title');
    });

    test('should NOT block config-only update even with refs > 0', async () => {
      const widgetRes = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Stable Title', '{"table_id":1}', '{"x":0,"y":0,"w":6,"h":4}']);
      const widgetId = widgetRes.lastInsertRowid;

      await dbRun(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `, [3574, `b_${Date.now()}_3`, JSON.stringify({ widget_ref: String(widgetId), document_id: 1 })]);

      const response = await request(app)
        .patch(`/api/v3/widgets/${widgetId}`)
        .send({ config: { table_id: 99 } })
        .expect(200);

      expect(response.body.data.config.table_id).toBe(99);
    });

    test('should NOT block rename when atom_refs_count == 0', async () => {
      const widgetRes = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Lonely', '{}', '{"x":0,"y":0,"w":6,"h":4}']);
      const widgetId = widgetRes.lastInsertRowid;

      const response = await request(app)
        .patch(`/api/v3/widgets/${widgetId}`)
        .send({ title: 'Renamed Solo' })
        .expect(200);

      expect(response.body.data.title).toBe('Renamed Solo');
    });
  });

  // ============================================================
  // DELETE /api/v3/widgets/:widgetId
  // ============================================================
  describe('DELETE /api/v3/widgets/:widgetId', () => {
    test('should delete widget', async () => {
      const result = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Test', '{}', '{"x":0,"y":0,"w":6,"h":4}']);

      await request(app)
        .delete(`/api/v3/widgets/${result.lastInsertRowid}`)
        .expect(204);

      // Verify deleted
      const getResponse = await request(app)
        .get(`/api/v3/widgets/${result.lastInsertRowid}`)
        .expect(404);
    });

    test('should return 404 for non-existent widget', async () => {
      const response = await request(app)
        .delete('/api/v3/widgets/99999')
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // PATCH /api/v3/widgets/:widgetId/code
  // ============================================================
  describe('PATCH /api/v3/widgets/:widgetId/code', () => {
    test('should update custom widget code', async () => {
      const result = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, code, title, config, position, code_version)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'custom', 'const v1 = true;', 'Test', '{}', '{"x":0,"y":0,"w":6,"h":4}', 1]);

      const response = await request(app)
        .patch(`/api/v3/widgets/${result.lastInsertRowid}/code`)
        .send({ code: 'const v2 = true;' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.code).toBe('const v2 = true;');
      expect(response.body.data.code_version).toBe(2);
    });

    test('should return 400 for preset widget', async () => {
      const result = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Test', '{}', '{"x":0,"y":0,"w":6,"h":4}']);

      const response = await request(app)
        .patch(`/api/v3/widgets/${result.lastInsertRowid}/code`)
        .send({ code: 'new code' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should return 400 for empty code', async () => {
      const result = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, code, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'custom', 'const v1 = true;', 'Test', '{}', '{"x":0,"y":0,"w":6,"h":4}']);

      const response = await request(app)
        .patch(`/api/v3/widgets/${result.lastInsertRowid}/code`)
        .send({ code: '' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ============================================================
  // GET /api/v3/widgets/:widgetId/data
  // ============================================================
  describe('GET /api/v3/widgets/:widgetId/data', () => {
    test('should return widget data', async () => {
      // Create table
      const tableResult = await dbRun(
        'INSERT INTO universal_tables (project_id, name) VALUES (?, ?)',
        [projectId, 'Test Table']
      );

      // Create widget
      const widgetResult = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'table_view', 'Test', JSON.stringify({ table_id: tableResult.lastInsertRowid }), '{"x":0,"y":0,"w":6,"h":4}']);

      // Insert test row
      await dbRun(
        'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
        [tableResult.lastInsertRowid, 'test_id', JSON.stringify({ name: 'Test' })]
      );

      const response = await request(app)
        .get(`/api/v3/widgets/${widgetResult.lastInsertRowid}/data`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });

    test('should return empty array for widget without table_id', async () => {
      const result = await dbRun(`
        INSERT INTO widgets (dashboard_id, widget_type, preset_name, title, config, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [dashboardId, 'preset', 'project_stats', 'Test', '{}', '{"x":0,"y":0,"w":6,"h":4}']);

      const response = await request(app)
        .get(`/api/v3/widgets/${result.lastInsertRowid}/data`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });
  });

  // ============================================================
  // GET /api/v3/widgets/presets
  // ============================================================
  describe('GET /api/v3/widgets/presets', () => {
    test('should return all presets', async () => {
      const response = await request(app)
        .get('/api/v3/widgets/presets')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    test('presets should have required fields', async () => {
      const response = await request(app)
        .get('/api/v3/widgets/presets')
        .expect(200);

      response.body.data.forEach(preset => {
        expect(preset).toHaveProperty('id');
        expect(preset).toHaveProperty('name');
        expect(preset).toHaveProperty('description');
        expect(preset).toHaveProperty('icon');
      });
    });
  });
});
