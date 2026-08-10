/**
 * space/crud.js — Space CRUD operations
 *
 * Extracted from SpaceService.js.
 * Handles createSpace, getSpaceById, getSpacesByUser, updateSpace, deleteSpace.
 */

import { dbRun, dbGet, dbAll, toBool, safeJsonParse } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { checkUserSpaceAccess, checkUserAccessViaTableV2 } from './access.js';

/**
 * Valid space types
 */
const SPACE_TYPES = ['business', 'personal', 'admin'];

/**
 * Default theme colors
 */
const DEFAULT_THEME = {
  primary: '#0ea5e9',
  secondary: '#8b5cf6',
  tertiary: '#10b981'
};

/**
 * Validate space data
 * @param {object} spaceData - Space data to validate
 * @throws {Error} If validation fails
 */
function validateSpaceData(spaceData) {
  const { owner_id, name, type } = spaceData;

  if (!owner_id) {
    throw new Error('owner_id is required');
  }

  if (!name) {
    throw new Error('name is required');
  }

  if (!type || !SPACE_TYPES.includes(type)) {
    throw new Error(`Invalid space type. Must be: ${SPACE_TYPES.join(', ')}`);
  }
}

/**
 * Create a new space
 * @param {object} spaceData - { owner_id, name, description?, icon?, type, theme_*, settings? }
 * @returns {Promise<object>} Created space
 */
export async function createSpace(spaceData) {
  const {
    owner_id,
    name,
    description = null,
    icon = '\ud83d\udcc1',
    type,
    theme_primary = DEFAULT_THEME.primary,
    theme_secondary = DEFAULT_THEME.secondary,
    theme_tertiary = DEFAULT_THEME.tertiary,
    settings = null
  } = spaceData;

  // Validation
  validateSpaceData(spaceData);

  // Create space
  const result = await dbRun(`
    INSERT INTO spaces (owner_id, name, description, icon, type, theme_primary, theme_secondary, theme_tertiary, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    owner_id,
    name,
    description,
    icon,
    type,
    theme_primary,
    theme_secondary,
    theme_tertiary,
    settings ? JSON.stringify(settings) : null
  ]);

  const spaceId = result.lastInsertRowid || result.lastID;

  // Auto-create space dashboard
  await createSpaceDashboard(spaceId, name);

  // ADR-0079: personal spaces no longer get an auto-created Password Manager.
  // The starter pack (StarterPackService) owns the single auto-project ("Home").
  // Password Manager remains available on demand via the system-tables creator.

  return await getSpaceById(spaceId);
}

/**
 * Create default dashboard for space
 * @param {number} spaceId - Space ID
 * @param {string} spaceName - Space name
 * @returns {Promise<object>} Created dashboard
 */
async function createSpaceDashboard(spaceId, spaceName) {
  const result = await dbRun(`
    INSERT INTO dashboards (space_id, name, icon, is_default, order_index)
    VALUES (?, ?, ?, ?, ?)
  `, [
    spaceId,
    `${spaceName} Overview`,
    '\ud83d\udcca',
    toBool(true),
    0
  ]);

  return result;
}

/**
 * Get all spaces for a user
 * @param {number} userId - User ID
 * @param {string} userRole - User role (admin, owner, etc)
 * @returns {Promise<array>} Array of spaces with counts
 */
export async function getSpacesByUser(userId, userRole = 'user') {
  // ADR-0009 Phase 1 (C-7): Eliminate N+1 by pre-filtering spaces in SQL
  // and batch-loading explicit permissions + per-space user_rows counts.
  //
  // Old behaviour: SELECT all 5392 spaces, then run 3-5 DB calls per row in JS.
  // New behaviour for non-admins: SELECT only spaces owned by user OR visible
  // via `user_access_permissions` OR with `visibility='open'` OR type='admin'
  // (the old JS filter also included `accessControl.members` legacy format and
  // table-based access — those still need per-space work, so we keep the full
  // scan for admins/owners and for spaces with access_control set).

  const isPrivileged = userRole === 'owner' || userRole === 'admin';

  // Preload explicit grants for this user in ONE query.
  // Schema: user_access_permissions(user_id, space_id, access_level, ...)
  // (Note: the prior implementation used a query with non-existent
  // `resource_type/resource_id/permission` columns and silently swallowed
  // the error — this was a latent bug; we now query the correct columns.)
  let explicitByResourceId = new Map();
  try {
    const grants = await dbAll(
      `SELECT space_id, access_level FROM user_access_permissions
       WHERE user_id = ? AND space_id IS NOT NULL AND access_level != 'denied'`,
      [userId]
    );
    for (const g of grants) {
      // Keep keys as strings to match prior behaviour (accepting either shape).
      explicitByResourceId.set(String(g.space_id), g.access_level);
      explicitByResourceId.set(Number(g.space_id), g.access_level);
    }
  } catch {
    // If the table is missing or query fails, fall through with empty map.
  }

  // For non-privileged users, narrow candidate spaces in SQL.
  // We include: owned spaces, explicitly-granted spaces, open-visibility
  // spaces, admin-type spaces (privileged paths short-circuit), personal
  // spaces owned by us (already covered by owner_id), and *any* space with
  // access_control set (access is decided per-space below — still a narrow
  // set: ~9 rows today vs. 5392).
  let spacesSql;
  let spacesParams;
  if (isPrivileged) {
    // Admins/owners: see everything (preserve prior behaviour).
    spacesSql = `
      SELECT
        s.*,
        COALESCE((SELECT COUNT(*) FROM projects p WHERE p.space_id = s.id), 0) as projects_count,
        COALESCE((SELECT COUNT(*) FROM dashboards d WHERE d.space_id = s.id), 0) as dashboards_count
      FROM spaces s
      ORDER BY
        CASE s.type
          WHEN 'personal' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'business' THEN 3
          ELSE 4
        END,
        s.created_at DESC
    `;
    spacesParams = [];
  } else {
    const grantedSpaceIds = [];
    for (const key of explicitByResourceId.keys()) {
      if (typeof key === 'number') grantedSpaceIds.push(key);
    }
    spacesSql = `
      SELECT
        s.*,
        COALESCE((SELECT COUNT(*) FROM projects p WHERE p.space_id = s.id), 0) as projects_count,
        COALESCE((SELECT COUNT(*) FROM dashboards d WHERE d.space_id = s.id), 0) as dashboards_count
      FROM spaces s
      WHERE
        s.owner_id = ?
        OR s.id = ANY(?::int[])
        OR s.visibility = 'open'
        OR s.access_control IS NOT NULL
      ORDER BY
        CASE s.type
          WHEN 'personal' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'business' THEN 3
          ELSE 4
        END,
        s.created_at DESC
    `;
    spacesParams = [userId, grantedSpaceIds];
  }

  const allSpaces = await dbAll(spacesSql, spacesParams);

  // Collect all accessControls with usersTableId so we can batch-load table_rows.
  // Many spaces share zero table-backed ACLs; the set is typically tiny (~9).
  const spacesWithAccessControl = [];
  for (const space of allSpaces) {
    const accessControl = space.access_control
      ? (typeof space.access_control === 'string' ? safeJsonParse(space.access_control) : space.access_control)
      : null;
    if (accessControl?.enabled) {
      const usersTableId = accessControl.usersTableId || accessControl.users_table_id;
      if (usersTableId) {
        spacesWithAccessControl.push({ space, accessControl, usersTableId });
      }
    }
  }

  // Batch-load ALL table_rows we will need, in ONE query, grouped by table_id.
  const rowsByTableId = new Map();
  const distinctUsersTableIds = Array.from(
    new Set(spacesWithAccessControl.map(x => x.usersTableId).filter(Boolean))
  );
  if (distinctUsersTableIds.length > 0) {
    try {
      const batchRows = await dbAll(
        'SELECT id, table_id, data FROM table_rows WHERE table_id = ANY(?::int[])',
        [distinctUsersTableIds]
      );
      for (const row of batchRows) {
        const key = row.table_id;
        if (!rowsByTableId.has(key)) rowsByTableId.set(key, []);
        rowsByTableId.get(key).push(row);
      }
    } catch {
      // Fall back to per-space fetches below if batch fails.
    }
  }

  // Batch-load projects for every candidate space in ONE query; cap per-space
  // to 20 rows to match prior LIMIT 20 semantics. For admins, candidate set
  // can be 5392 spaces — this replaces 5392 DB calls with 1.
  const projectsBySpaceId = new Map();
  if (allSpaces.length > 0) {
    try {
      const candidateSpaceIds = allSpaces.map(s => s.id);
      const allProjects = await dbAll(
        `SELECT id, space_id, name, icon, created_at
         FROM projects
         WHERE space_id = ANY(?::int[])
         ORDER BY created_at DESC`,
        [candidateSpaceIds]
      );
      for (const p of allProjects) {
        const list = projectsBySpaceId.get(p.space_id) || [];
        if (list.length < 20) {
          list.push({ id: p.id, name: p.name, icon: p.icon });
          projectsBySpaceId.set(p.space_id, list);
        }
      }
    } catch {
      // Fall through to per-space fetch inside the loop.
    }
  }

  // Filter spaces based on access
  const accessibleSpaces = [];

  for (const space of allSpaces) {
    // Handle both string and object JSON (JSONB auto-parsed by driver)
    const accessControl = space.access_control
      ? (typeof space.access_control === 'string' ? safeJsonParse(space.access_control) : space.access_control)
      : null;

    // Precompute user access level for this space — cache the
    // checkUserAccessViaTableV2 result so the subsequent hasAccess check
    // can reuse it instead of repeating the query.
    let userAccessLevel = 'viewer';
    let cachedTableResult = null;
    if (space.owner_id === userId) {
      userAccessLevel = 'owner_owner';
    } else if (accessControl?.enabled) {
      cachedTableResult = await checkUserAccessViaTableV2(userId, accessControl);
      if (cachedTableResult.allowed && cachedTableResult.accessLevel) {
        userAccessLevel = cachedTableResult.accessLevel;
      } else if (cachedTableResult.accessLevel === 'denied') {
        userAccessLevel = 'denied';
      }
    } else if (userRole === 'owner' || userRole === 'admin') {
      userAccessLevel = 'admin';
    }

    // ADR-105: AC2 — Refine access level from user_access_permissions for open/invited spaces
    // Uses the pre-loaded map (no per-row DB call).
    if (userAccessLevel === 'viewer' && space.owner_id !== userId) {
      const explicit = explicitByResourceId.get(space.id) || explicitByResourceId.get(String(space.id));
      if (explicit) {
        userAccessLevel = explicit;
      }
    }

    // Check access — short-circuit cheap cases we can decide from memory
    // so we avoid the per-space explicit-perm DB lookup inside
    // checkUserSpaceAccess (already pre-loaded above). Reuse the cached
    // checkUserAccessViaTableV2 result for enabled-AC spaces.
    let hasAccess;
    if (space.owner_id === userId) {
      hasAccess = true;
    } else if (isPrivileged && space.type === 'admin') {
      hasAccess = true;
    } else if (explicitByResourceId.has(space.id) || explicitByResourceId.has(String(space.id))) {
      hasAccess = true;
    } else if (space.type === 'personal') {
      hasAccess = false;
    } else if (space.visibility === 'open') {
      hasAccess = true;
    } else if (!accessControl) {
      hasAccess = false;
    } else if (accessControl.members && Array.isArray(accessControl.members)) {
      // Legacy format — members array.
      hasAccess = accessControl.members.some(m => m.user_id === userId);
    } else if (accessControl.enabled && (accessControl.users_table_id || accessControl.usersTableId)) {
      // New/legacy table-based ACL — result already computed above.
      hasAccess = !!cachedTableResult?.allowed;
    } else {
      // Unknown shape — fall through to the full check to preserve behaviour.
      hasAccess = await checkUserSpaceAccess(userId, userRole, space, accessControl);
    }

    if (hasAccess) {
      // Handle both string and object JSON (JSONB auto-parsed by driver) for settings
      const parsedSettings = space.settings
        ? (typeof space.settings === 'string' ? safeJsonParse(space.settings) : space.settings)
        : null;

      // Calculate users by roles from linked users table if access control is enabled
      let users_count = 1; // Owner always counts
      let users_by_roles = { owners: 1, admins: 0, editors: 0, viewers: 0 }; // Owner included

      // Support both camelCase (usersTableId) and snake_case (users_table_id) from DB
      const usersTableId = accessControl?.usersTableId || accessControl?.users_table_id;

      if (accessControl?.enabled && usersTableId) {
        try {
          const role_column_id = accessControl.role_column_id;
          const role_mappings = accessControl.role_mappings || [];

          // Prefer pre-loaded rows (batched) — fall back to per-table fetch if missing.
          let userRows = rowsByTableId.get(Number(usersTableId)) || rowsByTableId.get(usersTableId);
          if (!userRows) {
            userRows = await dbAll(
              'SELECT id, table_id, data FROM table_rows WHERE table_id = ?',
              [usersTableId]
            );
          }

          // Count by roles
          const roleCounts = { owners: 0, admins: 0, editors: 0, viewers: 0 };
          let unmappedUsers = 0;

          for (const row of userRows) {
            const data = typeof row.data === 'string' ? safeJsonParse(row.data) : row.data;
            if (!data) continue;

            // Get role value from data
            const roleValue = data[role_column_id] || data.role;

            if (!roleValue) {
              // User without role - count as viewer
              roleCounts.viewers++;
              continue;
            }

            // Find mapping for this role value
            const mapping = role_mappings.find(m => m.columnValue === roleValue);
            if (mapping && mapping.accessLevel !== 'denied') {
              const level = mapping.accessLevel;
              if (level === 'owner') roleCounts.owners++;
              else if (level === 'admin') roleCounts.admins++;
              else if (level === 'editor') roleCounts.editors++;
              else if (level === 'viewer') roleCounts.viewers++;
            } else if (!mapping) {
              // Role not in mapping - count as viewer (default access)
              unmappedUsers++;
            }
          }

          // Add unmapped users as viewers
          roleCounts.viewers += unmappedUsers;

          // Space owner is not in the table, add manually
          users_by_roles = {
            owners: roleCounts.owners + 1, // +1 for space owner
            admins: roleCounts.admins,
            editors: roleCounts.editors,
            viewers: roleCounts.viewers
          };
          users_count = users_by_roles.owners + users_by_roles.admins + users_by_roles.editors + users_by_roles.viewers;
        } catch (e) {
          // Fallback to defaults if error
        }
      }

      // Get projects for this space (all for scrollable list)
      // Prefer batched map — falls back to per-space if batch failed.
      let projects = projectsBySpaceId.get(space.id);
      if (!projects) {
        try {
          projects = await dbAll(
            'SELECT id, name, icon FROM projects WHERE space_id = ? ORDER BY created_at DESC LIMIT 20',
            [space.id]
          );
        } catch (e) {
          projects = [];
        }
      }

      // Get users from linked table for display (all for scrollable list)
      let users = [];
      if (accessControl?.enabled && usersTableId) {
        try {
          const name_column_id = accessControl.name_column_id || accessControl.userNameColumn;
          const role_column_id = accessControl.role_column_id;
          const user_id_column =
            accessControl.user_id_column ||
            accessControl.userIdColumn ||
            'system_user_id';
          const role_mappings = accessControl.role_mappings || [];

          // Prefer pre-loaded rows (batched); fall back to per-table fetch.
          let userRows = rowsByTableId.get(Number(usersTableId)) || rowsByTableId.get(usersTableId);
          if (userRows) {
            userRows = userRows.slice(0, 50);
          } else {
            userRows = await dbAll(
              'SELECT id, data FROM table_rows WHERE table_id = ? LIMIT 50',
              [usersTableId]
            );
          }

          for (const row of userRows) {
            const data = typeof row.data === 'string' ? safeJsonParse(row.data) : row.data;
            if (!data) continue;

            // Try to get name from configured column, or common patterns
            // Column ID could be numeric key like "1534"
            let name = null;
            if (name_column_id && data[name_column_id]) {
              name = data[name_column_id];
            } else {
              // Try common patterns - look for name-like fields
              name = data.name || data.email || data['\u0418\u043c\u044f'] || null;
              // If not found, try to find a column that looks like name (string value, not email)
              if (!name) {
                for (const key of Object.keys(data)) {
                  const val = data[key];
                  if (typeof val === 'string' && val.length > 0 && val.length < 100 &&
                      !val.includes('@') && !/^\d+$/.test(val) &&
                      !['owner', 'admin', 'editor', 'viewer', 'denied', 'true', 'false'].includes(val.toLowerCase())) {
                    // This looks like a name
                    name = val;
                    break;
                  }
                }
              }
            }

            name = name || data.email || 'Unknown';

            const roleValue = data[role_column_id] || data.role;
            const mapping = role_mappings.find(m => m.columnValue === roleValue);
            const role = mapping?.accessLevel || 'viewer';

            // System user id — used by frontend to filter spaces by member.
            // Try configured user_id column first, then `system_user_id` fallback.
            const rawSysId = data[user_id_column] ?? data.system_user_id;
            let system_user_id = null;
            if (rawSysId !== undefined && rawSysId !== null && rawSysId !== '') {
              const n = Number(rawSysId);
              if (Number.isFinite(n)) system_user_id = n;
            }

            users.push({ id: row.id, name, role, system_user_id });
          }
        } catch (e) {
          // Ignore error
        }
      }

      // Parse tickets_config (JSONB may be auto-parsed or string)
      const parsedTicketsConfig = space.tickets_config
        ? (typeof space.tickets_config === 'string' ? safeJsonParse(space.tickets_config) : space.tickets_config)
        : null;

      // Parse files_config (JSONB may be auto-parsed or string)
      const parsedFilesConfig = space.files_config
        ? (typeof space.files_config === 'string' ? safeJsonParse(space.files_config) : space.files_config)
        : null;

      // Parse favorites_config (JSONB may be auto-parsed or string)
      const parsedFavoritesConfig = space.favorites_config
        ? (typeof space.favorites_config === 'string' ? safeJsonParse(space.favorites_config) : space.favorites_config)
        : null;

      accessibleSpaces.push({
        ...space,
        settings: parsedSettings,
        access_control: accessControl,
        tickets_config: parsedTicketsConfig,
        files_config: parsedFilesConfig,
        favorites_config: parsedFavoritesConfig,
        user_access_level: userAccessLevel,
        users_count,
        users_by_roles,
        projects,
        users
      });
    }
  }

  return accessibleSpaces;
}

/**
 * Get space by ID
 * @param {number} spaceId - Space ID
 * @returns {Promise<object|null>} Space object or null
 */
export async function getSpaceById(spaceId) {
  const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [spaceId]);

  if (!space) {
    return null;
  }

  return {
    ...space,
    settings: space.settings ? safeJsonParse(space.settings) : null,
    access_control: space.access_control ? safeJsonParse(space.access_control) : null,
    tickets_config: space.tickets_config ? safeJsonParse(space.tickets_config) : null,
    files_config: space.files_config ? safeJsonParse(space.files_config) : null,
    favorites_config: space.favorites_config ? safeJsonParse(space.favorites_config) : null
  };
}

/**
 * Update space
 * @param {number} spaceId - Space ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated space
 */
export async function updateSpace(spaceId, updates) {
  // Verify space exists
  const space = await getSpaceById(spaceId);
  if (!space) {
    throw new Error('Space not found');
  }

  const allowedFields = ['name', 'description', 'icon', 'theme_primary', 'theme_secondary', 'theme_tertiary', 'settings', 'access_control', 'tickets_config', 'files_config', 'favorites_config'];
  const updatesFields = Object.keys(updates).filter(key => allowedFields.includes(key) && updates[key] !== undefined);

  if (updatesFields.length === 0) {
    return space;
  }

  const setClause = updatesFields.map(field => `${field} = ?`).join(', ');
  const values = updatesFields.map(field => {
    if ((field === 'settings' || field === 'access_control' || field === 'tickets_config' || field === 'files_config' || field === 'favorites_config') && updates[field]) {
      // Normalize to object first, then serialize once
      // This prevents double-serialization when frontend sends JSON.stringify'd string
      let obj = updates[field];
      if (typeof obj === 'string') {
        try {
          obj = JSON.parse(obj);
        } catch {
          // Not valid JSON string — wrap as-is
        }
      }
      return JSON.stringify(obj);
    }
    return updates[field];
  });

  await dbRun(
    `UPDATE spaces SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [...values, spaceId]
  );

  return await getSpaceById(spaceId);
}

/**
 * Delete space by ID
 * @param {number} spaceId - Space ID
 * @returns {Promise<void>}
 */
export async function deleteSpace(spaceId) {
  // Verify space exists
  const space = await getSpaceById(spaceId);
  if (!space) {
    throw new Error('Space not found');
  }

  // Delete space (CASCADE will handle projects and dashboards)
  await dbRun('DELETE FROM spaces WHERE id = ?', [spaceId]);
}
