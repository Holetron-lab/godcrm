/**
 * Project Tool Handlers (ADR-144 P2 + ADR-0045 P1)
 *
 * Handles: list_projects, create_project, update_project, delete_project
 *          create_space, move_project_to_space, move_table_to_project, delete_project_cascade
 */

import { dbGet, dbRun, dbAll, isPostgres, sqlNow, withTransactionAsync } from '../../database/connection.js';
import { canAdminister } from '../EffectiveRoleService.js';
import { apiLogger } from '../../utils/logger.js';

// ADR-0045 P1: delete_project_cascade requires a dry_run preview within the
// same conversation before the actual destructive call. We keep a tiny TTL
// map of (conversationId, projectId) → previewedAt. Entries expire after
// 10 minutes to prevent stale approvals.
const _cascadePreviewedAt = new Map();
const CASCADE_PREVIEW_TTL_MS = 10 * 60 * 1000;
function _cascadeKey(conversationId, projectId) {
  return `${conversationId ?? 'none'}::${projectId}`;
}
function _hasCascadePreview(conversationId, projectId) {
  const k = _cascadeKey(conversationId, projectId);
  const ts = _cascadePreviewedAt.get(k);
  if (!ts) return false;
  if (Date.now() - ts > CASCADE_PREVIEW_TTL_MS) {
    _cascadePreviewedAt.delete(k);
    return false;
  }
  return true;
}
function _recordCascadePreview(conversationId, projectId) {
  _cascadePreviewedAt.set(_cascadeKey(conversationId, projectId), Date.now());
}

export const projectToolHandlers = {
  async list_projects({ space_id, limit = 50 }) {
    if (!space_id) return { error: 'space_id is required' };

    const pg = isPostgres();
    const query = pg
      ? 'SELECT id, name, icon, description, space_id, created_at, updated_at FROM projects WHERE space_id = $1 ORDER BY name LIMIT $2'
      : 'SELECT id, name, icon, description, space_id, created_at, updated_at FROM projects WHERE space_id = ? ORDER BY name LIMIT ?';

    const projects = await dbAll(query, [space_id, limit]);
    return { projects, total: projects.length };
  },

  async create_project({ space_id, name, icon = '📁', description = '' }, userId) {
    if (!space_id || !name) return { error: 'space_id and name are required' };

    const result = await dbRun(`
      INSERT INTO projects (space_id, name, icon, description, owner_id, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [space_id, name, icon, description, userId || 1, 'project']);

    const projectId = result.lastInsertRowid || result.lastID;
    return { success: true, project_id: projectId, message: `Project "${name}" created` };
  },

  async update_project({ project_id, name, icon, description }) {
    const project = await dbGet('SELECT * FROM projects WHERE id = ?', [project_id]);
    if (!project) return { error: `Project ${project_id} not found` };

    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (icon !== undefined) { updates.push('icon = ?'); params.push(icon); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (updates.length === 0) return { error: 'No fields to update' };

    updates.push(`updated_at = ${sqlNow()}`);
    params.push(project_id);
    await dbRun(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, params);
    return { success: true, message: `Project ${project_id} updated` };
  },

  async delete_project({ project_id }) {
    const project = await dbGet('SELECT id, name FROM projects WHERE id = ?', [project_id]);
    if (!project) return { error: `Project ${project_id} not found` };

    // Check for tables in this project
    const tableCount = await dbGet('SELECT COUNT(*) as cnt FROM universal_tables WHERE project_id = ?', [project_id]);
    if (tableCount?.cnt > 0) {
      return { error: `Project "${project.name}" has ${tableCount.cnt} tables. Delete them first.` };
    }

    await dbRun('DELETE FROM projects WHERE id = ?', [project_id]);
    return { success: true, message: `Project "${project.name}" deleted` };
  },

  // === ADR-0045 P1 — space/project move primitives ===

  // Create a top-level space. The caller becomes owner_id. is_public toggles
  // visibility between 'open' (anyone in the workspace can see) and 'internal'.
  async create_space({ name, type, icon, description, is_public }, userId) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return { error: 'name is required (non-empty string)' };
    }
    if (!type || typeof type !== 'string') {
      return { error: 'type is required (string)' };
    }
    const ownerId = Number(userId || 1);
    const visibility = is_public ? 'open' : 'internal';
    const iconVal = icon || '📁';
    const descVal = description ?? null;

    const result = await dbRun(`
      INSERT INTO spaces (owner_id, name, description, icon, type, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [ownerId, name, descVal, iconVal, type, visibility]);

    const spaceId = result.lastInsertRowid || result.lastID;
    return { success: true, space_id: spaceId, message: `Space "${name}" created` };
  },

  // Reparent a project to a different space. Verifies target space exists
  // and caller can administer BOTH source and target spaces.
  async move_project_to_space({ project_id, space_id }, userId) {
    if (typeof project_id !== 'number') return { error: 'project_id is required (number)' };
    if (typeof space_id !== 'number') return { error: 'space_id is required (number)' };

    const project = await dbGet('SELECT id, name, space_id FROM projects WHERE id = ?', [project_id]);
    if (!project) return { error: `Project ${project_id} not found` };

    const targetSpace = await dbGet('SELECT id, name FROM spaces WHERE id = ?', [space_id]);
    if (!targetSpace) return { error: `Target space ${space_id} not found` };

    if (Number(project.space_id) === Number(space_id)) {
      return { success: true, project_id, space_id, message: 'Project already in target space (noop)' };
    }

    const callerId = Number(userId || 1);
    if (project.space_id) {
      const okSource = await canAdminister(callerId, { spaceId: project.space_id });
      if (!okSource) return { error: `caller is not admin of source space ${project.space_id}`, code: 'AUTH' };
    }
    const okTarget = await canAdminister(callerId, { spaceId: space_id });
    if (!okTarget) return { error: `caller is not admin of target space ${space_id}`, code: 'AUTH' };

    await dbRun(`UPDATE projects SET space_id = ?, updated_at = ${sqlNow()} WHERE id = ?`, [space_id, project_id]);
    return {
      success: true,
      project_id,
      from_space_id: project.space_id,
      to_space_id: space_id,
      message: `Project "${project.name}" moved to space ${space_id}`,
    };
  },

  // Reparent a universal_tables row to a different project. Only the metadata
  // row is updated — table_rows / table_columns are untouched (data stays
  // physically where it was; just appears under a new project in the UI).
  async move_table_to_project({ table_id, project_id }, userId) {
    if (typeof table_id !== 'number') return { error: 'table_id is required (number)' };
    if (typeof project_id !== 'number') return { error: 'project_id is required (number)' };

    const table = await dbGet('SELECT id, name, project_id FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) return { error: `Table ${table_id} not found` };

    const targetProject = await dbGet('SELECT id, name, space_id FROM projects WHERE id = ?', [project_id]);
    if (!targetProject) return { error: `Target project ${project_id} not found` };

    if (Number(table.project_id) === Number(project_id)) {
      return { success: true, table_id, project_id, message: 'Table already in target project (noop)' };
    }

    const callerId = Number(userId || 1);
    const sourceProject = await dbGet('SELECT space_id FROM projects WHERE id = ?', [table.project_id]);
    if (sourceProject?.space_id) {
      const okSource = await canAdminister(callerId, { spaceId: sourceProject.space_id });
      if (!okSource) return { error: `caller is not admin of source space ${sourceProject.space_id}`, code: 'AUTH' };
    }
    if (targetProject.space_id) {
      const okTarget = await canAdminister(callerId, { spaceId: targetProject.space_id });
      if (!okTarget) return { error: `caller is not admin of target space ${targetProject.space_id}`, code: 'AUTH' };
    }

    await dbRun(`UPDATE universal_tables SET project_id = ?, updated_at = ${sqlNow()} WHERE id = ?`, [project_id, table_id]);
    return {
      success: true,
      table_id,
      from_project_id: table.project_id,
      to_project_id: project_id,
      message: `Table "${table.name}" moved to project ${project_id}`,
    };
  },

  // Two-phase destructive op: dry_run=true returns a preview, dry_run=false
  // (default) requires a prior dry_run in the same conversation and then
  // drops all child tables/dashboards/widgets + the project itself in one tx.
  async delete_project_cascade({ project_id, dry_run = false }, userId, ctx = {}) {
    if (typeof project_id !== 'number') return { error: 'project_id is required (number)' };
    const project = await dbGet('SELECT id, name, space_id FROM projects WHERE id = ?', [project_id]);
    if (!project) return { error: `Project ${project_id} not found` };

    const callerId = Number(userId || 1);
    if (project.space_id) {
      const okAdmin = await canAdminister(callerId, { spaceId: project.space_id });
      if (!okAdmin) return { error: `caller is not admin of space ${project.space_id}`, code: 'AUTH' };
    }

    const tables = await dbAll(
      'SELECT id, name FROM universal_tables WHERE project_id = ?',
      [project_id]
    );
    const tableIds = tables.map(t => t.id);

    let rowsCount = 0;
    if (tableIds.length > 0) {
      const placeholders = isPostgres()
        ? `($1::int[])`
        : tableIds.map(() => '?').join(',');
      const sql = isPostgres()
        ? `SELECT COUNT(*) AS cnt FROM table_rows WHERE table_id = ANY${placeholders}`
        : `SELECT COUNT(*) AS cnt FROM table_rows WHERE table_id IN (${placeholders})`;
      const row = await dbGet(sql, isPostgres() ? [tableIds] : tableIds);
      rowsCount = Number(row?.cnt || 0);
    }

    const dashboards = await dbAll(
      'SELECT id, name FROM dashboards WHERE project_id = ?',
      [project_id]
    );
    const dashboardIds = dashboards.map(d => d.id);

    if (dry_run) {
      _recordCascadePreview(ctx.conversationId ?? null, project_id);
      return {
        success: true,
        dry_run: true,
        project_id,
        project_name: project.name,
        tables_to_drop: tables.map(t => ({ id: t.id, name: t.name })),
        rows_count: rowsCount,
        dashboards_count: dashboards.length,
        dashboards: dashboards.map(d => ({ id: d.id, name: d.name })),
        message: `Preview only. Call again with dry_run=false within ${Math.round(CASCADE_PREVIEW_TTL_MS / 60000)}m to execute.`,
      };
    }

    if (!_hasCascadePreview(ctx.conversationId ?? null, project_id)) {
      return {
        error: 'preview required',
        code: 'PREVIEW_REQUIRED',
        message: `delete_project_cascade requires a dry_run=true call first in the same conversation`,
      };
    }

    try {
      const result = await withTransactionAsync(async (trx) => {
        const pg = isPostgres();
        const sqlNowExpr = sqlNow();

        let droppedTables = 0;
        let droppedDashboards = 0;
        let droppedWidgets = 0;

        if (tableIds.length > 0) {
          if (pg) {
            await trx.run('DELETE FROM table_rows WHERE table_id = ANY($1::int[])', [tableIds]);
            await trx.run('DELETE FROM table_columns WHERE table_id = ANY($1::int[])', [tableIds]);
            const dt = await trx.run('DELETE FROM universal_tables WHERE id = ANY($1::int[])', [tableIds]);
            droppedTables = dt?.rowCount ?? tableIds.length;
          } else {
            const ph = tableIds.map(() => '?').join(',');
            await trx.run(`DELETE FROM table_rows WHERE table_id IN (${ph})`, tableIds);
            await trx.run(`DELETE FROM table_columns WHERE table_id IN (${ph})`, tableIds);
            await trx.run(`DELETE FROM universal_tables WHERE id IN (${ph})`, tableIds);
            droppedTables = tableIds.length;
          }
        }

        if (dashboardIds.length > 0) {
          if (pg) {
            const dw = await trx.run('DELETE FROM widgets WHERE dashboard_id = ANY($1::int[])', [dashboardIds]);
            droppedWidgets = dw?.rowCount ?? 0;
            await trx.run('DELETE FROM dashboards WHERE id = ANY($1::int[])', [dashboardIds]);
            droppedDashboards = dashboardIds.length;
          } else {
            const ph = dashboardIds.map(() => '?').join(',');
            await trx.run(`DELETE FROM widgets WHERE dashboard_id IN (${ph})`, dashboardIds);
            await trx.run(`DELETE FROM dashboards WHERE id IN (${ph})`, dashboardIds);
            droppedDashboards = dashboardIds.length;
          }
        }

        await trx.run('DELETE FROM projects WHERE id = ?', [project_id]);

        return { droppedTables, droppedDashboards, droppedWidgets };
      });

      _cascadePreviewedAt.delete(_cascadeKey(ctx.conversationId ?? null, project_id));

      return {
        success: true,
        project_id,
        project_name: project.name,
        dropped_tables: result.droppedTables,
        dropped_dashboards: result.droppedDashboards,
        dropped_widgets: result.droppedWidgets,
        message: `Project "${project.name}" and all its children dropped`,
      };
    } catch (err) {
      apiLogger.error({ err: err.message, project_id }, 'delete_project_cascade failed');
      return { error: err.message };
    }
  },

  // Exposed for tests only — clears the preview cache between cases.
  _resetCascadePreviewsForTests() {
    _cascadePreviewedAt.clear();
  },
};
