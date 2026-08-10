/**
 * space/access.js — Space access control checks
 *
 * Extracted from SpaceService.js.
 * Handles checkUserSpaceAccess, getUserAccessData, canAccessColumn,
 * canAccessProject, canAccessTable, canAccessSpace, getEffectiveProjectRole,
 * canAccessSystemDataProject, and internal table-based access helpers.
 */

import { dbGet, dbAll, safeJsonParse } from '../../database/connection.js';

/**
 * Check if user has access to a space
 * @param {number} userId - User ID
 * @param {string} userRole - User global role
 * @param {object} space - Space object
 * @param {object} accessControl - Parsed access_control
 * @returns {Promise<boolean>}
 */
export async function checkUserSpaceAccess(userId, userRole, space, accessControl) {
  // 1. Owner always has access
  if (space.owner_id === userId) {
    return true;
  }

  // 2. Admin/owner role can see admin spaces
  if ((userRole === 'admin' || userRole === 'owner') && space.type === 'admin') {
    return true;
  }

  // 3. Check user_access_permissions table for explicit grants (ADR-105: AC2)
  //    This MUST run before the personal-space gate so that users with explicit
  //    grants (e.g. via InvitationService) can access shared personal spaces.
  try {
    const explicitPerm = await dbGet(
      `SELECT access_level FROM user_access_permissions
       WHERE user_id = ? AND space_id = ? AND access_level != 'denied'`,
      [userId, space.id]
    );
    if (explicitPerm) {
      return true;
    }
  } catch {
    // Ignore — fall through to legacy checks
  }

  // 4. Personal spaces - only owner (after explicit grants check)
  if (space.type === 'personal') {
    return false;
  }

  // 5. Open spaces — any authenticated user can view (ADR-105: AC2)
  if (space.visibility === 'open') {
    return true;
  }

  // 4. No access control - only owner
  if (!accessControl) {
    return false;
  }

  // 5. Old format: members array with user_id
  if (accessControl.members && Array.isArray(accessControl.members)) {
    return accessControl.members.some(m => m.user_id === userId);
  }

  // 6. New format: users_table_id with role_mappings (from UserAccessPanel)
  if (accessControl.enabled && accessControl.users_table_id) {
    const result = await checkUserAccessViaTableV2(userId, accessControl);
    return result.allowed;
  }

  // 7. Legacy format: usersTableId with roleMapping
  if (accessControl.enabled && accessControl.usersTableId) {
    const result = await checkUserAccessViaTable(userId, accessControl);
    return result.allowed;
  }

  return false;
}

/**
 * Check user access via linked users table - NEW FORMAT (from UserAccessPanel)
 * Config: { enabled, users_table_id, role_column_id, role_mappings: [{ columnValue, accessLevel }] }
 * @param {number} userId - System user ID
 * @param {object} accessControl - Access control config
 * @returns {Promise<{allowed: boolean, accessLevel: string|null}>}
 */
export async function checkUserAccessViaTableV2(userId, accessControl) {
  const users_table_id = accessControl.users_table_id || accessControl.usersTableId;
  const role_column_id =
    accessControl.role_column_id ||
    accessControl.roleColumnId ||
    accessControl.role_column ||
    accessControl.roleColumn ||
    'role';
  const user_id_column =
    accessControl.user_id_column ||
    accessControl.userIdColumn ||
    'system_user_id';
  const role_mappings = accessControl.role_mappings;

  if (!users_table_id || !role_column_id || !role_mappings) {
    return { allowed: false, accessLevel: null };
  }

  // Get system user email to match
  const systemUser = await dbGet('SELECT id, email FROM users WHERE id = ?', [userId]);
  if (!systemUser) {
    return { allowed: false, accessLevel: null };
  }

  // Get column info to find the system_user_id or email column
  const columns = await dbAll('SELECT id, column_name FROM table_columns WHERE table_id = ?', [users_table_id]);
  const columnIdMap = {};
  for (const col of columns) {
    columnIdMap[col.id] = col.column_name;
    columnIdMap[col.column_name] = col.id;
  }

  const getValue = (dataObj, key) => {
    if (dataObj[key] !== undefined) return dataObj[key];
    const asId = columnIdMap[key];
    if (asId && dataObj[asId] !== undefined) return dataObj[asId];
    const asName = columnIdMap[Number(key)] || columnIdMap[String(key)];
    if (asName && dataObj[asName] !== undefined) return dataObj[asName];
    return undefined;
  };

  // Find user row in the linked table
  const rows = await dbAll(
    'SELECT data FROM table_rows WHERE table_id = ?',
    [users_table_id]
  );

  for (const row of rows) {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

    // Check if this row is for our user by:
    // 1. system_user_id field matching userId
    // 2. email field matching user email
    let isMatch = false;

    // Check system_user_id or configured user_id_column (by id or name)
    const userIdVal = getValue(data, user_id_column) ?? getValue(data, 'system_user_id');
    const userIdBound = userIdVal !== undefined && userIdVal !== null && userIdVal !== '';
    if (userIdBound && String(userIdVal) === String(userId)) {
      isMatch = true;
    }

    // Email fallback only when the row is NOT bound to a specific system_user_id.
    // Otherwise an orphan row (after the original user was deleted) would silently
    // grant access to anyone who later registers with the same email.
    if (!isMatch && !userIdBound) {
      const emailValue = getValue(data, 'email');
      if (emailValue && emailValue.toLowerCase() === systemUser.email.toLowerCase()) {
        isMatch = true;
      }
    }

    if (!isMatch) continue;

    // Check if user is active
    const activeColId = columnIdMap['active'];
    const activeValue = data[activeColId] !== undefined ? data[activeColId] : data.active;
    if (activeValue === false || activeValue === 'false' || activeValue === 0) {
      return { allowed: false, accessLevel: 'denied' };
    }

    // Get user's role from the table using role_column_id
    const userTableRole = getValue(data, role_column_id) ?? getValue(data, 'role');
    if (!userTableRole) {
      continue;
    }

    // Find matching role_mapping
    const mapping = role_mappings.find(m => m.columnValue === userTableRole);

    if (mapping) {
      const accessLevel = mapping.accessLevel;

      // denied = no access
      if (accessLevel === 'denied') {
        return { allowed: false, accessLevel: 'denied' };
      }

      // Any other access level = allowed
      return { allowed: true, accessLevel };
    }

    // User is in the table with a role, but role not in mappings
    // Default to viewer access (they were added to the table = intended to have access)
    return { allowed: true, accessLevel: 'viewer' };
  }

  return { allowed: false, accessLevel: null };
}

/**
 * Check user access via linked users table
 * Role hierarchy: owner > admin > editor > viewer > denied
 * @param {number} userId - System user ID
 * @param {object} accessControl - Access control config
 * @returns {Promise<{allowed: boolean, userData: object|null}>}
 */
async function checkUserAccessViaTable(userId, accessControl) {
  const { usersTableId, userIdColumn, roleColumn, roleMapping } = accessControl;

  if (!usersTableId || !userIdColumn || !roleColumn || !roleMapping) {
    return { allowed: false, userData: null };
  }

  // Find user row in the linked table
  const rows = await dbAll(
    'SELECT data FROM table_rows WHERE table_id = ?',
    [usersTableId]
  );

  for (const row of rows) {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;

    // Check if this row is for our user
    const rowUserId = data[userIdColumn];
    if (rowUserId !== userId && String(rowUserId) !== String(userId)) {
      continue;
    }

    // Check if user is active
    if (data.active === false) {
      return { allowed: false, userData: data };
    }

    // Get user's role from the table
    const userTableRole = data[roleColumn];
    if (!userTableRole) {
      continue;
    }

    // "denied" role always blocks access at space level
    if (userTableRole === 'denied') {
      return { allowed: false, userData: data };
    }

    // Check if this role is in roleMapping.denied (space-level block)
    const deniedRoles = roleMapping.denied || [];
    if (deniedRoles.includes(userTableRole)) {
      return { allowed: false, userData: data };
    }

    // Check if role is in any of the allowed mappings (owner, admin, editor, viewer)
    const allowedRoles = [
      ...(roleMapping.owner || []),
      ...(roleMapping.admin || []),
      ...(roleMapping.editor || []),
      ...(roleMapping.viewer || [])
    ];

    if (allowedRoles.includes(userTableRole)) {
      return { allowed: true, userData: data };
    }
  }

  return { allowed: false, userData: null };
}

/**
 * Get user's granular access data from users table
 * Reads columns by their column IDs from table_columns
 * @param {number} userId - System user ID
 * @param {object} accessControl - Access control config
 * @returns {Promise<object|null>} User data with allowed/denied arrays or null
 */
export async function getUserAccessData(userId, accessControl) {
  if (!accessControl?.enabled) {
    return null;
  }

  const usersTableId =
    accessControl.usersTableId ||
    accessControl.users_table_id ||
    accessControl.users_tableId;
  const userIdColumn =
    accessControl.userIdColumn ||
    accessControl.user_id_column ||
    'system_user_id';

  if (!usersTableId) {
    return null;
  }

  // Get column IDs for granular access columns
  const columns = await dbAll(
    'SELECT id, column_name FROM table_columns WHERE table_id = ?',
    [usersTableId]
  );

  // Map column names to their IDs
  const columnIdMap = {};
  for (const col of columns) {
    columnIdMap[col.column_name] = String(col.id);
  }

  const rows = await dbAll(
    'SELECT data FROM table_rows WHERE table_id = ?',
    [usersTableId]
  );

  for (const row of rows) {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    const rowUserId = data[userIdColumn];

    if (rowUserId === userId || String(rowUserId) === String(userId)) {
      // Helper to get array values from column by name or ID
      const getArrayValue = (colName) => {
        // Try column ID first
        const colId = columnIdMap[colName];
        if (colId && data[colId]) {
          const val = data[colId];
          return Array.isArray(val) ? val : [];
        }
        // Try column name directly
        if (data[colName]) {
          const val = data[colName];
          return Array.isArray(val) ? val : [];
        }
        return [];
      };

      // Get role - try column name 'role' or column ID
      const roleColId = columnIdMap['role'];
      const role = data[roleColId] || data.role || null;

      // Get active status
      const activeColId = columnIdMap['active'];
      const active = data[activeColId] !== undefined ? data[activeColId] : (data.active !== undefined ? data.active : true);

      return {
        role,
        active,
        // Space-level granular access
        allowed_spaces: getArrayValue('allowed_spaces'),
        denied_spaces: getArrayValue('denied_spaces'),
        // Project-level granular access
        allowed_projects: getArrayValue('allowed_projects'),
        denied_projects: getArrayValue('denied_projects'),
        // Table-level granular access
        allowed_tables: getArrayValue('allowed_tables'),
        denied_tables: getArrayValue('denied_tables'),
        // Column-level restrictions
        allowed_columns: getArrayValue('allowed_columns'),
        denied_columns: getArrayValue('denied_columns')
      };
    }
  }

  return null;
}

/**
 * Check if user can see a specific column based on granular access
 * @param {object} userAccessData - User's access data from getUserAccessData
 * @param {number} columnId - Column ID to check
 * @returns {boolean}
 */
export function canAccessColumn(userAccessData, columnId) {
  if (!userAccessData) return false;

  // Denied role blocks all access
  if (userAccessData.role === 'denied') return false;

  // Inactive users have no access
  if (userAccessData.active === false) return false;

  const columnIdStr = String(columnId);
  const { allowed_columns, denied_columns, role } = userAccessData;

  // Owner and Admin roles have full access unless explicitly denied
  if ((role === 'owner' || role === 'admin') &&
      (!denied_columns?.length || !denied_columns.includes(columnIdStr))) {
    return true;
  }

  // Check denied list first (takes priority)
  if (denied_columns?.length && denied_columns.includes(columnIdStr)) {
    return false;
  }

  // If allowed list is empty - allow all (no restrictions)
  if (!allowed_columns?.length) {
    return true;
  }

  // Check allowed list
  return allowed_columns.includes(columnIdStr);
}

/**
 * Check if user can access a specific project based on granular access
 * Role hierarchy: owner > admin > editor > viewer > denied
 * @param {object} userAccessData - User's access data from getUserAccessData
 * @param {number} projectId - Project ID to check
 * @returns {boolean}
 */
export function canAccessProject(userAccessData, projectId) {
  if (!userAccessData) return false;

  // Denied role blocks all access
  if (userAccessData.role === 'denied') return false;

  // Inactive users have no access
  if (userAccessData.active === false) return false;

  const projectIdStr = String(projectId);
  const { allowed_projects, denied_projects, role } = userAccessData;

  // Owner and Admin roles have full access unless explicitly denied
  if ((role === 'owner' || role === 'admin') &&
      (!denied_projects?.length || !denied_projects.includes(projectIdStr))) {
    return true;
  }

  // Check denied list first (takes priority)
  if (denied_projects?.length && denied_projects.includes(projectIdStr)) {
    return false;
  }

  // If allowed list is empty - allow all (no restrictions)
  if (!allowed_projects?.length) {
    return true;
  }

  // Check allowed list
  return allowed_projects.includes(projectIdStr);
}

/**
 * Check if user can access a specific table based on granular access
 * Role hierarchy: owner > admin > editor > viewer > denied
 * @param {object} userAccessData - User's access data from getUserAccessData
 * @param {number} tableId - Table ID to check
 * @returns {boolean}
 */
export function canAccessTable(userAccessData, tableId) {
  if (!userAccessData) return false;

  // Denied role blocks all access
  if (userAccessData.role === 'denied') return false;

  // Inactive users have no access
  if (userAccessData.active === false) return false;

  const tableIdStr = String(tableId);
  const { allowed_tables, denied_tables, role } = userAccessData;

  // Owner and Admin roles have full access unless explicitly denied
  if ((role === 'owner' || role === 'admin') &&
      (!denied_tables?.length || !denied_tables.includes(tableIdStr))) {
    return true;
  }

  // Check denied list first (takes priority)
  if (denied_tables?.length && denied_tables.includes(tableIdStr)) {
    return false;
  }

  // If allowed list is empty - allow all (no restrictions)
  if (!allowed_tables?.length) {
    return true;
  }

  // Check allowed list
  return allowed_tables.includes(tableIdStr);
}

/**
 * Get effective role for a project (with System Data role downgrade)
 * System Data projects have stricter access:
 * - admin -> editor
 * - editor -> viewer
 * - viewer -> denied
 * @param {object} userAccessData - User's access data
 * @param {object} project - Project object (needs type field)
 * @returns {string|null} Effective role for this project
 */
export function getEffectiveProjectRole(userAccessData, project) {
  if (!userAccessData || !userAccessData.role) return null;

  const baseRole = userAccessData.role;

  // If not System Data project, return base role
  if (project?.type !== 'system_data') {
    return baseRole;
  }

  // System Data: downgrade roles
  // owner stays owner (can manage system data)
  // admin -> editor (can edit but not admin functions)
  // editor -> viewer (can view only)
  // viewer -> denied (no access to system data)
  const roleDowngrade = {
    'owner': 'owner',
    'admin': 'editor',
    'editor': 'viewer',
    'viewer': 'denied',
    'denied': 'denied'
  };

  return roleDowngrade[baseRole] || baseRole;
}

/**
 * Check if user can access a System Data project
 * Applies role downgrade: admin->editor, editor->viewer, viewer->denied
 * @param {object} userAccessData - User's access data
 * @param {number} projectId - Project ID
 * @returns {Promise<{allowed: boolean, effectiveRole: string|null}>}
 */
export async function canAccessSystemDataProject(userAccessData, projectId) {
  if (!userAccessData) {
    return { allowed: false, effectiveRole: null };
  }

  // Get project info
  const project = await dbGet('SELECT id, type FROM projects WHERE id = ?', [projectId]);

  if (!project) {
    return { allowed: false, effectiveRole: null };
  }

  // Get effective role (with downgrade for System Data)
  const effectiveRole = getEffectiveProjectRole(userAccessData, project);

  // Check if denied
  if (effectiveRole === 'denied') {
    return { allowed: false, effectiveRole };
  }

  // Check normal project access with effective role
  const canAccess = canAccessProject({ ...userAccessData, role: effectiveRole }, projectId);

  return { allowed: canAccess, effectiveRole };
}

/**
 * Check if user can access a space based on granular settings
 * @param {object} userAccessData - User's access data from getUserAccessData
 * @param {number} spaceId - Space ID to check
 * @returns {boolean}
 */
export function canAccessSpace(userAccessData, spaceId) {
  if (!userAccessData) return false;

  // Denied role blocks all access
  if (userAccessData.role === 'denied') return false;

  // Inactive users have no access
  if (userAccessData.active === false) return false;

  const spaceIdStr = String(spaceId);
  const { allowed_spaces, denied_spaces, role } = userAccessData;

  // Owner role has full access unless explicitly denied
  if (role === 'owner' &&
      (!denied_spaces?.length || !denied_spaces.includes(spaceIdStr))) {
    return true;
  }

  // Check denied list first (takes priority)
  if (denied_spaces?.length && denied_spaces.includes(spaceIdStr)) {
    return false;
  }

  // If allowed list is empty - allow all (no restrictions)
  if (!allowed_spaces?.length) {
    return true;
  }

  // Check allowed list
  return allowed_spaces.includes(spaceIdStr);
}
