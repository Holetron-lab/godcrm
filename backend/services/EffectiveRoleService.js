// Effective Role Service - v0.001.000
// ADR-105: Role inheritance and effective role calculation
// Calculates a user's effective role using the inheritance chain:
//   Space > Project > Table > View
//
// Rules:
//   - Most specific role wins (view > table > project > space)
//   - 'denied' at ANY level blocks access regardless of other roles
//   - For 'open' visibility spaces: default to 'viewer' if no explicit role
//
// Uses PostgreSQL resource_type/resource_id/permission schema.

import { dbGet, dbAll, safeJsonParse } from '../database/connection.js';
import { isOpenSpace } from './SpaceVisibilityService.js';
import { apiLogger } from '../utils/logger.js';

// ============================================================
// Constants
// ============================================================

/**
 * Access level hierarchy (higher = more privileges)
 */
export const ACCESS_LEVEL_VALUES = {
  owner_owner: 100,
  owner: 80,
  admin: 60,
  editor: 40,
  viewer: 20,
  denied: 0
};

/**
 * Valid access levels
 */
const VALID_ACCESS_LEVELS = Object.keys(ACCESS_LEVEL_VALUES);

/**
 * Resource types used in the inheritance chain
 */
const RESOURCE_TYPES = ['space', 'project', 'table', 'view'];

// ============================================================
// Internal helpers
// ============================================================

/**
 * Normalise a permission string to a canonical key
 * that exists in ACCESS_LEVEL_VALUES.
 *
 * @param {string|null} raw - Raw value from the DB
 * @returns {string|null} Canonical access level or null
 */
function normaliseAccessLevel(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lower = raw.toLowerCase().trim();
  return VALID_ACCESS_LEVELS.includes(lower) ? lower : null;
}

/**
 * Query a user's explicit permission at a given resource level.
 *
 * @param {number} userId
 * @param {string} resourceType - 'space' | 'project' | 'table' | 'view'
 * @param {number|string} resourceId
 * @returns {Promise<string|null>} access level string or null
 */
async function queryPermissionAtLevel(userId, resourceType, resourceId) {
  if (!userId || !resourceType || !resourceId) return null;

  const row = await dbGet(
    `SELECT permission FROM user_access_permissions
     WHERE user_id = ? AND resource_type = ? AND resource_id = ?
     LIMIT 1`,
    [userId, resourceType, String(resourceId)]
  );
  return row ? normaliseAccessLevel(row.permission) : null;
}

/**
 * Resolve the parent chain IDs for a given resource.
 *
 * Given a tableId, looks up its project_id and the project's space_id.
 * Given a projectId, looks up its space_id.
 *
 * @param {object} opts - { spaceId?, projectId?, tableId?, viewId? }
 * @returns {Promise<{ spaceId: number|null, projectId: number|null, tableId: number|null, viewId: number|null }>}
 */
async function resolveHierarchy({ spaceId = null, projectId = null, tableId = null, viewId = null }) {
  const resolved = {
    spaceId: spaceId ? Number(spaceId) : null,
    projectId: projectId ? Number(projectId) : null,
    tableId: tableId ? Number(tableId) : null,
    viewId: viewId ? Number(viewId) : null
  };

  // If we have a tableId but no projectId, look it up
  if (resolved.tableId && !resolved.projectId) {
    const table = await dbGet(
      'SELECT project_id FROM universal_tables WHERE id = ?',
      [resolved.tableId]
    );
    if (table) {
      resolved.projectId = table.project_id;
    }
  }

  // If we have a projectId but no spaceId, look it up
  if (resolved.projectId && !resolved.spaceId) {
    const project = await dbGet(
      'SELECT space_id FROM projects WHERE id = ?',
      [resolved.projectId]
    );
    if (project) {
      resolved.spaceId = project.space_id;
    }
  }

  return resolved;
}

/**
 * Check whether a user is the owner_owner (creator) of a space.
 * The space's owner_id field represents the creator / owner_owner.
 *
 * @param {number} userId
 * @param {number} spaceId
 * @returns {Promise<boolean>}
 */
async function isSpaceOwnerOwner(userId, spaceId) {
  if (!userId || !spaceId) return false;
  const space = await dbGet('SELECT owner_id FROM spaces WHERE id = ?', [spaceId]);
  return space ? space.owner_id === userId : false;
}

/**
 * Check whether a user is the owner/owner_owner of a project.
 *
 * @param {number} userId
 * @param {number} projectId
 * @returns {Promise<boolean>}
 */
async function isProjectOwnerOwner(userId, projectId) {
  if (!userId || !projectId) return false;
  const project = await dbGet(
    'SELECT owner_id, owner_owner_id FROM projects WHERE id = ?',
    [projectId]
  );
  if (!project) return false;
  return project.owner_id === userId || project.owner_owner_id === userId;
}

// ============================================================
// Public API
// ============================================================

/**
 * Calculate the effective role for a user at a given resource level.
 *
 * Inheritance chain (most specific wins):
 *   view > table > project > space > open_default
 *
 * If 'denied' is found at ANY level the user is blocked.
 *
 * @param {number} userId
 * @param {object} opts
 * @param {number}  opts.spaceId   - Required
 * @param {number} [opts.projectId]
 * @param {number} [opts.tableId]
 * @param {number} [opts.viewId]
 * @returns {Promise<{ effectiveRole: string, source: string, details: object }>}
 */
export async function getEffectiveRole(userId, { spaceId, projectId, tableId, viewId } = {}) {
  if (!userId) {
    return { effectiveRole: 'denied', source: 'none', details: { reason: 'no userId provided' } };
  }

  // 1. Resolve the full hierarchy (fill in missing parent IDs)
  const hierarchy = await resolveHierarchy({ spaceId, projectId, tableId, viewId });

  if (!hierarchy.spaceId) {
    return { effectiveRole: 'denied', source: 'none', details: { reason: 'could not resolve spaceId' } };
  }

  // 2. Check owner_owner status first (space creator always gets owner_owner)
  if (await isSpaceOwnerOwner(userId, hierarchy.spaceId)) {
    return {
      effectiveRole: 'owner_owner',
      source: 'space',
      details: { reason: 'space creator (owner_id)', hierarchy }
    };
  }

  // Also check project owner_owner if we have a projectId
  if (hierarchy.projectId && await isProjectOwnerOwner(userId, hierarchy.projectId)) {
    return {
      effectiveRole: 'owner_owner',
      source: 'project',
      details: { reason: 'project owner / owner_owner', hierarchy }
    };
  }

  // 3. Collect explicit permissions at each level (bottom-up for specificity,
  //    but we also need all levels to check for 'denied' anywhere)
  const permissions = {};
  const levels = []; // ordered from most to least specific

  if (hierarchy.viewId) {
    permissions.view = await queryPermissionAtLevel(userId, 'view', hierarchy.viewId);
    levels.push('view');
  }
  if (hierarchy.tableId) {
    permissions.table = await queryPermissionAtLevel(userId, 'table', hierarchy.tableId);
    levels.push('table');
  }
  if (hierarchy.projectId) {
    permissions.project = await queryPermissionAtLevel(userId, 'project', hierarchy.projectId);
    levels.push('project');
  }
  if (hierarchy.spaceId) {
    permissions.space = await queryPermissionAtLevel(userId, 'space', hierarchy.spaceId);
    levels.push('space');
  }

  // 4. 'denied' at ANY level blocks the user immediately
  for (const level of levels) {
    if (permissions[level] === 'denied') {
      return {
        effectiveRole: 'denied',
        source: level,
        details: { reason: `explicitly denied at ${level} level`, permissions, hierarchy }
      };
    }
  }

  // 5. Most specific explicit role wins
  for (const level of levels) {
    if (permissions[level]) {
      return {
        effectiveRole: permissions[level],
        source: level,
        details: { permissions, hierarchy }
      };
    }
  }

  // 6. No explicit role found anywhere -- check 'open' visibility fallback
  try {
    const open = await isOpenSpace(hierarchy.spaceId);
    if (open) {
      return {
        effectiveRole: 'viewer',
        source: 'open_default',
        details: { reason: 'space has open visibility, default viewer', permissions, hierarchy }
      };
    }
  } catch (err) {
    // isOpenSpace may throw if space not found; treat as non-open
    apiLogger.warn({ spaceId: hierarchy.spaceId, err: err.message }, 'isOpenSpace check failed');
  }

  // 7. No role at all
  return {
    effectiveRole: 'denied',
    source: 'none',
    details: { reason: 'no explicit role and space is not open', permissions, hierarchy }
  };
}

/**
 * Check whether a user meets or exceeds a required access level.
 *
 * @param {number} userId
 * @param {string} requiredLevel - One of ACCESS_LEVEL_VALUES keys
 * @param {object} opts - { spaceId, projectId?, tableId?, viewId? }
 * @returns {Promise<boolean>}
 */
export async function hasPermission(userId, requiredLevel, opts = {}) {
  const requiredValue = ACCESS_LEVEL_VALUES[requiredLevel];
  if (requiredValue === undefined) {
    apiLogger.warn({ requiredLevel }, '[EffectiveRole] Unknown required access level');
    return false;
  }

  const { effectiveRole } = await getEffectiveRole(userId, opts);
  const effectiveValue = ACCESS_LEVEL_VALUES[effectiveRole] ?? 0;

  return effectiveValue >= requiredValue;
}

/**
 * Shorthand: can the user edit (editor level or above)?
 *
 * @param {number} userId
 * @param {object} opts - { spaceId, projectId?, tableId? }
 * @returns {Promise<boolean>}
 */
export async function canEdit(userId, opts = {}) {
  return hasPermission(userId, 'editor', opts);
}

/**
 * Shorthand: can the user view (viewer level or above)?
 *
 * @param {number} userId
 * @param {object} opts - { spaceId, projectId?, tableId? }
 * @returns {Promise<boolean>}
 */
export async function canView(userId, opts = {}) {
  return hasPermission(userId, 'viewer', opts);
}

/**
 * Shorthand: can the user administer (admin level or above)?
 *
 * @param {number} userId
 * @param {object} opts - { spaceId }
 * @returns {Promise<boolean>}
 */
export async function canAdminister(userId, opts = {}) {
  return hasPermission(userId, 'admin', opts);
}

/**
 * Get all users that have any role within a space (including inherited roles
 * from projects, tables, and views that belong to the space).
 *
 * Returns each user's effective role at the space level together with any
 * more-specific roles they hold inside the space.
 *
 * @param {number} spaceId
 * @returns {Promise<Array<{ userId: number, name: string, email: string, avatar: string|null, effectiveRole: string, source: string, roles: object }>>}
 */
export async function getUsersWithRoles(spaceId) {
  if (!spaceId) return [];

  // Collect distinct user IDs that have any permission touching this space.
  // We look at:
  //   1. Direct space-level permissions
  //   2. Project-level permissions for projects in this space
  //   3. Table-level permissions for tables in projects in this space
  //   4. View-level permissions (if present)
  //   5. Space owner_id (always included as owner_owner)

  const userIdSet = new Set();
  const perUserRoles = {}; // userId -> { space, project, table, view }

  // Helper to record a role hit
  const recordRole = (uid, level, role, resourceId) => {
    if (!uid) return;
    const key = String(uid);
    userIdSet.add(key);
    if (!perUserRoles[key]) {
      perUserRoles[key] = {};
    }
    if (!perUserRoles[key][level]) {
      perUserRoles[key][level] = [];
    }
    perUserRoles[key][level].push({ role, resourceId });
  };

  // --- Gather project IDs and table IDs that belong to this space ---
  const projects = await dbAll(
    'SELECT id FROM projects WHERE space_id = ?',
    [spaceId]
  );
  const projectIds = projects.map(p => p.id);

  let tableIds = [];
  if (projectIds.length > 0) {
    const placeholders = projectIds.map(() => '?').join(',');
    const tables = await dbAll(
      `SELECT id FROM universal_tables WHERE project_id IN (${placeholders})`,
      projectIds
    );
    tableIds = tables.map(t => t.id);
  }

  // --- Query permissions (PostgreSQL: resource_type / resource_id schema) ---
  // Space-level
  const spacePerms = await dbAll(
    `SELECT user_id, permission FROM user_access_permissions
     WHERE resource_type = 'space' AND resource_id = ?`,
    [String(spaceId)]
  );
  for (const p of spacePerms) {
    recordRole(p.user_id, 'space', normaliseAccessLevel(p.permission), spaceId);
  }

  // Project-level
  if (projectIds.length > 0) {
    const phProject = projectIds.map(() => '?').join(',');
    const projectPerms = await dbAll(
      `SELECT user_id, permission, resource_id FROM user_access_permissions
       WHERE resource_type = 'project' AND resource_id IN (${phProject})`,
      projectIds.map(String)
    );
    for (const p of projectPerms) {
      recordRole(p.user_id, 'project', normaliseAccessLevel(p.permission), p.resource_id);
    }
  }

  // Table-level
  if (tableIds.length > 0) {
    const phTable = tableIds.map(() => '?').join(',');
    const tablePerms = await dbAll(
      `SELECT user_id, permission, resource_id FROM user_access_permissions
       WHERE resource_type = 'table' AND resource_id IN (${phTable})`,
      tableIds.map(String)
    );
    for (const p of tablePerms) {
      recordRole(p.user_id, 'table', normaliseAccessLevel(p.permission), p.resource_id);
    }
  }

  // View-level (views do not have a dedicated views table yet, query by type)
  const viewPerms = await dbAll(
    `SELECT user_id, permission, resource_id FROM user_access_permissions
     WHERE resource_type = 'view' AND resource_id IS NOT NULL`,
    []
  );
  // We cannot easily filter views by space right now; include all view perms
  // for users who already appear in the space
  for (const p of viewPerms) {
    if (userIdSet.has(String(p.user_id))) {
      recordRole(p.user_id, 'view', normaliseAccessLevel(p.permission), p.resource_id);
    }
  }

  // Always include the space owner
  const space = await dbGet('SELECT owner_id FROM spaces WHERE id = ?', [spaceId]);
  if (space?.owner_id) {
    const ownerKey = String(space.owner_id);
    userIdSet.add(ownerKey);
    if (!perUserRoles[ownerKey]) {
      perUserRoles[ownerKey] = {};
    }
    // Mark as owner_owner at space level
    if (!perUserRoles[ownerKey].space) {
      perUserRoles[ownerKey].space = [];
    }
    perUserRoles[ownerKey].space.push({ role: 'owner_owner', resourceId: spaceId });
  }

  // --- Build result: compute effective role per user ---
  const userIds = [...userIdSet].map(Number);
  if (userIds.length === 0) return [];

  // Fetch user info in one query
  const phUsers = userIds.map(() => '?').join(',');
  const users = await dbAll(
    `SELECT id, name, email, avatar FROM users WHERE id IN (${phUsers})`,
    userIds
  );
  const userMap = {};
  for (const u of users) {
    userMap[u.id] = u;
  }

  const results = [];

  for (const uid of userIds) {
    const user = userMap[uid];
    if (!user) continue;

    // Compute effective role at space level using getEffectiveRole
    const { effectiveRole, source } = await getEffectiveRole(uid, { spaceId });

    results.push({
      userId: uid,
      name: user.name || null,
      email: user.email || null,
      avatar: user.avatar || null,
      effectiveRole,
      source,
      roles: perUserRoles[String(uid)] || {}
    });
  }

  // Sort: owner_owner first, then by access level descending, then by name
  results.sort((a, b) => {
    const valA = ACCESS_LEVEL_VALUES[a.effectiveRole] ?? 0;
    const valB = ACCESS_LEVEL_VALUES[b.effectiveRole] ?? 0;
    if (valB !== valA) return valB - valA;
    return (a.name || '').localeCompare(b.name || '');
  });

  return results;
}
