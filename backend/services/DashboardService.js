// Dashboard Service - v0.003.000
// Manages 3 types of dashboards: USER, SPACE, PROJECT
import { dbRun, dbGet, dbAll, toBool, withTransactionAsync } from '../database/connection.js';

/**
 * Get space dashboard (default dashboard for space).
 * Lazily creates a default dashboard if the space does not have one yet —
 * legacy spaces (and those created via ImportService.importSpace) did not
 * always get one, which caused the frontend to render the
 * "Dashboard not available" stub instead of the empty add-widget frame.
 * @param {number} spaceId - Space ID
 * @param {object} [opts]
 * @param {object} [opts.trx] - an OPEN transaction handle to resolve (and lazily create)
 *   within. ADR-200 W3 puts a module's widgets on this dashboard in the same transaction as
 *   everything else it installs, and a space that never had a default board must get one on
 *   that same commit — a widget on a NON-default board is unreachable, because
 *   `/spaces/:id/dashboard` renders only the default one and offers no switcher.
 * @returns {Promise<object|null>} Dashboard or null if space itself is missing
 */
export async function getSpaceDashboard(spaceId, { trx = null } = {}) {
  const get = trx ? (sql, params) => trx.get(sql, params) : dbGet;
  const run = trx ? (sql, params) => trx.run(sql, params) : dbRun;

  const existing = await get(`
    SELECT * FROM dashboards
    WHERE space_id = ? AND is_default = ?
    ORDER BY id ASC
  `, [spaceId, toBool(true)]);

  if (existing) return existing;

  const space = await get('SELECT name FROM spaces WHERE id = ?', [spaceId]);
  if (!space) return null;

  await run(`
    INSERT INTO dashboards (space_id, name, icon, is_default, order_index)
    VALUES (?, ?, ?, ?, 0)
  `, [spaceId, `${space.name} Overview`, '📊', toBool(true)]);

  return await get(`
    SELECT * FROM dashboards
    WHERE space_id = ? AND is_default = ?
    ORDER BY id ASC
  `, [spaceId, toBool(true)]);
}

/**
 * Get user dashboard (main dashboard for user)
 * @param {number} userId - User ID
 * @returns {Promise<object|null>} Dashboard or null
 */
export async function getUserDashboard(userId) {
  return await dbGet(`
    SELECT * FROM dashboards 
    WHERE user_id = ? AND is_default = ?
  `, [userId, toBool(true)]);
}

/**
 * Get project dashboards
 * @param {number} projectId - Project ID
 * @returns {Promise<array>} Array of dashboards
 */
export async function getProjectDashboards(projectId) {
  return await dbAll(`
    SELECT * FROM dashboards 
    WHERE project_id = ?
    ORDER BY is_default DESC, order_index ASC
  `, [projectId]);
}

/**
 * Create dashboard
 * @param {object} dashboardData - { user_id?, space_id?, project_id?, name, description?, icon?, is_default? }
 * @returns {Promise<object>} Created dashboard
 */
export async function createDashboard(dashboardData) {
  const {
    user_id = null,
    space_id = null,
    project_id = null,
    name,
    description = null,
    icon = '📊',
    is_default = false
  } = dashboardData;

  // Validation: exactly one parent
  const parents = [user_id, space_id, project_id].filter(id => id != null);
  if (parents.length !== 1) {
    throw new Error('Dashboard must have exactly one parent (user_id, space_id, or project_id)');
  }

  const result = await dbRun(`
    INSERT INTO dashboards (user_id, space_id, project_id, name, description, icon, is_default, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `, [
    user_id,
    space_id,
    project_id,
    name,
    description,
    icon,
    toBool(is_default)
  ]);

  const dashboardId = result.lastInsertRowid || result.lastID;
  return await getDashboardById(dashboardId);
}

/**
 * Get dashboard by ID
 * @param {number} dashboardId - Dashboard ID
 * @returns {Promise<object|null>} Dashboard or null
 */
export async function getDashboardById(dashboardId) {
  return await dbGet('SELECT * FROM dashboards WHERE id = ?', [dashboardId]);
}

/** Delete only an empty dashboard. Ownership and dependencies share one transaction. */
export async function deleteEmptyDashboard(dashboardId, user) {
  return withTransactionAsync(async (trx) => {
    // Widget writers hold KEY SHARE until their insert/move commits.
    const dashboard = await trx.get('SELECT * FROM dashboards WHERE id = ? FOR UPDATE', [dashboardId]);
    if (!dashboard) throw Object.assign(new Error('Dashboard not found'), { code: 'NOT_FOUND', status: 404 });

    const parents = [dashboard.user_id, dashboard.space_id, dashboard.project_id].filter(id => id != null);
    if (parents.length !== 1) {
      throw Object.assign(new Error('Dashboard must have exactly one parent'), { code: 'DASHBOARD_PARENT_INVALID', status: 409 });
    }
    // SHARE also prevents an ownership change during authorization, unlike KEY SHARE.
    const parent = dashboard.project_id != null
      ? await trx.get('SELECT owner_id FROM projects WHERE id = ? FOR SHARE', [dashboard.project_id])
      : dashboard.space_id != null
        ? await trx.get('SELECT owner_id FROM spaces WHERE id = ? FOR SHARE', [dashboard.space_id])
        : await trx.get('SELECT id AS owner_id FROM users WHERE id = ? FOR SHARE', [dashboard.user_id]);
    if (!parent) throw Object.assign(new Error('Dashboard parent not found'), { code: 'NOT_FOUND', status: 404 });
    if (parent.owner_id !== user.id && user.role !== 'admin' && user.role !== 'owner') {
      throw Object.assign(new Error('Only the parent owner or administrator can delete this dashboard'), { code: 'FORBIDDEN', status: 403 });
    }

    const deleted = await trx.get(`
      DELETE FROM dashboards d WHERE d.id = ? AND NOT EXISTS (
        SELECT 1 FROM widgets w WHERE w.dashboard_id = d.id
          OR (w.owner_kind = 'dashboard' AND w.owner_id = d.id)
      ) RETURNING d.id
    `, [dashboardId]);
    if (!deleted) {
      throw Object.assign(new Error('Remove widgets before deleting this dashboard'), { code: 'DASHBOARD_NOT_EMPTY', status: 409 });
    }
    return deleted;
  });
}
