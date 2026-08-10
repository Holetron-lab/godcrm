/**
 * Dashboard & Widget Tool Handlers
 *
 * Handles: create_dashboard, get_dashboard_widgets, create_widget
 */

import { dbGet, dbRun, dbAll, sqlNow } from '../../database/connection.js';
import { parseRowData } from './data-tools.js';
import { createDashboard as createDashboardSvc } from '../DashboardService.js';
import { createWidget as createWidgetSvc } from '../WidgetService.js';

/**
 * Dashboard tool handlers
 */
export const dashboardToolHandlers = {
  // === DASHBOARD ===
  async create_dashboard({ project_id, space_id, name, description = '' }, userId) {
    const hasExplicitParent = project_id != null || space_id != null;
    const dashboard = await createDashboardSvc({
      project_id: project_id ?? null,
      space_id: space_id ?? null,
      user_id: hasExplicitParent ? null : (userId || null),
      name,
      description
    });

    return {
      success: true,
      dashboard_id: dashboard.id,
      message: `Dashboard "${name}" created`
    };
  },

  async get_dashboard_widgets({ dashboard_id }) {
    const widgets = await dbAll(`
      SELECT id, title, widget_type, preset_name, config, position
      FROM widgets
      WHERE dashboard_id = ?
    `, [dashboard_id]);

    return {
      widgets: widgets.map(w => {
        const position = parseRowData(w.position) || { x: 0, y: 0, w: 6, h: 4 };
        return {
          id: w.id,
          title: w.title,
          widget_type: w.widget_type,
          preset_name: w.preset_name,
          config: parseRowData(w.config) || {},
          x: position.x, y: position.y, w: position.w, h: position.h
        };
      })
    };
  },

  // === WIDGETS ===
  async create_widget({ dashboard_id, title, widget_type, preset_type, config = {}, position = {} }, userId) {
    const widget = await createWidgetSvc({
      dashboard_id,
      title,
      widget_type,
      preset_name: preset_type || null,
      config,
      position: { x: position.x ?? 0, y: position.y ?? 0, w: position.w ?? 6, h: position.h ?? 4 },
      created_by: userId || null
    });

    return {
      success: true,
      widget_id: widget.id,
      message: `Widget "${title}" created`
    };
  },

  // === ADR-144 P1: Widget update/delete ===
  async update_widget({ widget_id, title, config, position }, userId) {
    const widget = await dbGet('SELECT * FROM widgets WHERE id = ?', [widget_id]);
    if (!widget) return { error: `Widget ${widget_id} not found` };

    const updates = [];
    const params = [];
    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (config !== undefined) { updates.push('config = ?'); params.push(JSON.stringify(config)); }
    if (position) {
      const oldPos = parseRowData(widget.position) || { x: 0, y: 0, w: 6, h: 4 };
      const nextPos = { ...oldPos, ...position };
      updates.push('position = ?');
      params.push(JSON.stringify(nextPos));
    }
    if (updates.length === 0) return { error: 'No fields to update' };

    updates.push(`updated_at = ${sqlNow()}`);
    params.push(widget_id);
    await dbRun(`UPDATE widgets SET ${updates.join(', ')} WHERE id = ?`, params);
    return { success: true, message: `Widget ${widget_id} updated` };
  },

  async delete_widget({ widget_id }) {
    const widget = await dbGet('SELECT id, title FROM widgets WHERE id = ?', [widget_id]);
    if (!widget) return { error: `Widget ${widget_id} not found` };

    await dbRun('DELETE FROM widgets WHERE id = ?', [widget_id]);
    return { success: true, message: `Widget "${widget.title}" deleted` };
  }
};
