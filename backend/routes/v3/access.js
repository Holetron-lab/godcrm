import { logger, apiLogger } from '../../utils/logger.js';
/**
 * Access Control API Routes
 * Manage user permissions for spaces, projects, tables, columns
 */

import express from 'express';
import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import { authenticate } from '../../middleware/auth.js';

const router = express.Router();

/**
 * Sync user to space's CRM users table (table 1782 etc.)
 * When a permission is set for a space, also upsert a row in the space's users_table
 */
async function syncUserToSpaceTable(spaceId, userId, accessLevel) {
  try {
    // Get space access_control config
    const space = await dbGet('SELECT access_control FROM spaces WHERE id = ?', [spaceId]);
    if (!space || !space.access_control) return;

    let accessControl;
    try {
      accessControl = typeof space.access_control === 'string'
        ? JSON.parse(space.access_control)
        : space.access_control;
    } catch (e) {
      return;
    }

    const usersTableId = accessControl?.users_table_id;
    if (!usersTableId) return;

    // Get user info
    const user = await dbGet('SELECT id, name, email FROM users WHERE id = ?', [userId]);
    if (!user) return;

    // Check if user already exists in the table (by system_user_id)
    const existingRows = await dbAll(
      `SELECT id, data FROM table_rows WHERE table_id = ?`,
      [usersTableId]
    );

    let existingRowId = null;
    let existingRowData = null;
    if (existingRows) {
      for (const row of existingRows) {
        try {
          const rowData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
          if (String(rowData.system_user_id) === String(userId)) {
            existingRowId = row.id;
            existingRowData = rowData;
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    // Build row data using column names (CRM stores data by column name)
    const rowData = {
      system_user_id: userId,
      email: user.email,
      name: user.name,
      role: accessLevel,
      active: accessLevel !== 'denied'
    };

    if (existingRowId) {
      // Merge with existing data to preserve other fields
      const merged = { ...existingRowData, ...rowData };
      await dbRun(
        `UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [JSON.stringify(merged), existingRowId]
      );
      logger.info(`[Access] Synced user ${userId} to space ${spaceId} users table (updated row ${existingRowId})`);
    } else {
      // Insert new row
      const baseId = Math.random().toString(36).substring(2, 10).toUpperCase();
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [usersTableId, baseId, JSON.stringify(rowData)]
      );
      logger.info(`[Access] Synced user ${userId} to space ${spaceId} users table (new row)`);
    }
  } catch (error) {
    // Non-critical - log but don't fail the main operation
    logger.error('[Access] Failed to sync user to space table:', error);
  }
}

/**
 * Remove user from space's CRM users table
 */
async function removeUserFromSpaceTable(spaceId, userId) {
  try {
    const space = await dbGet('SELECT access_control FROM spaces WHERE id = ?', [spaceId]);
    if (!space || !space.access_control) return;

    let accessControl;
    try {
      accessControl = typeof space.access_control === 'string'
        ? JSON.parse(space.access_control)
        : space.access_control;
    } catch (e) {
      return;
    }

    const usersTableId = accessControl?.users_table_id;
    if (!usersTableId) return;

    // Find and delete the row
    const rows = await dbAll('SELECT id, data FROM table_rows WHERE table_id = ?', [usersTableId]);
    if (rows) {
      for (const row of rows) {
        try {
          const rowData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
          if (String(rowData.system_user_id) === String(userId)) {
            await dbRun('DELETE FROM table_rows WHERE id = ?', [row.id]);
            logger.info(`[Access] Removed user ${userId} from space ${spaceId} users table (row ${row.id})`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }
  } catch (error) {
    logger.error('[Access] Failed to remove user from space table:', error);
  }
}

// Access level hierarchy (higher = more privileges)
const ACCESS_LEVEL_VALUES = {
  owner_owner: 100,
  owner: 80,
  admin: 60,
  editor: 40,
  viewer: 20,
  denied: 0
};

// Valid access levels
const VALID_ACCESS_LEVELS = ['owner_owner', 'owner', 'admin', 'editor', 'viewer', 'denied'];

// Entity type to column mapping
const ENTITY_TYPE_COLUMNS = {
  space: 'space_id',
  project: 'project_id',
  table: 'table_id',
  column: 'column_id'
};

/**
 * Get permissions for an entity
 * GET /api/v2/access/:entityType/:entityId/permissions
 */
router.get('/:entityType/:entityId/permissions', authenticate, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    
    if (!ENTITY_TYPE_COLUMNS[entityType]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity type. Must be: space, project, table, or column'
      });
    }
    
    const column = ENTITY_TYPE_COLUMNS[entityType];
    
    const permissions = await dbAll(`
      SELECT 
        uap.*,
        u.name as user_name,
        u.email as user_email,
        u.avatar as user_avatar,
        g.name as granted_by_name
      FROM user_access_permissions uap
      JOIN users u ON uap.user_id = u.id
      LEFT JOIN users g ON uap.granted_by = g.id
      WHERE uap.${column} = ?
      ORDER BY 
        CASE uap.access_level 
          WHEN 'owner_owner' THEN 1 
          WHEN 'owner' THEN 2 
          WHEN 'admin' THEN 3 
          WHEN 'editor' THEN 4 
          WHEN 'viewer' THEN 5 
          WHEN 'denied' THEN 6 
        END,
        u.name
    `, [entityId]);
    
    return res.json({
      success: true,
      data: permissions
    });
  } catch (error) {
    logger.error('[Access] Get permissions error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get permissions'
    });
  }
});

/**
 * Set permission for a user on an entity
 * POST /api/v2/access/:entityType/:entityId/permissions
 * Body: { user_id: number, access_level: string }
 */
router.post('/:entityType/:entityId/permissions', authenticate, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { user_id, access_level } = req.body;
    const currentUserId = req.user.id;
    
    // Validate entity type
    if (!ENTITY_TYPE_COLUMNS[entityType]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity type'
      });
    }
    
    // Validate access level
    if (!VALID_ACCESS_LEVELS.includes(access_level)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid access level'
      });
    }
    
    // Cannot set owner_owner - it's automatic for creator
    if (access_level === 'owner_owner') {
      return res.status(400).json({
        success: false,
        error: 'Cannot manually set owner_owner level'
      });
    }
    
    // Check if target user exists
    const targetUser = await dbGet('SELECT id FROM users WHERE id = ?', [user_id]);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Get current user's access level for this entity
    const column = ENTITY_TYPE_COLUMNS[entityType];
    
    // Check if current user is owner_owner of the entity
    let isOwnerOwner = false;
    if (entityType === 'space') {
      const entity = await dbGet(`SELECT owner_id FROM spaces WHERE id = ?`, [entityId]);
      if (entity && entity.owner_id === currentUserId) {
        isOwnerOwner = true;
      }
    } else if (entityType === 'project') {
      const entity = await dbGet(`SELECT owner_id, owner_owner_id FROM projects WHERE id = ?`, [entityId]);
      if (entity && (entity.owner_id === currentUserId || entity.owner_owner_id === currentUserId)) {
        isOwnerOwner = true;
      }
    }
    
    // Get current user's permission level
    const currentUserPermission = await dbGet(`
      SELECT access_level FROM user_access_permissions 
      WHERE user_id = ? AND ${column} = ?
    `, [currentUserId, entityId]);
    
    const currentUserLevel = isOwnerOwner ? 'owner_owner' : (currentUserPermission?.access_level || 'viewer');
    const currentUserValue = ACCESS_LEVEL_VALUES[currentUserLevel];
    
    // Check if current user can set this access level
    const targetLevelValue = ACCESS_LEVEL_VALUES[access_level];
    if (currentUserValue <= targetLevelValue && !isOwnerOwner) {
      return res.status(403).json({
        success: false,
        error: 'You cannot grant access level equal or higher than your own'
      });
    }
    
    // Check if target user already has a higher permission (cannot demote if not owner)
    const existingPermission = await dbGet(`
      SELECT access_level FROM user_access_permissions 
      WHERE user_id = ? AND ${column} = ?
    `, [user_id, entityId]);
    
    if (existingPermission) {
      const existingValue = ACCESS_LEVEL_VALUES[existingPermission.access_level];
      if (existingValue >= currentUserValue && !isOwnerOwner) {
        return res.status(403).json({
          success: false,
          error: 'Cannot modify permissions of user with equal or higher access level'
        });
      }
      
      // Update existing permission
      await dbRun(`
        UPDATE user_access_permissions
        SET access_level = ?, granted_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND ${column} = ?
      `, [access_level, currentUserId, user_id, entityId]);
    } else {
      // Insert new permission
      const columns = ['user_id', column, 'access_level', 'granted_by'];
      const values = [user_id, entityId, access_level, currentUserId];

      await dbRun(`
        INSERT INTO user_access_permissions (${columns.join(', ')})
        VALUES (${columns.map(() => '?').join(', ')})
      `, values);
    }

    // Sync to space's CRM users table (if this is a space permission)
    if (entityType === 'space') {
      await syncUserToSpaceTable(entityId, user_id, access_level);
    }
    
    // Fetch the updated permission
    const updatedPermission = await dbGet(`
      SELECT 
        uap.*,
        u.name as user_name,
        u.email as user_email,
        u.avatar as user_avatar
      FROM user_access_permissions uap
      JOIN users u ON uap.user_id = u.id
      WHERE uap.user_id = ? AND uap.${column} = ?
    `, [user_id, entityId]);
    
    return res.json({
      success: true,
      data: updatedPermission,
      message: 'Permission updated successfully'
    });
  } catch (error) {
    logger.error('[Access] Set permission error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to set permission'
    });
  }
});

/**
 * Remove permission for a user on an entity
 * DELETE /api/v2/access/:entityType/:entityId/permissions/:userId
 */
router.delete('/:entityType/:entityId/permissions/:userId', authenticate, async (req, res) => {
  try {
    const { entityType, entityId, userId } = req.params;
    const currentUserId = req.user.id;
    
    if (!ENTITY_TYPE_COLUMNS[entityType]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity type'
      });
    }
    
    const column = ENTITY_TYPE_COLUMNS[entityType];
    
    // Check if target user's permission exists
    const existingPermission = await dbGet(`
      SELECT access_level FROM user_access_permissions 
      WHERE user_id = ? AND ${column} = ?
    `, [userId, entityId]);
    
    if (!existingPermission) {
      return res.status(404).json({
        success: false,
        error: 'Permission not found'
      });
    }
    
    // Cannot remove owner_owner
    if (existingPermission.access_level === 'owner_owner') {
      return res.status(403).json({
        success: false,
        error: 'Cannot remove owner_owner permission'
      });
    }
    
    // Check if current user has sufficient permissions
    let isOwnerOwner = false;
    if (entityType === 'space') {
      const entity = await dbGet(`SELECT owner_id FROM spaces WHERE id = ?`, [entityId]);
      if (entity && entity.owner_id === currentUserId) {
        isOwnerOwner = true;
      }
    } else if (entityType === 'project') {
      const entity = await dbGet(`SELECT owner_id, owner_owner_id FROM projects WHERE id = ?`, [entityId]);
      if (entity && (entity.owner_id === currentUserId || entity.owner_owner_id === currentUserId)) {
        isOwnerOwner = true;
      }
    }
    
    const currentUserPermission = await dbGet(`
      SELECT access_level FROM user_access_permissions 
      WHERE user_id = ? AND ${column} = ?
    `, [currentUserId, entityId]);
    
    const currentUserLevel = isOwnerOwner ? 'owner_owner' : (currentUserPermission?.access_level || 'viewer');
    const currentUserValue = ACCESS_LEVEL_VALUES[currentUserLevel];
    const targetUserValue = ACCESS_LEVEL_VALUES[existingPermission.access_level];
    
    if (targetUserValue >= currentUserValue && !isOwnerOwner) {
      return res.status(403).json({
        success: false,
        error: 'Cannot remove permissions of user with equal or higher access level'
      });
    }
    
    // Delete the permission
    await dbRun(`
      DELETE FROM user_access_permissions
      WHERE user_id = ? AND ${column} = ?
    `, [userId, entityId]);

    // Remove from space's CRM users table (if space permission)
    if (entityType === 'space') {
      await removeUserFromSpaceTable(entityId, userId);
    }

    return res.json({
      success: true,
      message: 'Permission removed successfully'
    });
  } catch (error) {
    logger.error('[Access] Remove permission error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to remove permission'
    });
  }
});

/**
 * Bulk update permissions for an entity
 * PUT /api/v2/access/:entityType/:entityId/permissions
 * Body: { permissions: [{ user_id: number, access_level: string }] }
 */
router.put('/:entityType/:entityId/permissions', authenticate, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { permissions } = req.body;
    const currentUserId = req.user.id;
    
    if (!ENTITY_TYPE_COLUMNS[entityType]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity type'
      });
    }
    
    if (!Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        error: 'permissions must be an array'
      });
    }
    
    const column = ENTITY_TYPE_COLUMNS[entityType];
    const results = [];
    const errors = [];
    
    for (const perm of permissions) {
      if (!perm.user_id || !perm.access_level) {
        errors.push({ user_id: perm.user_id, error: 'Missing user_id or access_level' });
        continue;
      }
      
      if (!VALID_ACCESS_LEVELS.includes(perm.access_level) || perm.access_level === 'owner_owner') {
        errors.push({ user_id: perm.user_id, error: 'Invalid access level' });
        continue;
      }
      
      try {
        // Check existing permission
        const existing = await dbGet(`
          SELECT id FROM user_access_permissions 
          WHERE user_id = ? AND ${column} = ?
        `, [perm.user_id, entityId]);
        
        if (existing) {
          dbRun(`
            UPDATE user_access_permissions 
            SET access_level = ?, granted_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `, [perm.access_level, currentUserId, existing.id]);
        } else {
          dbRun(`
            INSERT INTO user_access_permissions (user_id, ${column}, access_level, granted_by)
            VALUES (?, ?, ?, ?)
          `, [perm.user_id, entityId, perm.access_level, currentUserId]);
        }
        
        results.push({ user_id: perm.user_id, access_level: perm.access_level, success: true });
      } catch (err) {
        errors.push({ user_id: perm.user_id, error: err.message });
      }
    }
    
    return res.json({
      success: true,
      data: {
        updated: results,
        errors: errors.length > 0 ? errors : undefined
      },
      message: `Updated ${results.length} permissions${errors.length > 0 ? `, ${errors.length} errors` : ''}`
    });
  } catch (error) {
    logger.error('[Access] Bulk update error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to bulk update permissions'
    });
  }
});

/**
 * Get all tables in a space (for user source selection)
 * GET /api/v2/access/space/:spaceId/tables
 */
router.get('/space/:spaceId/tables', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    // Get all projects in space
    const projects = await dbAll(`
      SELECT id, name, type FROM projects WHERE space_id = ? ORDER BY type, name
    `, [spaceId]);
    
    if (!projects || projects.length === 0) {
      return res.json({
        success: true,
        data: {
          tables: [],
          default_table_id: null
        }
      });
    }
    
    const projectIds = projects.map(p => p.id);
    
    // Get all tables from these projects
    const tables = await dbAll(`
      SELECT 
        ut.id,
        ut.name as key,
        ut.name as display_name,
        ut.project_id,
        p.name as project_name,
        p.type as project_type
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE ut.project_id IN (${projectIds.map(() => '?').join(',')})
      ORDER BY p.type = 'system_data' DESC, p.name, ut.name
    `, projectIds);
    
    // Find default users table in System Data
    const systemDataProject = projects.find(p => p.type === 'system_data');
    let defaultTableId = null;
    
    if (systemDataProject) {
      const usersTable = tables.find(t => 
        t.project_id === systemDataProject.id && t.key.toLowerCase() === 'users'
      );
      if (usersTable) {
        defaultTableId = usersTable.id;
      }
    }
    
    return res.json({
      success: true,
      data: {
        tables: tables.map(t => ({
          id: t.id,
          key: t.key,
          display_name: t.display_name || t.key,
          project_id: t.project_id,
          project_name: t.project_name,
          project_type: t.project_type,
          label: `${t.display_name || t.key} (ID: ${t.id}, key: ${t.key})`
        })),
        default_table_id: defaultTableId
      }
    });
  } catch (error) {
    logger.error('[Access] Get space tables error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get space tables'
    });
  }
});

/**
 * Get available users for a space (from any table or default users table)
 * GET /api/v2/access/space/:spaceId/available-users?tableId=123
 */
router.get('/space/:spaceId/available-users', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { tableId } = req.query;
    
    let targetTableId = tableId ? parseInt(tableId) : null;
    
    // If no tableId specified, find default users table in System Data
    if (!targetTableId) {
      const systemDataProject = await dbGet(`
        SELECT id FROM projects WHERE space_id = ? AND type = 'system_data'
      `, [spaceId]);
      
      if (systemDataProject) {
        const usersTable = await dbGet(`
          SELECT id FROM universal_tables 
          WHERE project_id = ? AND LOWER(name) = 'users'
        `, [systemDataProject.id]);
        
        if (usersTable) {
          targetTableId = usersTable.id;
        }
      }
    }
    
    // If no system_data Users table, try access_control.usersTableId from space config
    if (!targetTableId) {
      const space = await dbGet('SELECT access_control, owner_id FROM spaces WHERE id = ?', [spaceId]);
      const ac = space?.access_control
        ? (typeof space.access_control === 'string' ? JSON.parse(space.access_control) : space.access_control)
        : null;
      const acUsersTableId = ac?.usersTableId || ac?.users_table_id;
      if (acUsersTableId) {
        targetTableId = acUsersTableId;
      }
    }

    // If still no table, filter system users by space membership
    if (!targetTableId) {
      const space = await dbGet('SELECT owner_id FROM spaces WHERE id = ?', [spaceId]);
      const ownerId = space?.owner_id;

      // Get users who have explicit permissions for this space + the owner
      const systemUsers = await dbAll(`
        SELECT DISTINCT u.id, u.name, u.email, u.avatar, u.avatar as avatar_url, u.user_type,
               u.managed_by_agent_table_id, u.managed_by_agent_row_id,
               (SELECT r.data->>'icon'  FROM table_rows r
                  WHERE r.id = u.managed_by_agent_row_id
                    AND r.table_id = u.managed_by_agent_table_id) as agent_icon,
               (SELECT r.data->>'color' FROM table_rows r
                  WHERE r.id = u.managed_by_agent_row_id
                    AND r.table_id = u.managed_by_agent_table_id) as agent_color
        FROM users u
        WHERE u.status != 'deleted'
          AND (
            u.id = ?
            OR u.id IN (SELECT uap.user_id FROM user_access_permissions uap WHERE uap.space_id = ? AND uap.access_level != 'denied')
          )
        ORDER BY u.name
      `, [ownerId, spaceId]);

      return res.json({
        success: true,
        data: {
          users: systemUsers,
          source: 'space_members',
          table_id: null
        }
      });
    }
    
    // Get table columns to understand data structure
    const tableColumns = await dbAll(`
      SELECT id, column_name, display_name, type 
      FROM table_columns 
      WHERE table_id = ? 
      ORDER BY order_index
    `, [targetTableId]);
    
    // Find columns that might be user-related
    const columnMap = {};
    for (const col of tableColumns) {
      const name = col.column_name.toLowerCase();
      if (name.includes('system_user') || name === 'user_id') {
        columnMap.system_user_id = col.id;
      } else if (name.includes('email')) {
        columnMap.email = col.id;
      } else if (name === 'name' || name.includes('имя')) {
        columnMap.name = col.id;
      } else if (name.includes('role') || name.includes('роль')) {
        columnMap.role = col.id;
      } else if (name.includes('active') || name.includes('актив')) {
        columnMap.active = col.id;
      }
    }
    
    // Get rows from the table
    const tableRows = await dbAll(`
      SELECT tr.id as row_id, tr.data 
      FROM table_rows tr
      WHERE tr.table_id = ?
    `, [targetTableId]);
    
    // Parse and transform users
    const users = [];
    for (const row of tableRows) {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      
      // Try to extract user data using column map or named keys
      const systemUserId = parseInt(data[columnMap.system_user_id]) || data.system_user_id || null;
      const email = data[columnMap.email] || data.email || null;
      const name = data[columnMap.name] || data.name || 'Unknown';
      const role = data[columnMap.role] || data.role || null;
      const active = data[columnMap.active] === true || 
                     data[columnMap.active] === 'true' || 
                     data.active === true ||
                     (columnMap.active === undefined); // If no active column, assume active
      
      // Get system user info if linked
      let systemUser = null;
      if (systemUserId) {
        systemUser = await dbGet(`
          SELECT u.id, u.name, u.email, u.avatar, u.user_type,
                 u.managed_by_agent_table_id, u.managed_by_agent_row_id,
                 (SELECT r.data->>'icon'  FROM table_rows r
                    WHERE r.id = u.managed_by_agent_row_id
                      AND r.table_id = u.managed_by_agent_table_id) as agent_icon,
                 (SELECT r.data->>'color' FROM table_rows r
                    WHERE r.id = u.managed_by_agent_row_id
                      AND r.table_id = u.managed_by_agent_table_id) as agent_color
          FROM users u WHERE u.id = ?`, [systemUserId]);
      }

      const user = {
        row_id: row.row_id,
        system_user_id: systemUserId,
        email: email || systemUser?.email || null,
        name: name || systemUser?.name || 'Unknown',
        role: role,
        active: active,
        avatar: systemUser?.avatar || null,
        avatar_url: systemUser?.avatar || null,
        user_type: systemUser?.user_type || 'human',
        managed_by_agent_table_id: systemUser?.managed_by_agent_table_id || null,
        managed_by_agent_row_id: systemUser?.managed_by_agent_row_id || null,
        agent_icon: systemUser?.agent_icon || null,
        agent_color: systemUser?.agent_color || null,
        id: systemUserId
      };
      
      if (user.active && user.id) {
        users.push(user);
      }
    }
    
    return res.json({
      success: true,
      data: {
        users,
        source: 'table',
        table_id: targetTableId,
        columns: tableColumns.map(c => ({
          id: c.id,
          name: c.column_name,
          display_name: c.display_name
        }))
      }
    });
  } catch (error) {
    logger.error('[Access] Get available users error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get available users'
    });
  }
});

/**
 * Get current user's access level for a widget (inherits from linked table)
 * GET /api/v2/access/widget/:widgetId/my-level
 */
router.get('/widget/:widgetId/my-level', authenticate, async (req, res) => {
  try {
    const { widgetId } = req.params;
    const currentUserId = req.user.id;
    
    // Get widget and its linked table
    const widget = await dbGet(`
      SELECT w.id, w.config, w.project_id, p.space_id
      FROM widgets w
      LEFT JOIN projects p ON w.project_id = p.id
      WHERE w.id = ?
    `, [widgetId]);
    
    if (!widget) {
      return res.status(404).json({
        success: false,
        error: 'Widget not found'
      });
    }
    
    // Parse config to get table_id
    let tableId = null;
    if (widget.config) {
      const config = typeof widget.config === 'string' ? JSON.parse(widget.config) : widget.config;
      tableId = config.table_id || config.tableId || null;
    }
    
    // If no table linked, check project access
    if (!tableId) {
      // Check if user has project access
      const projectPermission = await dbGet(`
        SELECT access_level FROM user_access_permissions 
        WHERE user_id = ? AND project_id = ?
      `, [currentUserId, widget.project_id]);
      
      return res.json({
        success: true,
        data: {
          access_level: projectPermission?.access_level || 'editor',
          inherited: true,
          inherited_from: 'project'
        }
      });
    }

    // Check table access
    const tablePermission = await dbGet(`
      SELECT access_level FROM user_access_permissions 
      WHERE user_id = ? AND table_id = ?
    `, [currentUserId, tableId]);
    
    if (tablePermission) {
      return res.json({
        success: true,
        data: {
          access_level: tablePermission.access_level,
          inherited: true,
          inherited_from: 'table',
          table_id: tableId
        }
      });
    }
    
    // Check project access as fallback
    const projectPermission = await dbGet(`
      SELECT access_level FROM user_access_permissions 
      WHERE user_id = ? AND project_id = ?
    `, [currentUserId, widget.project_id]);
    
    if (projectPermission) {
      return res.json({
        success: true,
        data: {
          access_level: projectPermission.access_level,
          inherited: true,
          inherited_from: 'project'
        }
      });
    }
    
    // Default to editor for authenticated users
    return res.json({
      success: true,
      data: {
        access_level: 'editor',
        inherited: true,
        inherited_from: 'space'
      }
    });
  } catch (error) {
    logger.error('[Access] Get widget access level error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get widget access level'
    });
  }
});

/**
 * Get current user's access level for an entity
 * GET /api/v2/access/:entityType/:entityId/my-level
 */
router.get('/:entityType/:entityId/my-level', authenticate, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const currentUserId = req.user.id;
    
    if (!ENTITY_TYPE_COLUMNS[entityType]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid entity type'
      });
    }
    
    const column = ENTITY_TYPE_COLUMNS[entityType];
    
    // Check if user is owner_owner
    if (entityType === 'space') {
      const entity = await dbGet(`SELECT owner_id FROM spaces WHERE id = ?`, [entityId]);
      if (entity && entity.owner_id === currentUserId) {
        return res.json({
          success: true,
          data: {
            access_level: 'owner_owner',
            is_owner: true,
            inherited: false
          }
        });
      }
    } else if (entityType === 'project') {
      const entity = await dbGet(`SELECT owner_id, owner_owner_id FROM projects WHERE id = ?`, [entityId]);
      if (entity && (entity.owner_id === currentUserId || entity.owner_owner_id === currentUserId)) {
        return res.json({
          success: true,
          data: {
            access_level: 'owner_owner',
            is_owner: true,
            inherited: false
          }
        });
      }
    }
    
    // Check direct permission
    const directPermission = await dbGet(`
      SELECT access_level FROM user_access_permissions 
      WHERE user_id = ? AND ${column} = ?
    `, [currentUserId, entityId]);
    
    if (directPermission) {
      return res.json({
        success: true,
        data: {
          access_level: directPermission.access_level,
          inherited: false
        }
      });
    }
    
    // Check inherited permissions (going up the hierarchy)
    let inheritedLevel = 'denied';
    let inheritedFrom = null;

    // For table, check project
    if (entityType === 'table') {
      // Would need to look up the table's project_id, then check project permission
      // Default to editor for authenticated users (they should be able to edit)
      inheritedLevel = 'editor';
      inheritedFrom = 'project';
    }

    // For project, check space
    // Default to editor for authenticated users — they should have edit access
    // unless explicitly restricted via user_access_permissions
    if (entityType === 'project') {
      inheritedLevel = 'editor';
      inheritedFrom = 'space';
    }

    // For column, check table
    if (entityType === 'column') {
      inheritedLevel = 'editor';
      inheritedFrom = 'table';
    }
    
    return res.json({
      success: true,
      data: {
        access_level: inheritedLevel,
        inherited: true,
        inherited_from: inheritedFrom
      }
    });
  } catch (error) {
    logger.error('[Access] Get my level error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get access level'
    });
  }
});

/**
 * Enable access control for a space
 * Creates users table if not exists and returns access_control config
 * POST /api/v2/access/space/:spaceId/enable
 */
router.post('/space/:spaceId/enable', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    const userId = req.user.id;
    
    // Import the function
    const { getOrCreateUsersTable } = await import('../../services/BusinessPackService.js');
    
    // Create users table if not exists
    const result = await getOrCreateUsersTable(parseInt(spaceId), userId);
    
    // Build access_control config
    const accessControl = {
      enabled: true,
      users_table_id: result.table_id,
      role_column_id: null, // Will be set by frontend when user selects column
      role_mappings: [
        { columnValue: 'owner', accessLevel: 'owner' },
        { columnValue: 'admin', accessLevel: 'admin' },
        { columnValue: 'editor', accessLevel: 'editor' },
        { columnValue: 'writer', accessLevel: 'editor' },
        { columnValue: 'viewer', accessLevel: 'viewer' },
        { columnValue: 'reader', accessLevel: 'viewer' },
        { columnValue: 'denied', accessLevel: 'denied' },
        { columnValue: 'blocked', accessLevel: 'denied' }
      ]
    };
    
    // Find role column in users table
    const roleColumn = await dbGet(`
      SELECT id FROM table_columns 
      WHERE table_id = ? AND column_name = 'role'
    `, [result.table_id]);
    
    if (roleColumn) {
      accessControl.role_column_id = roleColumn.id;
    }
    
    // Update space with access_control
    await dbRun(`
      UPDATE spaces SET access_control = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [JSON.stringify(accessControl), spaceId]);
    
    return res.json({
      success: true,
      data: {
        access_control: accessControl,
        users_table: result,
        message: result.status === 'created' ? 'Users table created' : 'Using existing users table'
      }
    });
  } catch (error) {
    logger.error('[Access] Enable access control error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to enable access control: ' + error.message
    });
  }
});

/**
 * Disable access control for a space
 * POST /api/v2/access/space/:spaceId/disable
 */
router.post('/space/:spaceId/disable', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    // Get current access_control
    const space = await dbGet('SELECT access_control FROM spaces WHERE id = ?', [spaceId]);
    let accessControl = {};
    
    if (space?.access_control) {
      try {
        accessControl = typeof space.access_control === 'string' 
          ? JSON.parse(space.access_control) 
          : space.access_control;
      } catch (e) {
        accessControl = {};
      }
    }
    
    // Set enabled to false but keep other settings
    accessControl.enabled = false;
    
    // Update space
    dbRun(`
      UPDATE spaces SET access_control = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [JSON.stringify(accessControl), spaceId]);
    
    return res.json({
      success: true,
      data: {
        access_control: accessControl
      }
    });
  } catch (error) {
    logger.error('[Access] Disable access control error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to disable access control'
    });
  }
});

/**
 * Update access control settings for a space
 * PUT /api/v2/access/space/:spaceId/settings
 * Body: { users_table_id?, role_column_id?, role_mappings? }
 */
router.put('/space/:spaceId/settings', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { users_table_id, role_column_id, role_mappings } = req.body;
    
    // Get current access_control
    const space = await dbGet('SELECT access_control FROM spaces WHERE id = ?', [spaceId]);
    let accessControl = {};
    
    if (space?.access_control) {
      try {
        accessControl = typeof space.access_control === 'string' 
          ? JSON.parse(space.access_control) 
          : space.access_control;
      } catch (e) {
        accessControl = {};
      }
    }
    
    // Update only provided fields
    if (users_table_id !== undefined) {
      accessControl.users_table_id = users_table_id;
    }
    if (role_column_id !== undefined) {
      accessControl.role_column_id = role_column_id;
    }
    if (role_mappings !== undefined) {
      accessControl.role_mappings = role_mappings;
    }
    
    // Update space
    dbRun(`
      UPDATE spaces SET access_control = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [JSON.stringify(accessControl), spaceId]);
    
    return res.json({
      success: true,
      data: {
        access_control: accessControl
      }
    });
  } catch (error) {
    logger.error('[Access] Update access control settings error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update access control settings'
    });
  }
});

/**
 * Get access control settings for a space
 * GET /api/v2/access/space/:spaceId/settings
 */
router.get('/space/:spaceId/settings', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    const space = await dbGet('SELECT access_control, owner_id FROM spaces WHERE id = ?', [spaceId]);
    
    if (!space) {
      return res.status(404).json({
        success: false,
        error: 'Space not found'
      });
    }
    
    let accessControl = {
      enabled: false,
      users_table_id: null,
      role_column_id: null,
      role_mappings: []
    };
    
    if (space.access_control) {
      try {
        accessControl = typeof space.access_control === 'string' 
          ? JSON.parse(space.access_control) 
          : space.access_control;
      } catch (e) {
        // Keep default
      }
    }
    
    return res.json({
      success: true,
      data: {
        access_control: accessControl,
        owner_id: space.owner_id
      }
    });
  } catch (error) {
    logger.error('[Access] Get access control settings error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get access control settings'
    });
  }
});

export default router;
