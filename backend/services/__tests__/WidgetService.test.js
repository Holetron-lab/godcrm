/**
 * WidgetService Tests - TDD Approach
 * Phase 1.2: Testing widget CRUD operations
 * 
 * 🔴 RED → 🟢 GREEN → 🔵 REFACTOR
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  createWidget,
  getWidgetById,
  getWidgetsByDashboard,
  updateWidget,
  updateWidgetCode,
  deleteWidget,
  getWidgetData
} from '../WidgetService.js';
import { createModule } from '../ModuleService.js';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter, toBool } from '../../database/connection.js';
// Helper function to create test user
async function createTestUser() {
  const uniqueEmail = `test-widgetservice-${Date.now()}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)',
    [uniqueEmail, 'hash', 'Test User', 'encrypted_key', 1]
  );
  return result.lastInsertRowid;
}

// Helper function to create test space
async function createTestSpace(ownerId) {
  const result = await dbRun(
    'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
    [ownerId, 'Test Space', 'business']
  );
  return result.lastInsertRowid;
}

// Helper function to create test project
async function createTestProject(ownerId, spaceId) {
  const result = await dbRun(
    'INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, ?, ?)',
    [ownerId, spaceId, 'Test Project', 'business']
  );
  return result.lastInsertRowid;
}

// Helper function to create test dashboard
async function createTestDashboard(projectId) {
  const result = await dbRun(
    'INSERT INTO dashboards (project_id, name, is_default) VALUES (?, ?, ?)',
    [projectId, 'Test Dashboard', toBool(true)]
  );
  return result.lastInsertRowid;
}

// Helper function to create test table
async function createTestTable(projectId) {
  const result = await dbRun(
    'INSERT INTO universal_tables (project_id, name) VALUES (?, ?)',
    [projectId, 'Test Table']
  );
  return result.lastInsertRowid;
}

describe('WidgetService - TDD', () => {
  let userId;
  let spaceId;
  let projectId;
  let dashboardId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    
    // Create test data
    userId = await createTestUser();
    spaceId = await createTestSpace(userId);
    projectId = await createTestProject(userId, spaceId);
    dashboardId = await createTestDashboard(projectId);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // 🔴 RED PHASE: createWidget (preset)
  // ============================================================
  describe('createWidget (preset)', () => {
    test('should create preset widget with valid data', async () => {
      const widgetData = {
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Active Clients',
        description: 'View all active clients',
        icon: '📊',
        config: { table_id: 1, filters: [] },
        position: { x: 0, y: 0, w: 6, h: 4 }
      };

      const widget = await createWidget(widgetData);

      expect(widget).toBeDefined();
      expect(widget.id).toBeDefined();
      expect(widget.widget_type).toBe('preset');
      expect(widget.preset_name).toBe('table_view');
      expect(widget.title).toBe('Active Clients');
      expect(widget.code).toBeNull();
      expect(widget.code_version).toBe(1);
    });

    test('should reject preset widget without preset_name', async () => {
      const widgetData = {
        dashboard_id: dashboardId,
        widget_type: 'preset',
        title: 'Test Widget',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      };

      await expect(createWidget(widgetData)).rejects.toThrow('preset_name is required for preset widgets');
    });

    test('should reject preset widget with code', async () => {
      const widgetData = {
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        code: 'const invalid = true;',
        title: 'Test Widget',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      };

      await expect(createWidget(widgetData)).rejects.toThrow('preset widgets cannot have code');
    });

    test('should reject widget with non-existent dashboard', async () => {
      const widgetData = {
        dashboard_id: 99999,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Test Widget',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      };

      await expect(createWidget(widgetData)).rejects.toThrow('Dashboard not found');
    });
  });

  // ============================================================
  // 🔴 RED PHASE: createWidget (custom)
  // ============================================================
  describe('createWidget (custom)', () => {
    test('should create custom widget with code', async () => {
      const code = `
        export default function CustomWidget({ data }) {
          return <div>{data.length} items</div>;
        }
      `;

      const widgetData = {
        dashboard_id: dashboardId,
        widget_type: 'custom',
        code,
        title: 'Custom Sales Chart',
        description: 'Custom chart visualization',
        config: {},
        position: { x: 6, y: 0, w: 6, h: 4 }
      };

      const widget = await createWidget(widgetData);

      expect(widget).toBeDefined();
      expect(widget.widget_type).toBe('custom');
      expect(widget.code).toBe(code);
      expect(widget.preset_name).toBeNull();
      expect(widget.code_version).toBe(1);
    });

    test('should reject custom widget without code', async () => {
      const widgetData = {
        dashboard_id: dashboardId,
        widget_type: 'custom',
        title: 'Test Widget',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      };

      await expect(createWidget(widgetData)).rejects.toThrow('code is required for custom widgets');
    });

    test('should reject custom widget with preset_name', async () => {
      const widgetData = {
        dashboard_id: dashboardId,
        widget_type: 'custom',
        preset_name: 'table_view',
        code: 'const code = true;',
        title: 'Test Widget',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      };

      await expect(createWidget(widgetData)).rejects.toThrow('custom widgets cannot have preset_name');
    });
  });

  // ============================================================
  // 🔴 RED PHASE: getWidgetById
  // ============================================================
  describe('getWidgetById', () => {
    test('should get existing widget', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Test Widget',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const widget = await getWidgetById(created.id);

      expect(widget).toBeDefined();
      expect(widget.id).toBe(created.id);
      expect(widget.title).toBe('Test Widget');
    });

    test('should return null for non-existent widget', async () => {
      const widget = await getWidgetById(99999);
      expect(widget).toBeNull();
    });

    test('should parse JSON fields correctly', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Test Widget',
        config: { table_id: 5, filters: [{ column: 'status', value: 'active' }] },
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const widget = await getWidgetById(created.id);

      expect(widget.config).toEqual({ table_id: 5, filters: [{ column: 'status', value: 'active' }] });
      expect(widget.position).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    });
  });

  // ============================================================
  // 🔴 RED PHASE: getWidgetsByDashboard
  // ============================================================
  describe('getWidgetsByDashboard', () => {
    test('should get all widgets for dashboard', async () => {
      await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Widget 1',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'project_stats',
        title: 'Widget 2',
        config: {},
        position: { x: 6, y: 0, w: 6, h: 4 }
      });

      const widgets = await getWidgetsByDashboard(dashboardId);

      expect(widgets).toHaveLength(2);
      expect(widgets[0].title).toBe('Widget 1');
      expect(widgets[1].title).toBe('Widget 2');
    });

    test('should return empty array for dashboard with no widgets', async () => {
      const widgets = await getWidgetsByDashboard(dashboardId);
      expect(widgets).toEqual([]);
    });

    test('should sort widgets by order_index', async () => {
      await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Widget 2',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 },
        order_index: 2
      });

      await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Widget 1',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 },
        order_index: 1
      });

      const widgets = await getWidgetsByDashboard(dashboardId);

      expect(widgets[0].title).toBe('Widget 1');
      expect(widgets[1].title).toBe('Widget 2');
    });
  });

  // ============================================================
  // 🔴 RED PHASE: updateWidget
  // ============================================================
  describe('updateWidget', () => {
    test('should update widget title and description', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Old Title',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const updated = await updateWidget(created.id, {
        title: 'New Title',
        description: 'New description'
      });

      expect(updated.title).toBe('New Title');
      expect(updated.description).toBe('New description');
    });

    test('should update widget config', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Test',
        config: { table_id: 1 },
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const updated = await updateWidget(created.id, {
        config: { table_id: 2, filters: [] }
      });

      expect(updated.config).toEqual({ table_id: 2, filters: [] });
    });

    test('should update widget position', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Test',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const updated = await updateWidget(created.id, {
        position: { x: 6, y: 4, w: 12, h: 6 }
      });

      expect(updated.position).toEqual({ x: 6, y: 4, w: 12, h: 6 });
    });

    test('should reject update for non-existent widget', async () => {
      await expect(updateWidget(99999, { title: 'New' })).rejects.toThrow('Widget not found');
    });

    // ADR-0067 Q2 — audit-log detector for documents-widget canonical drift.
    // The mutation MUST emit a `widget.config_updated` row whenever `config`
    // is in the update payload so daily drift queries can spot regressions
    // during the combined DEV+PROD soak (2026-05-17 → 2026-05-24).
    describe('audit-log emission (ADR-0067 Q2)', () => {
      const tableId = 1708;

      test('config update emits widget.config_updated with before/after', async () => {
        const created = await createWidget({
          dashboard_id: dashboardId,
          widget_type: 'preset',
          preset_name: 'documents',
          title: 'Docs',
          config: { registry_table_id: 100008, documents_table_id: 100008 },
          position: { x: 0, y: 0, w: 6, h: 4 }
        });

        const req = {
          user: { id: userId },
          requestId: 'test-req-config-update',
          spaceId,
          get: () => 'vitest-ua',
        };

        await updateWidget(created.id, {
          config: { registry_table_id: 100008, documents_table_id: 100008, title_column: 'name' }
        }, req);

        const rows = await dbAll(
          `SELECT user_id, action, entity_type, entity_id, details, request_id, space_id
             FROM audit_log
            WHERE action = 'widget.config_updated' AND entity_id = ?`,
          [String(created.id)]
        );
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.user_id).toBe(userId);
        expect(row.entity_type).toBe('widget');
        expect(row.entity_id).toBe(String(created.id));
        expect(row.request_id).toBe('test-req-config-update');
        expect(Number(row.space_id)).toBe(Number(spaceId));

        const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
        expect(details.preset_name).toBe('documents');
        expect(details.before).toEqual({ registry_table_id: 100008, documents_table_id: 100008 });
        expect(details.after).toEqual({
          registry_table_id: 100008,
          documents_table_id: 100008,
          title_column: 'name'
        });
      });

      test('non-config update does NOT emit widget.config_updated', async () => {
        const created = await createWidget({
          dashboard_id: dashboardId,
          widget_type: 'preset',
          preset_name: 'documents',
          title: 'Docs',
          config: { registry_table_id: 100008 },
          position: { x: 0, y: 0, w: 6, h: 4 }
        });

        const req = {
          user: { id: userId },
          requestId: 'test-req-title-only',
          spaceId,
          get: () => 'vitest-ua',
        };

        await updateWidget(created.id, { title: 'Renamed', position: { x: 1, y: 1, w: 2, h: 2 } }, req);

        const rows = await dbAll(
          `SELECT id FROM audit_log
            WHERE action = 'widget.config_updated' AND entity_id = ?`,
          [String(created.id)]
        );
        expect(rows).toHaveLength(0);
      });

      test('canonical-strip regression IS visible in audit details', async () => {
        // Simulates stop-condition (a): a Settings save that erases the
        // canonical `registry_table_id` while keeping the legacy key. This
        // is exactly what the daily drift SQL filters on.
        const created = await createWidget({
          dashboard_id: dashboardId,
          widget_type: 'preset',
          preset_name: 'documents',
          title: 'Docs',
          config: { registry_table_id: 100008, documents_table_id: 100008 },
          position: { x: 0, y: 0, w: 6, h: 4 }
        });

        const req = {
          user: { id: userId },
          requestId: 'test-req-strip',
          spaceId,
          get: () => 'vitest-ua',
        };

        // Bad save — canonical stripped.
        await updateWidget(created.id, {
          config: { documents_table_id: 100008 }
        }, req);

        const rows = await dbAll(
          `SELECT details FROM audit_log
            WHERE action = 'widget.config_updated' AND entity_id = ?`,
          [String(created.id)]
        );
        expect(rows).toHaveLength(1);
        const details = typeof rows[0].details === 'string' ? JSON.parse(rows[0].details) : rows[0].details;
        expect(details.before.registry_table_id).toBe(100008);
        expect(details.after.registry_table_id).toBeUndefined();
        // Drift query D would catch exactly this transition: before has the
        // canonical key, after does not.
      });

      test('null req is safe (no throw, no audit row)', async () => {
        const created = await createWidget({
          dashboard_id: dashboardId,
          widget_type: 'preset',
          preset_name: 'documents',
          title: 'Docs',
          config: { registry_table_id: 100008 },
          position: { x: 0, y: 0, w: 6, h: 4 }
        });

        // No req at all — must still UPDATE successfully; audit fires with
        // null user_id / request_id / space_id (writeAudit tolerates this).
        const updated = await updateWidget(created.id, {
          config: { registry_table_id: 100009 }
        });
        expect(updated.config).toEqual({ registry_table_id: 100009 });

        const rows = await dbAll(
          `SELECT user_id, request_id, space_id FROM audit_log
            WHERE action = 'widget.config_updated' AND entity_id = ?`,
          [String(created.id)]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].user_id).toBeNull();
        expect(rows[0].request_id).toBeNull();
        expect(rows[0].space_id).toBeNull();
      });

      // ADR-0067 has nothing preset-specific in the audit contract — preset
      // is only a filter hint inside `details.preset_name`. Confirm a
      // table_view widget also emits the row (so the drift query can scope
      // by preset rather than rely on absence).
      test('non-documents preset also emits with preset_name in details', async () => {
        const created = await createWidget({
          dashboard_id: dashboardId,
          widget_type: 'preset',
          preset_name: 'table_view',
          title: 'Tickets',
          config: { table_id: tableId },
          position: { x: 0, y: 0, w: 6, h: 4 }
        });

        const req = {
          user: { id: userId },
          requestId: 'test-req-table-view',
          spaceId,
          get: () => 'vitest-ua',
        };

        await updateWidget(created.id, { config: { table_id: tableId, filters: [] } }, req);

        const rows = await dbAll(
          `SELECT details FROM audit_log
            WHERE action = 'widget.config_updated' AND entity_id = ?`,
          [String(created.id)]
        );
        expect(rows).toHaveLength(1);
        const details = typeof rows[0].details === 'string' ? JSON.parse(rows[0].details) : rows[0].details;
        expect(details.preset_name).toBe('table_view');
      });
    });
  });

  // ============================================================
  // 🔴 RED PHASE: updateWidgetCode
  // ============================================================
  describe('updateWidgetCode', () => {
    test('should update custom widget code and increment version', async () => {
      const code1 = 'const version1 = true;';
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'custom',
        code: code1,
        title: 'Custom Widget',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      expect(created.code_version).toBe(1);

      const code2 = 'const version2 = true;';
      const updated = await updateWidgetCode(created.id, code2);

      expect(updated.code).toBe(code2);
      expect(updated.code_version).toBe(2);
    });

    test('should reject updating code for preset widget', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Test',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      await expect(updateWidgetCode(created.id, 'new code')).rejects.toThrow('Can only update code for custom widgets');
    });

    test('should reject empty code', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'custom',
        code: 'const v1 = true;',
        title: 'Test',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      await expect(updateWidgetCode(created.id, '')).rejects.toThrow('Code cannot be empty');
    });
  });

  // ============================================================
  // 🔴 RED PHASE: deleteWidget
  // ============================================================
  describe('deleteWidget', () => {
    test('should delete widget', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Test',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      await deleteWidget(created.id);

      const widget = await getWidgetById(created.id);
      expect(widget).toBeNull();
    });

    test('should cascade delete child widgets (source_widget_id)', async () => {
      const parent = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Parent',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const child = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Child',
        source_widget_id: parent.id,
        config: {},
        position: { x: 6, y: 0, w: 6, h: 4 }
      });

      await deleteWidget(parent.id);

      const childWidget = await getWidgetById(child.id);
      expect(childWidget).toBeNull();
    });

    test('should not throw error when deleting non-existent widget', async () => {
      await expect(deleteWidget(99999)).resolves.not.toThrow();
    });
  });

  // ============================================================
  // 🔴 RED PHASE: getWidgetData
  // ============================================================
  describe('getWidgetData', () => {
    test('should get data for preset widget with table_id', async () => {
      const tableId = await createTestTable(projectId);

      // Insert test row
      await dbRun(
        'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
        [tableId, 'test_base_id_1', JSON.stringify({ name: 'John Doe', email: 'john@example.com' })]
      );

      const widget = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Clients',
        config: { table_id: tableId },
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const data = await getWidgetData(widget.id);

      expect(data).toHaveLength(1);
      expect(data[0].data).toEqual({ name: 'John Doe', email: 'john@example.com' });
    });

    test('should return empty array for widget without table_id', async () => {
      const widget = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'project_stats',
        title: 'Stats',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const data = await getWidgetData(widget.id);
      expect(data).toEqual([]);
    });

    test('should apply filters from config', async () => {
      const tableId = await createTestTable(projectId);

      await dbRun(
        'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
        [tableId, 'test_1', JSON.stringify({ name: 'Active', status: 'active' })]
      );
      await dbRun(
        'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
        [tableId, 'test_2', JSON.stringify({ name: 'Inactive', status: 'inactive' })]
      );

      const widget = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Active Only',
        config: { 
          table_id: tableId,
          filters: [{ column: 'status', value: 'active' }]
        },
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const data = await getWidgetData(widget.id);

      expect(data).toHaveLength(1);
      expect(data[0].data.status).toBe('active');
    });
  });

  // ============================================================
  // ADR-065: is_module from LEFT JOIN modules
  // ============================================================
  describe('ADR-065: is_module via LEFT JOIN modules', () => {
    test('getWidgetById should return is_module=false for widget without module', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Dashboard Only',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const widget = await getWidgetById(created.id);

      expect(widget.is_module).toBeFalsy();
      expect(widget.module_id).toBeNull();
      expect(widget.sidebar_order).toBeNull();
      expect(widget.access_level).toBeNull();
    });

    test('getWidgetById should return is_module=true with module metadata', async () => {
      const created = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'documents',
        title: 'Documents Module',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      await createModule({
        widget_id: created.id,
        space_id: spaceId,
        sidebar_order: 2,
        sidebar_icon: 'file',
        access_level: 'admin',
        is_pinned: true
      });

      const widget = await getWidgetById(created.id);

      expect(widget.is_module).toBeTruthy();
      expect(widget.module_id).toBeDefined();
      expect(widget.sidebar_order).toBe(2);
      expect(widget.sidebar_icon).toBe('file');
      expect(widget.access_level).toBe('admin');
      expect(widget.is_pinned).toBeTruthy();
    });

    test('getWidgetsByDashboard should include is_module for all widgets', async () => {
      const w1 = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'table_view',
        title: 'Dashboard Widget',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const w2 = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'documents',
        title: 'Module Widget',
        config: {},
        position: { x: 6, y: 0, w: 6, h: 4 }
      });

      await createModule({
        widget_id: w2.id,
        space_id: spaceId,
        sidebar_order: 0
      });

      const widgets = await getWidgetsByDashboard(dashboardId);

      expect(widgets).toHaveLength(2);

      const dashboardOnly = widgets.find(w => w.title === 'Dashboard Widget');
      const moduleWidget = widgets.find(w => w.title === 'Module Widget');

      expect(dashboardOnly.is_module).toBeFalsy();
      expect(dashboardOnly.module_id).toBeNull();

      expect(moduleWidget.is_module).toBeTruthy();
      expect(moduleWidget.module_id).toBeDefined();
    });

    test('getWidgetsByDashboard should filter by is_module option', async () => {
      const w1 = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'project_stats',
        title: 'Stats Only',
        config: {},
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      const w2 = await createWidget({
        dashboard_id: dashboardId,
        widget_type: 'preset',
        preset_name: 'documents',
        title: 'Docs Module',
        config: {},
        position: { x: 6, y: 0, w: 6, h: 4 }
      });

      await createModule({
        widget_id: w2.id,
        space_id: spaceId
      });

      // Filter: only modules
      const modules = await getWidgetsByDashboard(dashboardId, { is_module: true });
      expect(modules).toHaveLength(1);
      expect(modules[0].title).toBe('Docs Module');

      // Filter: only non-modules
      const dashOnly = await getWidgetsByDashboard(dashboardId, { is_module: false });
      expect(dashOnly).toHaveLength(1);
      expect(dashOnly[0].title).toBe('Stats Only');

      // No filter: all
      const all = await getWidgetsByDashboard(dashboardId);
      expect(all).toHaveLength(2);
    });
  });
});
