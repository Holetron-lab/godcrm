/**
 * Shared helper functions for tables routes
 */
import { dbGet } from '../../../database/connection.js';
import { getUserAccessData } from '../../../services/SpaceService.js';

// Helper function to map SQLite types to internal types
export function mapSqliteTypeToInternal(sqliteType) {
  if (!sqliteType) return 'text';
  const type = sqliteType.toUpperCase();
  if (type.includes('INT')) return 'number';
  if (type.includes('REAL') || type.includes('FLOAT') || type.includes('DOUBLE')) return 'number';
  if (type.includes('DATE') || type.includes('TIME')) return 'datetime';
  if (type.includes('BOOL')) return 'checkbox';
  if (type.includes('BLOB')) return 'text';
  return 'text';
}

// Helper function to map PostgreSQL types to internal types
export function mapPostgresTypeToInternal(pgType) {
  if (!pgType) return 'text';
  const type = pgType.toLowerCase();
  if (type.includes('int') || type === 'serial' || type === 'bigserial') return 'number';
  if (type.includes('numeric') || type.includes('decimal') || type.includes('real') || type.includes('double')) return 'number';
  if (type.includes('timestamp') || type.includes('date') || type.includes('time')) return 'datetime';
  if (type === 'boolean') return 'checkbox';
  if (type === 'json' || type === 'jsonb') return 'text';
  if (type === 'uuid') return 'text';
  if (type.includes('text') || type.includes('char') || type.includes('varchar')) return 'text';
  return 'text';
}

/**
 * Filter columns based on user's role, column access_control, and granular access
 * Column config can have: { access_control: { denied: ["viewer"], readonly: ["editor"] } }
 * Granular access uses allowed_columns/denied_columns from user's access data
 * @param {Array} columns - Array of columns
 * @param {string|null} userRole - User's role in the space (owner/admin/editor/viewer/denied) or null for full access
 * @param {object|null} userAccessData - User's granular access data (optional)
 * @returns {Array} Filtered columns with readonly flag
 */
export function filterColumnsByRole(columns, userRole, userAccessData = null) {
  // If role is denied, show nothing
  if (userRole === 'denied') return [];

  // If no role (null/undefined) or owner - show everything without restrictions
  if (!userRole || userRole === 'owner') {
    return columns.map(col => ({ ...col, _readonly: false }));
  }

  return columns.filter(col => {
    const config = typeof col.config === 'string' ? JSON.parse(col.config || '{}') : (col.config || {});
    const accessControl = config.access_control;

    // Check granular access first (allowed_columns/denied_columns)
    if (userAccessData) {
      const columnIdStr = String(col.id);

      // Check denied_columns list (takes priority)
      if (userAccessData.denied_columns?.length && userAccessData.denied_columns.includes(columnIdStr)) {
        return false;
      }

      // Check allowed_columns list (if not empty, only allow specified columns)
      if (userAccessData.allowed_columns?.length && !userAccessData.allowed_columns.includes(columnIdStr)) {
        // Admin can still access even if not in allowed list (unless explicitly denied)
        if (userRole !== 'admin') {
          return false;
        }
      }
    }

    // Column-level access_control config (role-based)
    if (accessControl) {
      // Check if role is denied for this specific column
      const deniedRoles = accessControl.denied || [];
      if (deniedRoles.includes(userRole)) return false;
    }

    return true;
  }).map(col => {
    const config = typeof col.config === 'string' ? JSON.parse(col.config || '{}') : (col.config || {});
    const accessControl = config.access_control;

    // Check if readonly for this role
    const readonlyRoles = accessControl?.readonly || [];
    const isReadonly = readonlyRoles.includes(userRole);

    return { ...col, _readonly: isReadonly };
  });
}

/**
 * Check if user has access to a table based on API key project restriction
 * @returns {Promise<{allowed: boolean, table?: object, error?: string}>}
 */
export async function checkTableAccess(tableId, user) {
  const table = await dbGet(`SELECT id, project_id, name FROM universal_tables WHERE id = ?`, [tableId]);

  if (!table) {
    return { allowed: false, error: 'Table not found' };
  }

  // If API key has project restriction, check it
  if (user?.projectId && table.project_id !== user.projectId) {
    return { allowed: false, error: 'Your API key does not have access to this table', table };
  }

  return { allowed: true, table };
}

/**
 * Resolve user role and access data for a table
 * @returns {Promise<{userRole: string|null, userAccessData: object|null}>}
 */
export async function resolveUserRoleForTable(userId, table) {
  let userRole = null;
  let userAccessData = null;

  if (userId && table?.project_id) {
    const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [table.project_id]);
    if (project?.space_id) {
      const space = await dbGet('SELECT id, owner_id, access_control FROM spaces WHERE id = ?', [project.space_id]);
      if (space) {
        // Owner always has full access
        if (space.owner_id === userId) {
          userRole = 'owner';
        } else {
          let accessControl = space.access_control;
          if (typeof accessControl === 'string') {
            try { accessControl = JSON.parse(accessControl); } catch (e) { accessControl = {}; }
          }
          userAccessData = await getUserAccessData(userId, accessControl);
          userRole = userAccessData?.role || null;
        }
      }
    }
  }

  return { userRole, userAccessData };
}
