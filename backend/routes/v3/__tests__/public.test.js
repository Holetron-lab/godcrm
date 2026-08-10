/**
 * Public Routes Tests (v3) - ADR-0060 P1
 *
 * Tests for /api/v3/public/s/:slug/tree, /tables/:tableId, /tables/:tableId/rows.
 *
 * The public middleware (publicAbuseGuard + publicRateLimit + publicSpaceAccess)
 * is included as-is — we exercise the real chain so the test reflects the
 * production behavior. Each test creates an external space with a unique slug,
 * flips entity-level is_public flags, then asserts the projected shape.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import publicRoutes from '../public.js';
import { __resetPublicAccessForTests } from '../../../middleware/publicAccess.js';
import {
  dbRun,
  destroyAdapter,
  resetAdapter
} from '../../../database/connection.js';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v3/public', publicRoutes);

async function createTestUser() {
  const email = `test-public-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)',
    [email, 'hash', 'Test User', 'encrypted_key', 1]
  );
  return result.lastInsertRowid;
}

async function createExternalSpace(ownerId, slug) {
  // visibility='external' + public_slug is what publicSpaceAccess looks up.
  const result = await dbRun(
    `INSERT INTO spaces (owner_id, name, type, visibility, public_slug)
     VALUES (?, ?, ?, ?, ?)`,
    [ownerId, 'Public Test Space', 'business', 'external', slug]
  );
  return result.lastInsertRowid;
}

async function createProject(ownerId, spaceId, isPublic = false) {
  const r = await dbRun(
    `INSERT INTO projects (owner_id, space_id, name, type, is_public)
     VALUES (?, ?, ?, ?, ?)`,
    [ownerId, spaceId, 'Test Project', 'business', isPublic]
  );
  return r.lastInsertRowid;
}

async function createTable(projectId, isPublic = false, name = 'test_table') {
  const r = await dbRun(
    `INSERT INTO universal_tables (project_id, name, display_name, is_public)
     VALUES (?, ?, ?, ?)`,
    [projectId, name, name, isPublic]
  );
  return r.lastInsertRowid;
}

async function createColumn(tableId, columnName, type, configObj = {}) {
  const r = await dbRun(
    `INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tableId, columnName, columnName, type, JSON.stringify(configObj), 0, 1]
  );
  return r.lastInsertRowid;
}

async function createRow(tableId, data) {
  const baseId = `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const r = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_by)
     VALUES (?, ?, ?, ?)`,
    [tableId, baseId, JSON.stringify(data), 1]
  );
  return r.lastInsertRowid;
}

async function createDashboard(projectId, isPublic = true, name = 'Test Dashboard') {
  const r = await dbRun(
    `INSERT INTO dashboards (project_id, name, is_public)
     VALUES (?, ?, ?)`,
    [projectId, name, isPublic]
  );
  return r.lastInsertRowid;
}

async function createWidget(dashboardId, {
  presetName = 'table_view',
  title = 'W',
  config = {},
  isPublic = true,
  isTemplate = false,
  ownerId = 1
} = {}) {
  const r = await dbRun(
    `INSERT INTO widgets
       (dashboard_id, widget_type, preset_name, title, config, position,
        is_public, is_template, owner_kind, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dashboardId, 'preset', presetName, title,
      JSON.stringify(config),
      JSON.stringify({ x: 0, y: 0, w: 6, h: 4 }),
      isPublic, isTemplate, 'user', ownerId
    ]
  );
  return r.lastInsertRowid;
}

describe('Public API Routes (v3) - ADR-0060 P1', () => {
  let userId;
  let slug;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();

    // Schema-evolution gap shims (mirrors patterns in spaces.test.js).
    for (const col of [
      'visibility TEXT',
      'public_slug TEXT',
      'public_password_hash TEXT'
    ]) {
      try { await dbRun(`ALTER TABLE spaces ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    for (const col of [
      'is_public BOOLEAN NOT NULL DEFAULT FALSE',
      'order_index INTEGER DEFAULT 0'
    ]) {
      try { await dbRun(`ALTER TABLE projects ADD COLUMN ${col}`); } catch { /* exists */ }
    }
    for (const col of ['is_public BOOLEAN NOT NULL DEFAULT FALSE']) {
      try { await dbRun(`ALTER TABLE universal_tables ADD COLUMN ${col}`); } catch { /* exists */ }
      try { await dbRun(`ALTER TABLE dashboards ADD COLUMN ${col}`); } catch { /* exists */ }
      try { await dbRun(`ALTER TABLE widgets ADD COLUMN ${col}`); } catch { /* exists */ }
    }

    userId = await createTestUser();
    slug = `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    // Reset rate-limit counters AND the abuse-strike store so a long test
    // file doesn't accumulate 90 req → IP block. publicAccess.js exports a
    // test-only helper that clears both module-local stores.
    __resetPublicAccessForTests();

    // ADR-0060 Fat-P5: clean leftover template widgets — the partial UNIQUE
    // index `widgets_template_preset_unique_idx` is global on
    // (preset_name) WHERE is_template = true and persists across runs.
    try { await dbRun(`DELETE FROM widgets WHERE is_template = true`); } catch { /* ignore */ }
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // GET /api/v3/public/s/:slug/tree
  // ============================================================

  describe('GET /s/:slug/tree', () => {
    test('returns empty projects[] for a freshly-created public space', async () => {
      await createExternalSpace(userId, slug);

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tree`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.projects).toEqual([]);
      expect(res.body.data.space.public_slug).toBe(slug);
    });

    test('returns project when projects.is_public=true', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      await createProject(userId, spaceId, /* isPublic */ true);

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tree`)
        .expect(200);

      expect(res.body.data.projects.length).toBe(1);
      expect(res.body.data.projects[0].is_public).toBe(true);
      expect(res.body.data.projects[0].tables).toEqual([]);
      expect(res.body.data.projects[0].dashboards).toEqual([]);
      expect(res.body.data.projects[0].widgets).toEqual([]);
    });

    test('omits project when only the table is flipped but project is not', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, /* isPublic */ false);
      await createTable(projectId, /* isPublic */ true);

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tree`)
        .expect(200);

      // Project is not public → entire subtree must be absent.
      expect(res.body.data.projects).toEqual([]);
    });

    test('includes only public tables under public projects', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const publicTableId = await createTable(projectId, true, 'pub_tbl');
      await createTable(projectId, false, 'priv_tbl');

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tree`)
        .expect(200);

      const proj = res.body.data.projects[0];
      expect(proj.tables.length).toBe(1);
      expect(proj.tables[0].id).toBe(publicTableId);
    });
  });

  // ============================================================
  // GET /api/v3/public/s/:slug/tables/:tableId
  // ============================================================

  describe('GET /s/:slug/tables/:tableId', () => {
    test('returns 404 when table exists but is_public=false', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const tableId = await createTable(projectId, /* isPublic */ false);

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${tableId}`)
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    test('opt-out model: columns with no flag are public, only is_public=false is hidden', async () => {
      // ADR-0060 pivot (commit 8094af43): isColumnPublic is opt-out. A column
      // is visible unless config.is_public === false. The previous opt-in
      // assertion would expect [] but is_public-unset columns are now public.
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const tableId = await createTable(projectId, true);
      await createColumn(tableId, 'secret', 'text', { is_public: false });
      await createColumn(tableId, 'no_flag', 'text', {});

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${tableId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.columns.length).toBe(1);
      expect(res.body.data.columns[0].name).toBe('no_flag');
      expect(res.body.data.table.id).toBe(tableId);
    });

    test('returns whitelisted columns only', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const tableId = await createTable(projectId, true);
      await createColumn(tableId, 'public_col', 'text', { is_public: true });
      await createColumn(tableId, 'private_col', 'text', { is_public: false });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${tableId}`)
        .expect(200);

      expect(res.body.data.columns.length).toBe(1);
      expect(res.body.data.columns[0].name).toBe('public_col');
      // settings projection must NOT leak internal config flags.
      expect(res.body.data.columns[0].settings.is_public).toBe(true);
    });

    test('returns 404 for table in a different space (cross-space leak guard)', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      await createProject(userId, spaceId, true);

      // A second, unrelated space with its own table.
      const otherSlug = `oth-${Date.now().toString(36)}`;
      const otherSpaceId = await createExternalSpace(userId, otherSlug);
      const otherProjectId = await createProject(userId, otherSpaceId, true);
      const otherTableId = await createTable(otherProjectId, true);

      // Request via the first slug must 404 on the other space's table.
      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${otherTableId}`)
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================
  // GET /api/v3/public/s/:slug/tables/:tableId/rows
  // ============================================================

  describe('GET /s/:slug/tables/:tableId/rows', () => {
    test('clamps limit to [1, 500]', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const tableId = await createTable(projectId, true);
      const colId = await createColumn(tableId, 'name', 'text', { is_public: true });
      // Seed a couple of rows.
      await createRow(tableId, { [colId]: 'alice' });
      await createRow(tableId, { [colId]: 'bob' });

      // Limit too high — must clamp to ≤500 (we just assert it doesn't error
      // and returns the available rows).
      const tooHigh = await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${tableId}/rows?limit=9999`)
        .expect(200);
      expect(tooHigh.body.data.rows.length).toBeLessThanOrEqual(500);
      expect(tooHigh.body.data.total).toBe(2);

      // Limit too low (0) — must clamp to ≥1.
      const tooLow = await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${tableId}/rows?limit=0`)
        .expect(200);
      expect(tooLow.body.data.rows.length).toBeLessThanOrEqual(1);
      expect(tooLow.body.data.total).toBe(2);
    });

    test('returns 404 for non-public table rows', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const tableId = await createTable(projectId, /* isPublic */ false);

      await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${tableId}/rows`)
        .expect(404);
    });

    test('row data contains only whitelisted columns', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const tableId = await createTable(projectId, true);
      const pubColId = await createColumn(tableId, 'name', 'text', { is_public: true });
      const privColId = await createColumn(tableId, 'secret', 'text', { is_public: false });
      await createRow(tableId, { [pubColId]: 'alice', [privColId]: 'leaked?' });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/tables/${tableId}/rows`)
        .expect(200);

      expect(res.body.data.rows.length).toBe(1);
      expect(res.body.data.rows[0].data.name).toBe('alice');
      expect(res.body.data.rows[0].data.secret).toBeUndefined();
    });
  });

  // ============================================================
  // ADR-0060 §Fat-P5 / AC10+AC11+AC14 — Widget surface
  // GET /api/v3/public/s/:slug/projects/:projectId
  // GET /api/v3/public/s/:slug/dashboards/:dashboardId
  // GET /api/v3/public/s/:slug/widgets/:widgetId
  // GET /api/v3/public/s/:slug/widgets/:widgetId/data
  // ============================================================

  describe('GET /s/:slug/projects/:projectId', () => {
    test('returns project + default dashboard id when project is public', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, /* isPublic */ true);
      const dashboardId = await createDashboard(projectId, true, 'Main');

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/projects/${projectId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.project.id).toBe(projectId);
      expect(res.body.data.dashboard_id).toBe(dashboardId);
    });

    test('returns 404 when project.is_public=false', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, /* isPublic */ false);
      await createDashboard(projectId, true);

      await request(app)
        .get(`/api/v3/public/s/${slug}/projects/${projectId}`)
        .expect(404);
    });

    test('returns 404 for project belonging to a different space', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      await createProject(userId, spaceId, true);
      const otherSlug = `oth-${Date.now().toString(36)}`;
      const otherSpaceId = await createExternalSpace(userId, otherSlug);
      const otherProjectId = await createProject(userId, otherSpaceId, true);

      await request(app)
        .get(`/api/v3/public/s/${slug}/projects/${otherProjectId}`)
        .expect(404);
    });

    test('dashboard_id is null when project has no public dashboards', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      // Create dashboard but mark it private — should not surface.
      await createDashboard(projectId, /* isPublic */ false);

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/projects/${projectId}`)
        .expect(200);

      expect(res.body.data.dashboard_id).toBeNull();
    });
  });

  describe('GET /s/:slug/dashboards/:dashboardId', () => {
    test('returns dashboard + whitelisted widgets only', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const tableId = await createTable(projectId, true);

      // Two whitelisted, one not whitelisted, one is_public=false.
      const wTable = await createWidget(dashboardId, {
        presetName: 'table_view', title: 'T', config: { table_id: tableId }
      });
      const wKanban = await createWidget(dashboardId, {
        presetName: 'kanban_board', title: 'K', config: { table_id: tableId }
      });
      await createWidget(dashboardId, {
        presetName: 'documents', title: 'D', config: { table_id: tableId }
      });
      await createWidget(dashboardId, {
        presetName: 'table_view', title: 'Hidden', config: { table_id: tableId },
        isPublic: false
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/dashboards/${dashboardId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.dashboard.id).toBe(dashboardId);
      const ids = res.body.data.widgets.map(w => w.id).sort();
      expect(ids).toEqual([wTable, wKanban].sort());
      expect(res.body.data.widget_ids.sort()).toEqual([wTable, wKanban].sort());
    });

    test('returns 404 when dashboard.is_public=false', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, /* isPublic */ false);

      await request(app)
        .get(`/api/v3/public/s/${slug}/dashboards/${dashboardId}`)
        .expect(404);
    });

    test('returns 404 when parent project.is_public=false (cascade gate)', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, /* isPublic */ false);
      const dashboardId = await createDashboard(projectId, /* isPublic */ true);

      await request(app)
        .get(`/api/v3/public/s/${slug}/dashboards/${dashboardId}`)
        .expect(404);
    });

    test('returns 404 for dashboard in a different space', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      await createDashboard(projectId, true);
      const otherSlug = `oth-${Date.now().toString(36)}`;
      const otherSpaceId = await createExternalSpace(userId, otherSlug);
      const otherProjectId = await createProject(userId, otherSpaceId, true);
      const otherDashboardId = await createDashboard(otherProjectId, true);

      await request(app)
        .get(`/api/v3/public/s/${slug}/dashboards/${otherDashboardId}`)
        .expect(404);
    });
  });

  describe('GET /s/:slug/widgets/:widgetId', () => {
    test('returns scrubbed widget with table_id lifted to top level', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const tableId = await createTable(projectId, true);
      const widgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        title: 'Active Clients',
        config: {
          table_id: tableId,
          // Sensitive keys MUST be stripped:
          webhook_secret: 'shhh',
          created_by: 1,
          email_to: 'a@b.c'
        }
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      const w = res.body.data.widget;
      expect(w.id).toBe(widgetId);
      expect(w.type).toBe('table_view');
      expect(w.name).toBe('Active Clients');
      expect(w.table_id).toBe(tableId);
      // Scrubber stripped sensitive keys:
      expect(w.view_config.webhook_secret).toBeUndefined();
      expect(w.view_config.created_by).toBeUndefined();
      expect(w.view_config.email_to).toBeUndefined();
      expect(w.view_config.table_id).toBe(tableId);
    });

    test('returns 404 for non-whitelisted preset (AC11 default-deny)', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const tableId = await createTable(projectId, true);
      const widgetId = await createWidget(dashboardId, {
        presetName: 'documents',           // NOT in PUBLIC_PRESET_WHITELIST
        config: { table_id: tableId }
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}`)
        .expect(404);
    });

    test('returns 404 when widget.is_public=false even with public parent', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const tableId = await createTable(projectId, true);
      const widgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        config: { table_id: tableId },
        isPublic: false
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}`)
        .expect(404);
    });

    test('returns 404 when widget references a non-public table (FK gate)', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const privateTableId = await createTable(projectId, /* isPublic */ false, 'priv');
      const widgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        config: { table_id: privateTableId }
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}`)
        .expect(404);
    });

    test('returns 404 for widget in a different space', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      await createDashboard(projectId, true);

      const otherSlug = `oth-${Date.now().toString(36)}`;
      const otherSpaceId = await createExternalSpace(userId, otherSlug);
      const otherProjectId = await createProject(userId, otherSpaceId, true);
      const otherDashboardId = await createDashboard(otherProjectId, true);
      const otherTableId = await createTable(otherProjectId, true);
      const otherWidgetId = await createWidget(otherDashboardId, {
        presetName: 'table_view',
        config: { table_id: otherTableId }
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${otherWidgetId}`)
        .expect(404);
    });

    test('returns 404 for templates (is_template=true never public)', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const tableId = await createTable(projectId, true);
      const widgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        config: { table_id: tableId },
        isTemplate: true
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}`)
        .expect(404);
    });
  });

  describe('GET /s/:slug/widgets/:widgetId/data', () => {
    test('returns paginated rows from the widget\'s referenced table', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const tableId = await createTable(projectId, true);
      const colId = await createColumn(tableId, 'name', 'text', { is_public: true });
      await createRow(tableId, { [colId]: 'alice' });
      await createRow(tableId, { [colId]: 'bob' });
      const widgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        config: { table_id: tableId }
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}/data`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.table_id).toBe(tableId);
      expect(res.body.data.rows.length).toBe(2);
      const names = res.body.data.rows.map(r => r.data.name).sort();
      expect(names).toEqual(['alice', 'bob']);
    });

    test('honors row-level column whitelist (AC14 d)', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const tableId = await createTable(projectId, true);
      const pubColId = await createColumn(tableId, 'name', 'text', { is_public: true });
      const privColId = await createColumn(tableId, 'secret', 'text', { is_public: false });
      await createRow(tableId, { [pubColId]: 'alice', [privColId]: 'leaked?' });
      const widgetId = await createWidget(dashboardId, {
        presetName: 'kanban_board',
        config: { table_id: tableId }
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}/data`)
        .expect(200);

      expect(res.body.data.rows[0].data.name).toBe('alice');
      expect(res.body.data.rows[0].data.secret).toBeUndefined();
    });

    test('clamps limit to [1, 500] and offset to [0, ∞)', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const tableId = await createTable(projectId, true);
      const colId = await createColumn(tableId, 'name', 'text', { is_public: true });
      await createRow(tableId, { [colId]: 'a' });
      const widgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        config: { table_id: tableId }
      });

      const high = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}/data?limit=9999`)
        .expect(200);
      expect(high.body.data.rows.length).toBeLessThanOrEqual(500);

      const low = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}/data?limit=-5`)
        .expect(200);
      expect(low.body.data.rows.length).toBeLessThanOrEqual(1);
    });

    test('returns 404 when widget references a non-public table', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const privateTableId = await createTable(projectId, /* isPublic */ false);
      const widgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        config: { table_id: privateTableId }
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}/data`)
        .expect(404);
    });

    test('returns empty rows + null table_id when widget config has no table ref', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const widgetId = await createWidget(dashboardId, {
        presetName: 'table_view',
        config: {} // no table_id at all
      });

      const res = await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}/data`)
        .expect(200);

      expect(res.body.data.rows).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.table_id).toBeNull();
    });

    test('returns 404 for non-whitelisted preset (no data leak via /data)', async () => {
      const spaceId = await createExternalSpace(userId, slug);
      const projectId = await createProject(userId, spaceId, true);
      const dashboardId = await createDashboard(projectId, true);
      const tableId = await createTable(projectId, true);
      const widgetId = await createWidget(dashboardId, {
        presetName: 'documents',
        config: { table_id: tableId }
      });

      await request(app)
        .get(`/api/v3/public/s/${slug}/widgets/${widgetId}/data`)
        .expect(404);
    });
  });
});
