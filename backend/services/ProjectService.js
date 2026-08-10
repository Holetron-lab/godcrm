// Project Service - v0.003.000 - Updated for Spaces architecture
import { dbRun, dbGet, dbAll, toBool, safeJsonParse, withTransactionAsync } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { createSystemTables } from './SystemTablesCreator.js';
import { getSpaceById, getUserAccessData, canAccessProject, getEffectiveProjectRole } from './SpaceService.js';
import { createDashboard } from './DashboardService.js';

/**
 * Default theme colors
 */
const DEFAULT_THEME = {
  primary: '#0ea5e9',
  secondary: '#8b5cf6',
  tertiary: '#10b981'
};

/**
 * Validate project data
 * @param {object} projectData - Project data to validate
 * @throws {Error} If validation fails
 */
async function validateProjectData(projectData) {
  const { space_id, name, owner_id } = projectData;

  if (!space_id) {
    throw new Error('space_id is required');
  }

  if (!name) {
    throw new Error('name is required');
  }

  if (!owner_id) {
    throw new Error('owner_id is required');
  }

  // Verify space exists
  const space = await getSpaceById(space_id);
  if (!space) {
    throw new Error('Space not found');
  }
}

/**
 * Create a new project
 * @param {object} projectData - { space_id, name, description?, icon?, owner_id, type?, theme_*, settings? }
 * @returns {Promise<object>} Created project
 */
export async function createProject(projectData) {
  const {
    space_id,
    name,
    description = null,
    icon = '📁',
    owner_id,
    type = 'custom',
    theme_primary = DEFAULT_THEME.primary,
    theme_secondary = DEFAULT_THEME.secondary,
    theme_tertiary = DEFAULT_THEME.tertiary,
    settings = null
  } = projectData;

  // Validation
  await validateProjectData(projectData);

  // Wrap multi-step creation in transaction for atomicity
  const projectId = await withTransactionAsync(async (trx) => {
    // Create project
    const result = await trx.run(`
    INSERT INTO projects (
      space_id, name, description, icon, type, owner_id,
      theme_primary, theme_secondary, theme_tertiary, settings
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    space_id, name, description, icon, type, owner_id,
    theme_primary, theme_secondary, theme_tertiary,
    settings ? JSON.stringify(settings) : null
  ]);

    const pId = result.lastInsertRowid || result.lastID;

    // Auto-create primary table
    const tableResult = await trx.run(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system)
    VALUES (?, ?, ?, ?, ?)
  `, [
    pId,
    name + ' Data',
    'Main data table',
    icon,
    toBool(false)
  ]);

    const tableId = tableResult.lastInsertRowid || tableResult.lastID;

    // Update project with primary_table_id
    await trx.run('UPDATE projects SET primary_table_id = ? WHERE id = ?', [tableId, pId]);

    // Auto-create project dashboard
    await trx.run(`
      INSERT INTO dashboards (user_id, space_id, project_id, name, description, icon, is_default, order_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `, [null, null, pId, name + ' Dashboard', null, '📊', toBool(true)]);

    return pId;
  });

  apiLogger.debug({ projectId, name }, 'Project created with transaction');

  return await getProjectById(projectId);
}

/**
 * Get all projects for a user
 * @param {number} userId - User ID
 * @returns {Promise<array>} Array of projects
 */
export async function getProjectsByUser(userId) {
  const projects = await dbAll(
    'SELECT * FROM projects WHERE owner_id = ? ORDER BY created_at ASC',
    [userId]
  );
  return projects.map(p => ({
    ...p,
    settings: p.settings ? safeJsonParse(p.settings) : null
  }));
}

/**
 * Get all projects in a space
 * @param {number} spaceId - Space ID
 * @returns {Promise<array>} Array of projects
 */
export async function getProjectsBySpace(spaceId) {
  const projects = await dbAll(
    'SELECT * FROM projects WHERE space_id = ? ORDER BY order_index ASC, created_at ASC',
    [spaceId]
  );
  return projects.map(p => ({
    ...p,
    settings: p.settings ? safeJsonParse(p.settings) : null,
    access_control: p.access_control ? safeJsonParse(p.access_control) : null
  }));
}

/**
 * Get projects in a space filtered by user's granular access
 * Applies System Data role downgrade: admin→editor, editor→viewer, viewer→denied
 * @param {number} spaceId - Space ID
 * @param {number} userId - User ID
 * @param {object} spaceAccessControl - Space's access_control config
 * @returns {Promise<array>} Array of accessible projects with effective role
 */
export async function getProjectsBySpaceForUser(spaceId, userId, spaceAccessControl, spaceOwnerId = null) {
  const allProjects = await getProjectsBySpace(spaceId);
  
  // Space owner всегда видит все проекты как owner_owner
  if (spaceOwnerId && Number(spaceOwnerId) === Number(userId)) {
    return allProjects.map((p) => ({ ...p, _effectiveRole: 'owner_owner' }));
  }
  
  // If no access control, return all projects
  const usersTableId =
    spaceAccessControl?.usersTableId ||
    spaceAccessControl?.users_table_id ||
    spaceAccessControl?.users_tableId;
  if (!spaceAccessControl?.enabled || !usersTableId) {
    return allProjects;
  }
  
  // Get user's granular access data
  const userAccessData = await getUserAccessData(userId, spaceAccessControl);
  
  // If user not found in access table, they shouldn't see anything
  if (!userAccessData) {
    return [];
  }
  
  // Filter projects based on granular access
  const accessibleProjects = [];
  
  for (const project of allProjects) {
    // Get effective role (with System Data downgrade)
    const effectiveRole = getEffectiveProjectRole(userAccessData, project);
    
    // Skip if denied (viewers become denied for System Data)
    if (effectiveRole === 'denied') {
      continue;
    }
    
    // Check basic project access
    if (canAccessProject(userAccessData, project.id)) {
      accessibleProjects.push({
        ...project,
        _effectiveRole: effectiveRole // Include effective role for frontend
      });
    }
  }
  
  return accessibleProjects;
}

/**
 * Get project by ID
 * @param {number} projectId - Project ID
 * @returns {Promise<object|null>} Project or null
 */
export async function getProjectById(projectId) {
  const project = await dbGet('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    return null;
  }
  return {
    ...project,
    settings: project.settings ? safeJsonParse(project.settings) : null
  };
}

/**
 * Update project
 * @param {number} projectId - Project ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated project
 */
export async function updateProject(projectId, updates) {
  // Verify project exists
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  // Prevent changing space_id
  if (updates.space_id && updates.space_id !== project.space_id) {
    throw new Error('Cannot change space_id. Delete and recreate project instead.');
  }

  const allowedFields = ['name', 'description', 'icon', 'theme_primary', 'theme_secondary', 'theme_tertiary', 'settings'];
  const updatesFields = Object.keys(updates).filter(key => allowedFields.includes(key));

  if (updatesFields.length === 0) {
    return project;
  }

  const setClause = updatesFields.map(field => `${field} = ?`).join(', ');
  const values = updatesFields.map(field => 
    field === 'settings' && updates[field] ? JSON.stringify(updates[field]) : updates[field]
  );

  await dbRun(`UPDATE projects SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, projectId]);

  return await getProjectById(projectId);
}

/**
 * Delete project
 * @param {number} projectId - Project ID
 * @returns {Promise<void>}
 */
export async function deleteProject(projectId) {
  // Verify project exists
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  // Delete project (CASCADE will handle tables and dashboards)
  await dbRun('DELETE FROM projects WHERE id = ?', [projectId]);
}

/**
 * Auto-create default spaces and projects for user (v0.003.000)
 * - First user (owner): Admin Space with System Project + Personal Space
 * - Other users: Personal Space only
 * @param {number} userId - User ID
 * @param {string} userName - User name
 */
export async function autoCreateDefaultProjects(userId, userName) {
  // Import createSpace here to avoid circular dependency
  const { createSpace } = await import('./SpaceService.js');

  const isFirstUser = userId === 1;

  // Create Admin Space for first user only (check if not exists)
  if (isFirstUser) {
    const existingAdminSpace = await dbGet('SELECT id FROM spaces WHERE owner_id = ? AND type = ?', [userId, 'admin']);
    
    if (!existingAdminSpace) {
      const adminSpace = await createSpace({
        owner_id: userId,
        name: "Admin Space",
        description: 'System administration and user management',
        icon: '⚙️',
        type: 'admin',
        theme_primary: '#ef4444', // Red for admin
        theme_secondary: '#f97316', // Orange
        theme_tertiary: '#eab308' // Yellow
      });

      // Create system project in admin space
      const adminProject = await createProject({
        space_id: adminSpace.id,
        name: "System Management",
        description: 'User and system management',
        icon: '⚙️',
        type: 'admin',
        owner_id: userId,
        theme_primary: '#ef4444',
        theme_secondary: '#f97316',
        theme_tertiary: '#eab308'
      });

      // Create system tables (Users, Projects, Tables)
      await createSystemTables(adminProject.id);
    }
  }

  // Create Personal Space for every user
  const personalSpace = await createSpace({
    owner_id: userId,
    name: 'Personal Space',
    description: 'Your private workspace',
    icon: '👤',
    type: 'personal',
    theme_primary: '#0ea5e9',
    theme_secondary: '#8b5cf6',
    theme_tertiary: '#10b981'
  });

  // Create default project in personal space
  await createProject({
    space_id: personalSpace.id,
    name: 'My Tasks',
    description: 'Personal task management',
    icon: '✅',
    type: 'personal',
    owner_id: userId,
    theme_primary: '#0ea5e9',
    theme_secondary: '#8b5cf6',
    theme_tertiary: '#10b981'
  });
}
