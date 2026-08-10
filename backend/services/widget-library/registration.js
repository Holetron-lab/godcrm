/**
 * Widget Library — Registration & Dashboard Integration
 *
 * addFromLibrary, registerWidget, registerWidgetSafe, unregisterWidget
 */

import { dbRun, dbGet } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { createWidget, getWidgetById } from '../WidgetService.js';
import { trackUsage } from './user-actions.js';

/**
 * Add widget from library to dashboard
 * @param {number} dashboardId - Target dashboard ID
 * @param {number} sourceWidgetId - Source widget ID from library
 * @param {string} mode - 'reference' or 'copy'
 * @param {Object} position - { x, y, w, h }
 * @param {number} userId - User performing the action
 * @returns {Promise<Object>} { widget, mode_used }
 */
export async function addFromLibrary(dashboardId, sourceWidgetId, mode, position, userId) {
  // Validate mode
  if (!['reference', 'copy'].includes(mode)) {
    throw new Error('Invalid mode: must be "reference" or "copy"');
  }

  // Check source widget exists
  const sourceWidget = await getWidgetById(sourceWidgetId);
  if (!sourceWidget) {
    throw new Error('Source widget not found');
  }

  // Check dashboard exists
  const dashboard = await dbGet('SELECT id FROM dashboards WHERE id = ?', [dashboardId]);
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }

  let newWidget;

  if (mode === 'reference') {
    // Create a reference widget (linked to source)
    newWidget = await createWidget({
      dashboard_id: dashboardId,
      source_widget_id: sourceWidgetId,
      widget_type: sourceWidget.widget_type,
      preset_name: sourceWidget.preset_name,
      code: sourceWidget.code,
      title: sourceWidget.title,
      description: sourceWidget.description,
      icon: sourceWidget.icon,
      config: sourceWidget.config,
      position,
      created_by: userId
    });
  } else {
    // Create a copy (no link to source)
    newWidget = await createWidget({
      dashboard_id: dashboardId,
      source_widget_id: null,
      widget_type: sourceWidget.widget_type,
      preset_name: sourceWidget.preset_name,
      code: sourceWidget.code,
      title: sourceWidget.title,
      description: sourceWidget.description,
      icon: sourceWidget.icon,
      config: sourceWidget.config,
      position,
      created_by: userId
    });
  }

  // Track usage
  await trackUsage(userId, sourceWidgetId);

  logger.debug({ dashboardId, sourceWidgetId, mode, newWidgetId: newWidget.id }, 'Widget added from library');

  return {
    widget: newWidget,
    mode_used: mode
  };
}

/**
 * Register a widget in the library
 * Called from ModuleService when a module is created, or manually
 * @param {number} widgetId - Widget ID to register
 * @param {number} spaceId - Space ID
 * @param {Object} options - { is_public, is_template, tags }
 * @returns {Promise<Object>} Created library entry
 */
export async function registerWidget(widgetId, spaceId, options = {}) {
  const {
    is_public = false,
    is_template = false,
    tags = null
  } = options;

  // Check widget exists
  const widget = await dbGet('SELECT id FROM widgets WHERE id = ?', [widgetId]);
  if (!widget) {
    throw new Error('Widget not found');
  }

  // Check space exists
  const space = await dbGet('SELECT id FROM spaces WHERE id = ?', [spaceId]);
  if (!space) {
    throw new Error('Space not found');
  }

  // Check widget not already in library
  const existing = await dbGet('SELECT id FROM widget_library WHERE widget_id = ?', [widgetId]);
  if (existing) {
    throw new Error('Widget already in library');
  }

  const tagsValue = tags ? `{${tags.join(',')}}` : null;
  const result = await dbRun(`
    INSERT INTO widget_library (widget_id, space_id, is_public, is_template, tags)
    VALUES (?, ?, ?, ?, ?)
  `, [widgetId, spaceId, is_public ? 1 : 0, is_template ? 1 : 0, tagsValue]);

  logger.debug({ widgetId, spaceId }, 'Widget registered in library');

  return await dbGet('SELECT * FROM widget_library WHERE id = ?', [result.lastInsertRowid]);
}

/**
 * Safely register a widget in the library (idempotent)
 * If widget is already registered, returns the existing entry
 * Called from ModuleService.createModule() - ADR-073
 * @param {number} widgetId - Widget ID to register
 * @param {number} spaceId - Space ID
 * @param {Object} options - { is_public, is_template, tags }
 * @returns {Promise<Object|null>} Library entry or null if widget/space doesn't exist
 */
export async function registerWidgetSafe(widgetId, spaceId, options = {}) {
  const {
    is_public = false,
    is_template = false,
    tags = null
  } = options;

  // Check widget exists
  const widget = await dbGet('SELECT id FROM widgets WHERE id = ?', [widgetId]);
  if (!widget) {
    logger.warn({ widgetId }, 'Cannot register widget in library: widget not found');
    return null;
  }

  // Check space exists
  const space = await dbGet('SELECT id FROM spaces WHERE id = ?', [spaceId]);
  if (!space) {
    logger.warn({ spaceId }, 'Cannot register widget in library: space not found');
    return null;
  }

  // Check if already in library
  const existing = await dbGet('SELECT * FROM widget_library WHERE widget_id = ?', [widgetId]);
  if (existing) {
    logger.debug({ widgetId, spaceId }, 'Widget already in library, skipping registration');
    return existing;
  }

  // Insert into library
  const tagsValue = tags ? `{${tags.join(',')}}` : null;
  const result = await dbRun(`
    INSERT INTO widget_library (widget_id, space_id, is_public, is_template, tags)
    VALUES (?, ?, ?, ?, ?)
  `, [widgetId, spaceId, is_public ? 1 : 0, is_template ? 1 : 0, tagsValue]);

  logger.debug({ widgetId, spaceId }, 'Widget auto-registered in library');

  return await dbGet('SELECT * FROM widget_library WHERE id = ?', [result.lastInsertRowid]);
}

/**
 * Unregister a widget from the library
 * @param {number} widgetId - Widget ID to unregister
 * @returns {Promise<void>}
 */
export async function unregisterWidget(widgetId) {
  // Check widget is in library
  const existing = await dbGet('SELECT id FROM widget_library WHERE widget_id = ?', [widgetId]);
  if (!existing) {
    throw new Error('Widget not in library');
  }

  await dbRun('DELETE FROM widget_library WHERE widget_id = ?', [widgetId]);

  // Also clean up related favorites and history
  await dbRun('DELETE FROM user_widget_favorites WHERE widget_id = ?', [widgetId]);
  await dbRun('DELETE FROM user_widget_history WHERE widget_id = ?', [widgetId]);

  logger.debug({ widgetId }, 'Widget unregistered from library');
}
