// Dashboard Service - v0.003.000
// Manages 3 types of dashboards: USER, SPACE, PROJECT
import { dbRun, dbGet, dbAll, toBool } from '../database/connection.js';

/**
 * Get space dashboard (default dashboard for space).
 * Lazily creates a default dashboard if the space does not have one yet —
 * legacy spaces (and those created via ImportService.importSpace) did not
 * always get one, which caused the frontend to render the
 * "Dashboard not available" stub instead of the empty add-widget frame.
 * @param {number} spaceId - Space ID
 * @returns {Promise<object|null>} Dashboard or null if space itself is missing
 */
export async function getSpaceDashboard(spaceId) {
  const existing = await dbGet(`
    SELECT * FROM dashboards
    WHERE space_id = ? AND is_default = ?
    ORDER BY id ASC
  `, [spaceId, toBool(true)]);

  if (existing) return existing;

  const space = await dbGet('SELECT name FROM spaces WHERE id = ?', [spaceId]);
  if (!space) return null;

  await dbRun(`
    INSERT INTO dashboards (space_id, name, icon, is_default, order_index)
    VALUES (?, ?, ?, ?, 0)
  `, [spaceId, `${space.name} Overview`, '📊', toBool(true)]);

  return await dbGet(`
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
