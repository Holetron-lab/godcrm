/**
 * ModuleService Tests - TDD (ADR-065)
 * Testing module CRUD operations (separate modules table)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  getModulesBySpace,
  getModuleById,
  createModule,
  updateModule,
  deleteModule
} from '../ModuleService.js';
import { createWidget, getWidgetById } from '../WidgetService.js';
import { dbGet, dbRun, destroyAdapter, resetAdapter, toBool } from '../../database/connection.js';
// Helper functions (matching existing test patterns)
async function createTestUser() {
  const uniqueEmail = `test-moduleservice-${Date.now()}@hltrn.cc`;
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
    [projectId, 'Test Dashboard', toBool(true)]
  );
  return result.lastInsertRowid;
}

async function createTestWidget(dashboardId, presetName = 'table_view') {
  return await createWidget({
    dashboard_id: dashboardId,
    widget_type: 'preset',
    preset_name: presetName,
    title: `Widget ${presetName}`,
    config: {},
    position: { x: 0, y: 0, w: 6, h: 4 }
  });
}

describe('ModuleService - ADR-065', () => {
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
  // createModule
  // ============================================================
  describe('createModule', () => {
    test('should register widget as module', async () => {
      const widget = await createTestWidget(dashboardId);

      const mod = await createModule({
        widget_id: widget.id,
        space_id: spaceId,
        sidebar_order: 1,
        sidebar_icon: 'flask',
        access_level: 'member'
      });

      expect(mod).toBeDefined();
      expect(mod.module_id).toBeDefined();
      expect(mod.widget_id).toBe(widget.id);
      expect(mod.space_id).toBe(spaceId);
      expect(mod.sidebar_order).toBe(1);
      expect(mod.sidebar_icon).toBe('flask');
      expect(mod.access_level).toBe('member');
      expect(mod.widget).toBeDefined();
      expect(mod.widget.title).toBe('Widget table_view');
    });

    test('should use default values for optional fields', async () => {
      const widget = await createTestWidget(dashboardId);

      const mod = await createModule({
        widget_id: widget.id,
        space_id: spaceId
      });

      expect(mod.sidebar_order).toBe(0);
      expect(mod.sidebar_icon).toBeNull();
      expect(mod.access_level).toBe('member');
      expect(mod.is_pinned).toBeFalsy();
      expect(mod.is_default).toBeFalsy();
    });

    test('should reject missing widget_id', async () => {
      await expect(createModule({
        space_id: spaceId
      })).rejects.toThrow('widget_id is required');
    });

    test('should reject missing space_id', async () => {
      const widget = await createTestWidget(dashboardId);

      await expect(createModule({
        widget_id: widget.id
      })).rejects.toThrow('space_id is required');
    });

    test('should reject non-existent widget', async () => {
      await expect(createModule({
        widget_id: 99999,
        space_id: spaceId
      })).rejects.toThrow('Widget not found');
    });

    test('should reject non-existent space', async () => {
      const widget = await createTestWidget(dashboardId);

      await expect(createModule({
        widget_id: widget.id,
        space_id: 99999
      })).rejects.toThrow('Space not found');
    });

    test('should reject invalid access_level', async () => {
      const widget = await createTestWidget(dashboardId);

      await expect(createModule({
        widget_id: widget.id,
        space_id: spaceId,
        access_level: 'superadmin'
      })).rejects.toThrow('access_level must be one of');
    });

    test('should reject duplicate module for same widget', async () => {
      const widget = await createTestWidget(dashboardId);

      await createModule({
        widget_id: widget.id,
        space_id: spaceId
      });

      await expect(createModule({
        widget_id: widget.id,
        space_id: spaceId
      })).rejects.toThrow('already registered as a module');
    });
  });

  // ============================================================
  // getModuleById
  // ============================================================
  describe('getModuleById', () => {
    test('should return module with widget data', async () => {
      const widget = await createTestWidget(dashboardId);
      const created = await createModule({
        widget_id: widget.id,
        space_id: spaceId,
        sidebar_order: 3,
        access_level: 'admin'
      });

      const mod = await getModuleById(created.module_id);

      expect(mod).toBeDefined();
      expect(mod.module_id).toBe(created.module_id);
      expect(mod.sidebar_order).toBe(3);
      expect(mod.access_level).toBe('admin');
      expect(mod.widget).toBeDefined();
      expect(mod.widget.id).toBe(widget.id);
      expect(mod.widget.preset_name).toBe('table_view');
    });

    test('should return null for non-existent module', async () => {
      const mod = await getModuleById(99999);
      expect(mod).toBeNull();
    });
  });

  // ============================================================
  // getModulesBySpace
  // ============================================================
  describe('getModulesBySpace', () => {
    test('should return all modules for space', async () => {
      const w1 = await createTestWidget(dashboardId, 'table_view');
      const w2 = await createTestWidget(dashboardId, 'kanban_board');

      await createModule({ widget_id: w1.id, space_id: spaceId, sidebar_order: 1 });
      await createModule({ widget_id: w2.id, space_id: spaceId, sidebar_order: 2 });

      const modules = await getModulesBySpace(spaceId);

      expect(modules).toHaveLength(2);
      expect(modules[0].sidebar_order).toBe(1);
      expect(modules[1].sidebar_order).toBe(2);
    });

    test('should return empty array for space with no modules', async () => {
      const modules = await getModulesBySpace(spaceId);
      expect(modules).toEqual([]);
    });

    test('should sort pinned modules first', async () => {
      const w1 = await createTestWidget(dashboardId, 'table_view');
      const w2 = await createTestWidget(dashboardId, 'kanban_board');

      await createModule({ widget_id: w1.id, space_id: spaceId, sidebar_order: 1, is_pinned: false });
      await createModule({ widget_id: w2.id, space_id: spaceId, sidebar_order: 2, is_pinned: true });

      const modules = await getModulesBySpace(spaceId);

      // Pinned first
      expect(modules[0].widget.preset_name).toBe('kanban_board');
      expect(modules[1].widget.preset_name).toBe('table_view');
    });

    test('should not return modules from other spaces', async () => {
      const otherSpaceId = (await dbRun(
        'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
        [userId, 'Other Space', 'business']
      )).lastInsertRowid;

      const widget = await createTestWidget(dashboardId);
      await createModule({ widget_id: widget.id, space_id: otherSpaceId });

      const modules = await getModulesBySpace(spaceId);
      expect(modules).toHaveLength(0);
    });
  });

  // ============================================================
  // updateModule
  // ============================================================
  describe('updateModule', () => {
    test('should update sidebar_order', async () => {
      const widget = await createTestWidget(dashboardId);
      const created = await createModule({
        widget_id: widget.id,
        space_id: spaceId,
        sidebar_order: 0
      });

      const updated = await updateModule(created.module_id, { sidebar_order: 5 });

      expect(updated.sidebar_order).toBe(5);
    });

    test('should update access_level', async () => {
      const widget = await createTestWidget(dashboardId);
      const created = await createModule({
        widget_id: widget.id,
        space_id: spaceId,
        access_level: 'member'
      });

      const updated = await updateModule(created.module_id, { access_level: 'admin' });

      expect(updated.access_level).toBe('admin');
    });

    test('should update sidebar_icon', async () => {
      const widget = await createTestWidget(dashboardId);
      const created = await createModule({
        widget_id: widget.id,
        space_id: spaceId
      });

      const updated = await updateModule(created.module_id, { sidebar_icon: 'star' });

      expect(updated.sidebar_icon).toBe('star');
    });

    test('should update is_pinned', async () => {
      const widget = await createTestWidget(dashboardId);
      const created = await createModule({
        widget_id: widget.id,
        space_id: spaceId,
        is_pinned: false
      });

      const updated = await updateModule(created.module_id, { is_pinned: true });

      expect(updated.is_pinned).toBeTruthy();
    });

    test('should reject invalid access_level', async () => {
      const widget = await createTestWidget(dashboardId);
      const created = await createModule({
        widget_id: widget.id,
        space_id: spaceId
      });

      await expect(updateModule(created.module_id, {
        access_level: 'invalid'
      })).rejects.toThrow('access_level must be one of');
    });

    test('should reject update for non-existent module', async () => {
      await expect(updateModule(99999, { sidebar_order: 1 }))
        .rejects.toThrow('Module not found');
    });

    test('should return unchanged module when no valid fields provided', async () => {
      const widget = await createTestWidget(dashboardId);
      const created = await createModule({
        widget_id: widget.id,
        space_id: spaceId,
        sidebar_order: 3
      });

      const updated = await updateModule(created.module_id, { unknown_field: 'value' });

      expect(updated.sidebar_order).toBe(3);
    });
  });

  // ============================================================
  // deleteModule
  // ============================================================
  describe('deleteModule', () => {
    test('should delete module record', async () => {
      const widget = await createTestWidget(dashboardId);
      const created = await createModule({
        widget_id: widget.id,
        space_id: spaceId
      });

      await deleteModule(created.module_id);

      const mod = await getModuleById(created.module_id);
      expect(mod).toBeNull();
    });

    test('should not delete the widget itself', async () => {
      const widget = await createTestWidget(dashboardId);
      const created = await createModule({
        widget_id: widget.id,
        space_id: spaceId
      });

      await deleteModule(created.module_id);

      const w = await getWidgetById(widget.id);
      expect(w).toBeDefined();
      expect(w.id).toBe(widget.id);
    });

    test('should reject delete for non-existent module', async () => {
      await expect(deleteModule(99999)).rejects.toThrow('Module not found');
    });
  });
});
