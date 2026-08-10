// Business Pack Service
// Creates default business infrastructure: Users table, Roles table, Permissions
import { dbRun, dbGet, dbAll } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

/**
 * Generate unique base_id for rows
 */
function generateBaseId(prefix = 'row') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a project within a space
 */
async function createProject(spaceId, name, type, icon, description, ownerId) {
  const result = await dbRun(`
    INSERT INTO projects (name, type, icon, description, owner_id, space_id, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '{}', datetime('now'), datetime('now'))
  `, [name, type, icon, description, ownerId, spaceId]);
  
  return result.lastInsertRowid;
}

/**
 * Create a table within a project
 */
async function createTable(projectId, name, icon, description) {
  const result = await dbRun(`
    INSERT INTO universal_tables (project_id, name, icon, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [projectId, name, icon, description]);
  
  return result.lastInsertRowid;
}

/**
 * Create Business Pack for a space
 * Creates: Users table, Roles table, Access control structures
 */
export async function createBusinessPack(spaceId, userId) {
  apiLogger.info({ spaceId }, 'Creating Business Pack');

  try {
    // 1. Create "System Data" project (system_data type for reliable identification)
    const projectId = await createProject(
      spaceId,
      'System Data',
      'system_data',
      '⚙️',
      'System tables: users, roles, dictionaries',
      userId
    );

    apiLogger.debug({ projectId }, 'Created project System Data');

    // 2. Create Users table
    const usersTableId = await createTable(
      projectId,
      'Users',
      '👥',
      'Space users with access control'
    );

    apiLogger.debug({ usersTableId }, 'Created Users table');

    // 3. Create columns for Users table (with granular access control per level)
    const userColumns = [
      { name: 'system_user_id', display_name: 'System ID', type: 'number', width: 100 },
      { name: 'email', display_name: 'Email', type: 'email', width: 200 },
      { name: 'name', display_name: 'Name', type: 'text', width: 150 },
      { name: 'role', display_name: 'Role', type: 'select', width: 120 },
      { name: 'active', display_name: 'Active', type: 'checkbox', width: 80 },
      // Space level access
      { name: 'space_owner', display_name: 'Space Owner', type: 'multi-select', width: 150 },
      { name: 'space_admin', display_name: 'Space Admin', type: 'multi-select', width: 150 },
      { name: 'space_editor', display_name: 'Space Editor', type: 'multi-select', width: 150 },
      { name: 'space_viewer', display_name: 'Space Viewer', type: 'multi-select', width: 150 },
      { name: 'space_denied', display_name: 'Space Denied', type: 'multi-select', width: 150 },
      // Project level access
      { name: 'project_owner', display_name: 'Project Owner', type: 'multi-select', width: 150 },
      { name: 'project_admin', display_name: 'Project Admin', type: 'multi-select', width: 150 },
      { name: 'project_editor', display_name: 'Project Editor', type: 'multi-select', width: 150 },
      { name: 'project_viewer', display_name: 'Project Viewer', type: 'multi-select', width: 150 },
      { name: 'project_denied', display_name: 'Project Denied', type: 'multi-select', width: 150 },
      // Table level access
      { name: 'table_owner', display_name: 'Table Owner', type: 'multi-select', width: 150 },
      { name: 'table_admin', display_name: 'Table Admin', type: 'multi-select', width: 150 },
      { name: 'table_editor', display_name: 'Table Editor', type: 'multi-select', width: 150 },
      { name: 'table_viewer', display_name: 'Table Viewer', type: 'multi-select', width: 150 },
      { name: 'table_denied', display_name: 'Table Denied', type: 'multi-select', width: 150 },
      // Column level access (format: "tableId:columnKey")
      { name: 'column_owner', display_name: 'Column Owner', type: 'multi-select', width: 150 },
      { name: 'column_admin', display_name: 'Column Admin', type: 'multi-select', width: 150 },
      { name: 'column_editor', display_name: 'Column Editor', type: 'multi-select', width: 150 },
      { name: 'column_viewer', display_name: 'Column Viewer', type: 'multi-select', width: 150 },
      { name: 'column_denied', display_name: 'Column Denied', type: 'multi-select', width: 150 }
    ];

    for (let i = 0; i < userColumns.length; i++) {
      const col = userColumns[i];
      let config = '{}';
      
      if (col.name === 'role') {
        // Role hierarchy: owner > admin > editor > viewer > denied
        config = JSON.stringify({ options: ['owner', 'admin', 'editor', 'viewer', 'denied'] });
      } else if (col.type === 'multi-select') {
        // Empty options - will be filled dynamically with project/table IDs
        config = JSON.stringify({ options: [] });
      }
      
      await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [usersTableId, col.name, col.display_name, col.type, config, col.width, i + 1]
      );
    }

    apiLogger.debug({ count: userColumns.length }, 'Created columns for Users table');

    // 4. Add owner as first user (with full owner access to this space)
    const owner = await dbGet('SELECT email, name FROM users WHERE id = ?', [userId]);
    const ownerName = owner?.name || owner?.email?.split('@')[0] || 'Owner';
    await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        usersTableId,
        generateBaseId('user'),
        JSON.stringify({
          system_user_id: userId,
          email: owner?.email || '',
          name: ownerName,
          role: 'owner',
          active: true,
          // Space level - owner of this space
          space_owner: [String(spaceId)],
          space_admin: [],
          space_editor: [],
          space_viewer: [],
          space_denied: [],
          // Project level - empty means access all via space
          project_owner: [],
          project_admin: [],
          project_editor: [],
          project_viewer: [],
          project_denied: [],
          // Table level
          table_owner: [],
          table_admin: [],
          table_editor: [],
          table_viewer: [],
          table_denied: [],
          // Column level
          column_owner: [],
          column_admin: [],
          column_editor: [],
          column_viewer: [],
          column_denied: []
        }),
        userId
      ]
    );

    apiLogger.debug('Added owner as first user in Users table');

    // 5. Create Roles table
    const rolesTableId = await createTable(
      projectId,
      'Roles',
      '🎭',
      'Roles and permissions'
    );

    apiLogger.debug({ rolesTableId }, 'Created Roles table');

    // Create columns for Roles table
    const roleColumns = [
      { name: 'role_name', display_name: 'Role Name', type: 'text', width: 150 },
      { name: 'permissions', display_name: 'Permissions', type: 'multi-select', width: 200 },
      { name: 'description', display_name: 'Description', type: 'text', width: 250 }
    ];

    for (let i = 0; i < roleColumns.length; i++) {
      const col = roleColumns[i];
      const config = col.name === 'permissions'
        ? JSON.stringify({ options: ['read', 'write', 'delete', 'admin'] })
        : JSON.stringify({});
      
      await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [rolesTableId, col.name, col.display_name, col.type, config, col.width, i + 1]
      );
    }

    // Add default roles
    const defaultRoles = [
      { role_name: 'admin', permissions: ['read', 'write', 'delete', 'admin'], description: 'Full access' },
      { role_name: 'editor', permissions: ['read', 'write'], description: 'Read and write' },
      { role_name: 'viewer', permissions: ['read'], description: 'Read only' }
    ];

    for (const role of defaultRoles) {
      await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [rolesTableId, generateBaseId('role'), JSON.stringify(role), userId]
      );
    }

    apiLogger.debug({ count: defaultRoles.length }, 'Created default roles');

    return {
      project_id: projectId,
      project_name: 'System Data',
      users_table_id: usersTableId,
      roles_table_id: rolesTableId,
      status: 'created'
    };
  } catch (error) {
    apiLogger.error({ err: error, spaceId }, 'Error creating Business Pack');
    throw error;
  }
}

/**
 * Get or create "System Data" project for a space
 * Uses type='system_data' for reliable identification regardless of name
 */
export async function getOrCreateDataSourcesProject(spaceId, userId) {
  // Check if system project already exists by type (most reliable)
  let project = await dbGet(
    `SELECT id, name, type FROM projects WHERE space_id = ? AND type = 'system_data'`,
    [spaceId]
  );

  // Fallback: check old type names for migration
  if (!project) {
    project = await dbGet(
      `SELECT id, name, type FROM projects WHERE space_id = ? AND (type = 'data_sources' OR type = 'access_management')`,
      [spaceId]
    );
  }

  if (project) {
    // Migrate old project to new standard (type='system_data', name='System Data')
    if (project.type !== 'system_data' || project.name !== 'System Data') {
      await dbRun(
        `UPDATE projects SET name = 'System Data', type = 'system_data', icon = '⚙️' WHERE id = ?`,
        [project.id]
      );
      apiLogger.info({ projectId: project.id }, 'Migrated project to System Data');
    }
    return { project_id: project.id, status: 'existing' };
  }

  // Create new system project
  const projectId = await createProject(
    spaceId,
    'System Data',
    'system_data',
    '⚙️',
    'System tables: users, roles, dictionaries',
    userId
  );

  return { project_id: projectId, status: 'created' };
}

/**
 * Get or create Users table in System Data project
 */
export async function getOrCreateUsersTable(spaceId, userId) {
  // First ensure we have the project
  const projectResult = await getOrCreateDataSourcesProject(spaceId, userId);
  const projectId = projectResult.project_id;

  // Check if Users table already exists (case-insensitive)
  let usersTable = await dbGet(
    `SELECT id FROM universal_tables WHERE project_id = ? AND (LOWER(name) = 'users' OR LOWER(name) = 'пользователи')`,
    [projectId]
  );

  if (usersTable) {
    return { table_id: usersTable.id, project_id: projectId, status: 'existing' };
  }

  // Create Users table
  const usersTableId = await createTable(
    projectId,
    'Users',
    '👥',
    'Space users with access control'
  );

  // Create columns for Users table (with granular access control per level)
  const userColumns = [
    { name: 'system_user_id', display_name: 'System ID', type: 'number', width: 100 },
    { name: 'email', display_name: 'Email', type: 'email', width: 200 },
    { name: 'name', display_name: 'Name', type: 'text', width: 150 },
    { name: 'role', display_name: 'Role', type: 'select', width: 120 },
    { name: 'active', display_name: 'Active', type: 'checkbox', width: 80 },
    // Space level access
    { name: 'space_owner', display_name: 'Space Owner', type: 'multi-select', width: 150 },
    { name: 'space_admin', display_name: 'Space Admin', type: 'multi-select', width: 150 },
    { name: 'space_editor', display_name: 'Space Editor', type: 'multi-select', width: 150 },
    { name: 'space_viewer', display_name: 'Space Viewer', type: 'multi-select', width: 150 },
    { name: 'space_denied', display_name: 'Space Denied', type: 'multi-select', width: 150 },
    // Project level access
    { name: 'project_owner', display_name: 'Project Owner', type: 'multi-select', width: 150 },
    { name: 'project_admin', display_name: 'Project Admin', type: 'multi-select', width: 150 },
    { name: 'project_editor', display_name: 'Project Editor', type: 'multi-select', width: 150 },
    { name: 'project_viewer', display_name: 'Project Viewer', type: 'multi-select', width: 150 },
    { name: 'project_denied', display_name: 'Project Denied', type: 'multi-select', width: 150 },
    // Table level access
    { name: 'table_owner', display_name: 'Table Owner', type: 'multi-select', width: 150 },
    { name: 'table_admin', display_name: 'Table Admin', type: 'multi-select', width: 150 },
    { name: 'table_editor', display_name: 'Table Editor', type: 'multi-select', width: 150 },
    { name: 'table_viewer', display_name: 'Table Viewer', type: 'multi-select', width: 150 },
    { name: 'table_denied', display_name: 'Table Denied', type: 'multi-select', width: 150 },
    // Column level access (format: "tableId:columnKey")
    { name: 'column_owner', display_name: 'Column Owner', type: 'multi-select', width: 150 },
    { name: 'column_admin', display_name: 'Column Admin', type: 'multi-select', width: 150 },
    { name: 'column_editor', display_name: 'Column Editor', type: 'multi-select', width: 150 },
    { name: 'column_viewer', display_name: 'Column Viewer', type: 'multi-select', width: 150 },
    { name: 'column_denied', display_name: 'Column Denied', type: 'multi-select', width: 150 }
  ];

  for (let i = 0; i < userColumns.length; i++) {
    const col = userColumns[i];
    let config = '{}';
    
    if (col.name === 'role') {
      // Role hierarchy: owner > admin > editor > viewer > denied
      config = JSON.stringify({ options: ['owner', 'admin', 'editor', 'viewer', 'denied'] });
    } else if (col.type === 'multi-select') {
      config = JSON.stringify({ options: [] });
    }
    
    await dbRun(
      `INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [usersTableId, col.name, col.display_name, col.type, config, col.width, i + 1]
    );
  }

  // Add owner as first user (with full owner access to this space)
  const owner = await dbGet('SELECT email, name FROM users WHERE id = ?', [userId]);
  const ownerName = owner?.name || owner?.email?.split('@')[0] || 'Owner';
  await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      usersTableId,
      generateBaseId('user'),
      JSON.stringify({
        system_user_id: userId,
        email: owner?.email || '',
        name: ownerName,
        role: 'owner',
        active: true,
        // Space level - owner of this space
        space_owner: [String(spaceId)],
        space_admin: [],
        space_editor: [],
        space_viewer: [],
        space_denied: [],
        // Project level - empty means access all via space
        project_owner: [],
        project_admin: [],
        project_editor: [],
        project_viewer: [],
        project_denied: [],
        // Table level
        table_owner: [],
        table_admin: [],
        table_editor: [],
        table_viewer: [],
        table_denied: [],
        // Column level
        column_owner: [],
        column_admin: [],
        column_editor: [],
        column_viewer: [],
        column_denied: []
      }),
      userId
    ]
  );

  return { table_id: usersTableId, project_id: projectId, status: 'created' };
}

/**
 * Get or create Roles table in System Data project
 */
export async function getOrCreateRolesTable(spaceId, userId) {
  // First ensure we have the project
  const projectResult = await getOrCreateDataSourcesProject(spaceId, userId);
  const projectId = projectResult.project_id;

  // Check if Roles table already exists (check both old and new names)
  let rolesTable = await dbGet(
    `SELECT id FROM universal_tables WHERE project_id = ? AND (name = 'Roles' OR name = 'Роли')`,
    [projectId]
  );

  if (rolesTable) {
    // Migrate to English name if needed
    await dbRun(`UPDATE universal_tables SET name = 'Roles' WHERE id = ?`, [rolesTable.id]);
    return { table_id: rolesTable.id, project_id: projectId, status: 'existing' };
  }

  // Create Roles table
  const rolesTableId = await createTable(
    projectId,
    'Roles',
    '🎭',
    'Roles and permissions'
  );

  // Create columns for Roles table
  const roleColumns = [
    { name: 'role_name', display_name: 'Role Name', type: 'text', width: 150 },
    { name: 'permissions', display_name: 'Permissions', type: 'multi-select', width: 200 },
    { name: 'description', display_name: 'Description', type: 'text', width: 250 }
  ];

  for (let i = 0; i < roleColumns.length; i++) {
    const col = roleColumns[i];
    const config = col.name === 'permissions'
      ? JSON.stringify({ options: ['read', 'write', 'delete', 'admin'] })
      : JSON.stringify({});
    
    await dbRun(
      `INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [rolesTableId, col.name, col.display_name, col.type, config, col.width, i + 1]
    );
  }

  // Add default roles
  const defaultRoles = [
    { role_name: 'admin', permissions: ['read', 'write', 'delete', 'admin'], description: 'Full access' },
    { role_name: 'editor', permissions: ['read', 'write'], description: 'Read and write' },
    { role_name: 'viewer', permissions: ['read'], description: 'Read only' }
  ];

  for (const role of defaultRoles) {
    await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [rolesTableId, generateBaseId('role'), JSON.stringify(role), userId]
    );
  }

  return { table_id: rolesTableId, project_id: projectId, status: 'created' };
}

/**
 * Get or create Variables table in System Data project (ADR-026)
 * @param {number} spaceId - Space ID
 * @param {number} userId - User ID creating the table
 * @returns {Promise<{table_id: number, project_id: number, status: 'existing'|'created'}>}
 */
export async function getOrCreateVariablesTable(spaceId, userId) {
  // First ensure we have the System Data project
  const projectResult = await getOrCreateDataSourcesProject(spaceId, userId);
  const projectId = projectResult.project_id;

  // Check if Variables table already exists
  let variablesTable = await dbGet(
    `SELECT id FROM universal_tables WHERE project_id = ? AND LOWER(name) = 'variables'`,
    [projectId]
  );

  if (variablesTable) {
    return { table_id: variablesTable.id, project_id: projectId, status: 'existing' };
  }

  // Create Variables table
  const variablesTableId = await createTable(
    projectId,
    'Variables',
    '🧮',
    'Space variables for formulas and calculations (ADR-026)'
  );

  // Create columns for Variables table
  const variableColumns = [
    { name: 'name', display_name: 'Name', type: 'text', width: 150 },
    { name: 'scope_type', display_name: 'Scope', type: 'select', width: 120, 
      config: { options: [
        { label: '🌍 Space', value: 'space', color: '#3b82f6' },
        { label: '📊 Table', value: 'table', color: '#10b981' },
        { label: '📈 Dashboard', value: 'dashboard', color: '#8b5cf6' }
      ]}
    },
    { name: 'scope_ref', display_name: 'Applies To', type: 'number', width: 100 },
    { name: 'formula', display_name: 'Formula', type: 'textarea', width: 250 },
    { name: 'description', display_name: 'Description', type: 'text', width: 200 },
    { name: 'stream_id', display_name: 'Stream', type: 'number', width: 80, config: { default: 1 } },
    { name: 'order_index', display_name: 'Order', type: 'number', width: 80 },
    { name: 'cached_value', display_name: 'Current Value', type: 'text', width: 150 },
    { name: 'cached_at', display_name: 'Cached At', type: 'datetime', width: 150 },
    { name: 'dependencies', display_name: 'Dependencies', type: 'textarea', width: 200 }
  ];

  for (let i = 0; i < variableColumns.length; i++) {
    const col = variableColumns[i];
    const config = col.config ? JSON.stringify(col.config) : '{}';
    
    await dbRun(
      `INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [variablesTableId, col.name, col.display_name, col.type, config, col.width, i + 1]
    );
  }

  return { table_id: variablesTableId, project_id: projectId, status: 'created' };
}
