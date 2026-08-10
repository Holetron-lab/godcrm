/**
 * ModuleService - ADR-065
 * Manages sidebar modules (separate table with FK on widgets)
 * Module = widget registered in sidebar with module-specific metadata
 */

import { dbRun, dbGet, dbAll } from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { registerWidgetSafe } from './WidgetLibraryService.js';

const VALID_ACCESS_LEVELS = ['admin', 'member', 'viewer'];

/**
 * Get all modules for a space (sidebar list)
 * @param {number} spaceId - Space ID
 * @returns {Promise<Array>} Modules with widget data
 */
export async function getModulesBySpace(spaceId) {
  const modules = await dbAll(`
    SELECT
      m.id as module_id,
      m.widget_id,
      m.space_id,
      m.sidebar_order,
      m.sidebar_icon,
      m.access_level,
      m.is_pinned,
      m.is_default,
      m.created_at as module_created_at,
      m.updated_at as module_updated_at,
      w.id,
      w.dashboard_id,
      w.widget_type,
      w.preset_name,
      w.title,
      w.description,
      w.icon,
      w.config,
      w.position,
      w.is_visible,
      w.order_index
    FROM modules m
    JOIN widgets w ON w.id = m.widget_id
    WHERE m.space_id = ?
    ORDER BY m.is_pinned DESC, m.sidebar_order ASC, w.id ASC
  `, [spaceId]);

  return modules.map(row => ({
    module_id: row.module_id,
    widget_id: row.widget_id,
    space_id: row.space_id,
    sidebar_order: row.sidebar_order,
    sidebar_icon: row.sidebar_icon,
    access_level: row.access_level,
    is_pinned: row.is_pinned,
    is_default: row.is_default,
    widget: {
      id: row.id,
      dashboard_id: row.dashboard_id,
      widget_type: row.widget_type,
      preset_name: row.preset_name,
      title: row.title,
      description: row.description,
      icon: row.icon,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      position: typeof row.position === 'string' ? JSON.parse(row.position) : row.position,
      is_visible: row.is_visible,
      order_index: row.order_index
    }
  }));
}

/**
 * Get module by ID
 * @param {number} moduleId - Module ID
 * @returns {Promise<object|null>}
 */
export async function getModuleById(moduleId) {
  const row = await dbGet(`
    SELECT
      m.id as module_id,
      m.widget_id,
      m.space_id,
      m.sidebar_order,
      m.sidebar_icon,
      m.access_level,
      m.is_pinned,
      m.is_default,
      w.id,
      w.dashboard_id,
      w.widget_type,
      w.preset_name,
      w.title,
      w.description,
      w.icon,
      w.config,
      w.position,
      w.is_visible
    FROM modules m
    JOIN widgets w ON w.id = m.widget_id
    WHERE m.id = ?
  `, [moduleId]);

  if (!row) return null;

  return {
    module_id: row.module_id,
    widget_id: row.widget_id,
    space_id: row.space_id,
    sidebar_order: row.sidebar_order,
    sidebar_icon: row.sidebar_icon,
    access_level: row.access_level,
    is_pinned: row.is_pinned,
    is_default: row.is_default,
    widget: {
      id: row.id,
      dashboard_id: row.dashboard_id,
      widget_type: row.widget_type,
      preset_name: row.preset_name,
      title: row.title,
      description: row.description,
      icon: row.icon,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      position: typeof row.position === 'string' ? JSON.parse(row.position) : row.position,
      is_visible: row.is_visible
    }
  };
}

/**
 * Register a widget as a sidebar module
 * @param {object} data - { widget_id, space_id, sidebar_order, sidebar_icon, access_level }
 * @returns {Promise<object>} Created module
 */
export async function createModule(data) {
  const {
    widget_id,
    space_id,
    sidebar_order = 0,
    sidebar_icon = null,
    access_level = 'member',
    is_pinned = false,
    is_default = false
  } = data;

  if (!widget_id) throw new Error('widget_id is required');
  if (!space_id) throw new Error('space_id is required');

  if (access_level && !VALID_ACCESS_LEVELS.includes(access_level)) {
    throw new Error(`access_level must be one of: ${VALID_ACCESS_LEVELS.join(', ')}`);
  }

  // Check widget exists
  const widget = await dbGet('SELECT id FROM widgets WHERE id = ?', [widget_id]);
  if (!widget) throw new Error('Widget not found');

  // Check space exists
  const space = await dbGet('SELECT id FROM spaces WHERE id = ?', [space_id]);
  if (!space) throw new Error('Space not found');

  // Check widget not already a module
  const existing = await dbGet('SELECT id FROM modules WHERE widget_id = ?', [widget_id]);
  if (existing) throw new Error('Widget is already registered as a module');

  const result = await dbRun(`
    INSERT INTO modules (widget_id, space_id, sidebar_order, sidebar_icon, access_level, is_pinned, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [widget_id, space_id, sidebar_order, sidebar_icon, access_level, is_pinned ? 1 : 0, is_default ? 1 : 0]);

  const moduleId = result.lastInsertRowid || result.lastID;
  logger.debug({ moduleId, widget_id, space_id }, 'Module created');

  // ADR-073: Auto-register widget in widget_library for Widget Picker
  try {
    await registerWidgetSafe(widget_id, space_id, {
      is_public: false,
      tags: []
    });
  } catch (err) {
    // Non-critical error, log and continue
    logger.warn({ widget_id, space_id, error: err.message }, 'Failed to auto-register widget in library');
  }

  return await getModuleById(moduleId);
}

/**
 * Update module metadata
 * @param {number} moduleId - Module ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated module
 */
export async function updateModule(moduleId, updates) {
  const mod = await getModuleById(moduleId);
  if (!mod) throw new Error('Module not found');

  const allowedFields = ['sidebar_order', 'sidebar_icon', 'access_level', 'is_pinned', 'is_default'];
  const updateFields = [];
  const updateValues = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      if (key === 'access_level' && !VALID_ACCESS_LEVELS.includes(value)) {
        throw new Error(`access_level must be one of: ${VALID_ACCESS_LEVELS.join(', ')}`);
      }
      updateFields.push(`${key} = ?`);
      if (key === 'is_pinned' || key === 'is_default') {
        updateValues.push(value ? 1 : 0);
      } else {
        updateValues.push(value);
      }
    }
  }

  if (updateFields.length === 0) return mod;

  updateFields.push('updated_at = CURRENT_TIMESTAMP');
  updateValues.push(moduleId);

  await dbRun(
    `UPDATE modules SET ${updateFields.join(', ')} WHERE id = ?`,
    updateValues
  );

  return await getModuleById(moduleId);
}

/**
 * Get all widgets from projects in a space (not just modules)
 * Used by Widget Picker to show all available widgets for dashboard
 * @param {number} spaceId - Space ID
 * @returns {Promise<Array>} Widgets with module info
 */
export async function getWidgetsBySpace(spaceId) {
  const widgets = await dbAll(`
    SELECT
      w.id as widget_id,
      w.dashboard_id,
      w.widget_type,
      w.preset_name,
      w.title,
      w.description,
      w.icon,
      w.config,
      w.position,
      w.is_visible,
      w.order_index,
      p.id as project_id,
      p.name as project_name,
      p.icon as project_icon,
      m.id as module_id,
      m.sidebar_order,
      m.sidebar_icon,
      m.is_pinned,
      m.is_default
    FROM widgets w
    JOIN dashboards d ON d.id = w.dashboard_id
    JOIN projects p ON p.id = d.project_id
    LEFT JOIN modules m ON m.widget_id = w.id
    WHERE p.space_id = $1
    ORDER BY m.is_pinned DESC NULLS LAST, m.sidebar_order ASC NULLS LAST, w.title ASC
  `, [spaceId]);

  return widgets.map(row => ({
    widget_id: row.widget_id,
    dashboard_id: row.dashboard_id,
    widget_type: row.widget_type,
    preset_name: row.preset_name,
    title: row.title,
    description: row.description,
    icon: row.icon,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
    position: typeof row.position === 'string' ? JSON.parse(row.position) : row.position,
    is_visible: row.is_visible,
    project_id: row.project_id,
    project_name: row.project_name,
    project_icon: row.project_icon,
    is_module: !!row.module_id,
    module_id: row.module_id,
    is_pinned: row.is_pinned || false,
  }));
}

/**
 * Get tables with show_in_nav for a space (from all projects)
 * Used in Widget Picker to show tables as widget sources
 * @param {number} spaceId - Space ID
 * @returns {Promise<Array>} Tables with project info
 */
export async function getTablesBySpace(spaceId) {
  const tables = await dbAll(`
    SELECT
      ut.id as table_id,
      ut.name,
      ut.icon,
      ut.description,
      ut.is_system,
      ut.show_in_nav,
      p.id as project_id,
      p.name as project_name,
      p.icon as project_icon,
      (SELECT COUNT(*) FROM table_rows tr WHERE tr.table_id = ut.id) as row_count
    FROM universal_tables ut
    JOIN projects p ON p.id = ut.project_id
    WHERE p.space_id = $1
      AND ut.show_in_nav = 1
      AND ut.name NOT LIKE 'doc_%'
    ORDER BY p.name ASC, ut.name ASC
  `, [spaceId]);

  return tables.map(row => ({
    table_id: row.table_id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    is_system: !!row.is_system,
    row_count: parseInt(row.row_count, 10) || 0,
    project_id: row.project_id,
    project_name: row.project_name,
    project_icon: row.project_icon,
  }));
}

/**
 * Unregister widget from sidebar (delete module record, widget remains)
 * @param {number} moduleId - Module ID
 */
export async function deleteModule(moduleId) {
  const mod = await dbGet('SELECT id FROM modules WHERE id = ?', [moduleId]);
  if (!mod) throw new Error('Module not found');

  await dbRun('DELETE FROM modules WHERE id = ?', [moduleId]);
  logger.debug({ moduleId }, 'Module deleted');
}
