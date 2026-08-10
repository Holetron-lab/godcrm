// data-source/crud.js — CRUD operations, validation, and connection testing
import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import crypto from 'crypto';
import { dbLogger } from '../../utils/logger.js';
import { decryptCredential } from '../../utils/encryption.js';

/**
 * Valid data source types
 */
const VALID_TYPES = [
  'ssh+mysql',
  'ssh+postgres',
  'direct+mysql',
  'direct+postgres',
  'local_mysql',
  'local_postgresql',
  'mysql',
  'postgresql',
  'sqlite',
  'internal'  // Internal SQLite tables (users, spaces, projects, etc.)
];

/**
 * Get data source by ID
 * @param {string} id - Data source ID
 * @returns {Promise<Object>} Data source
 */
async function get(id) {
  const dataSource = await dbGet(`
    SELECT * FROM data_sources WHERE id = ?
  `, [id]);

  if (!dataSource) {
    throw new Error('Data source not found');
  }

  return dataSource;
}

/**
 * List all data sources for a workspace
 * @param {string} workspaceId - Workspace ID
 * @returns {Promise<Array>} List of data sources
 */
async function list(workspaceId) {
  return await dbAll(`
    SELECT * FROM data_sources
    WHERE workspace_id = ?
    ORDER BY created_at DESC
  `, [workspaceId]);
}

/**
 * Create a new data source
 * @param {Object} params - Data source parameters
 * @param {Object} service - Reference to the DataSourceService instance (for method calls)
 * @returns {Promise<Object>} Created data source
 */
async function create(params, service) {
  const {
    workspaceId,
    projectId = null,
    userId,
    name,
    description = null,
    type,
    sshHost = null,
    sshPort = 22,
    sshUsername = null,
    sshKeyName = null,
    dbHost = null,
    dbPort = null,
    dbName = null,
    dbUsername = null,
    dbPasswordKey = null,
    dbPasswordEncrypted = null,
    sshPrivateKeyEncrypted = null
  } = params;

  // Validation
  if (!name) {
    throw new Error('name is required');
  }

  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  // Validate SSH parameters for ssh+ types
  if (type.startsWith('ssh+')) {
    if (!sshHost || !sshUsername || !sshKeyName) {
      throw new Error('SSH parameters are required for SSH tunnel types (sshHost, sshUsername, sshKeyName)');
    }
  }

  // Validate DB parameters (dbPasswordKey can be optional for some cases)
  if (!dbHost || !dbName || !dbUsername) {
    throw new Error('Database parameters are required (dbHost, dbName, dbUsername)');
  }

  // Generate unique ID
  const id = `ds_${crypto.randomBytes(8).toString('hex')}`;

  // Check if this is the first data source in workspace
  const existingCount = await dbGet(`
    SELECT COUNT(*) as count FROM data_sources WHERE workspace_id = ?
  `, [workspaceId]);

  const isFirstDataSource = existingCount.count === 0;

  // Insert into database
  await dbRun(`
    INSERT INTO data_sources (
      id, workspace_id, created_by, name, description, type,
      ssh_host, ssh_port, ssh_username, ssh_key_name,
      db_host, db_port, db_name, db_username, db_password_key,
      db_password_encrypted, ssh_private_key_encrypted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, workspaceId, userId, name, description, type,
    sshHost, sshPort, sshUsername, sshKeyName,
    dbHost, dbPort, dbName, dbUsername, dbPasswordKey,
    dbPasswordEncrypted, sshPrivateKeyEncrypted
  ]);

  // If this is the first data source in this Space, create "Источники данных" project
  let databasesTableId = null;
  if (isFirstDataSource) {
    const project = await service.createDataSourcesProject(workspaceId, userId);
    if (project) {
      // Find the "Базы данных" table in the created project
      const table = await dbGet(`
        SELECT id FROM universal_tables
        WHERE project_id = ? AND name = 'Базы данных'
      `, [project.id]);
      databasesTableId = table?.id;
    }
  } else {
    // Find existing "Базы данных" table in System Data project (by type)
    const project = await dbGet(`
      SELECT id FROM projects WHERE space_id = ? AND type = 'system_data'
    `, [workspaceId]);

    if (project) {
      const table = await dbGet(`
        SELECT id FROM universal_tables
        WHERE project_id = ? AND name = 'Базы данных'
      `, [project.id]);
      databasesTableId = table?.id;
    }
  }

  // Add entry to "Базы данных" table if it exists
  if (databasesTableId) {
    await service.addToDatabasesTable(databasesTableId, {
      name,
      type,
      host: dbHost,
      port: dbPort,
      database: dbName,
      username: dbUsername,
      password: '***', // Masked password
      status: 'disconnected',
      data_source_id: id
    });
  }

  // Get the target project for external tables
  // Use provided projectId first, otherwise look for System Data project (by type)
  let targetProjectId = projectId;
  if (!targetProjectId) {
    const project = await dbGet(`
      SELECT id FROM projects WHERE space_id = ? AND type = 'system_data'
    `, [workspaceId]);
    targetProjectId = project?.id;
  }

  // Auto-import tables from the data source
  if (targetProjectId) {
    try {
      dbLogger.info({ targetProjectId }, 'Auto-importing tables');
      await service.importExternalTables(id, targetProjectId);
    } catch (error) {
      dbLogger.error({ err: error }, 'Failed to auto-import tables');
      // Don't fail the create - tables can be imported manually later
    }
  } else {
    dbLogger.debug('No target project found, skipping auto-import');
  }

  // Fetch and return created data source
  return await get(id);
}

/**
 * Update data source
 * @param {string} id - Data source ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated data source
 */
async function update(id, updates) {
  // Check if data source exists
  await get(id);

  // Build UPDATE query
  const allowedFields = [
    'name', 'description', 'type',
    'ssh_host', 'ssh_port', 'ssh_username', 'ssh_key_name',
    'db_host', 'db_port', 'db_name', 'db_username', 'db_password_key',
    'db_password_encrypted', 'ssh_private_key_encrypted',
    'sync_enabled', 'sync_interval_minutes'
  ];

  const setClauses = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) {
    throw new Error('No valid fields to update');
  }

  // Add updated_at
  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  await dbRun(`
    UPDATE data_sources
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `, values);

  return await get(id);
}

/**
 * Delete data source
 * @param {string} id - Data source ID
 */
async function del(id) {
  // Check if exists
  await get(id);

  await dbRun('DELETE FROM data_sources WHERE id = ?', [id]);
}

/**
 * Test connection to data source
 * @param {string} id - Data source ID
 * @returns {Promise<Object>} Test result
 */
async function testConnection(id) {
  const dataSource = await get(id);

  const result = {
    status: 'failed',
    error: 'Connection testing not implemented yet',
    tested_at: new Date().toISOString()
  };

  // Update test status in database
  await dbRun(`
    UPDATE data_sources
    SET last_test_at = ?, last_test_status = ?, last_test_error = ?
    WHERE id = ?
  `, [result.tested_at, result.status, result.error, id]);

  return result;
}

/**
 * Validate data source configuration
 * @param {Object} config - Configuration to validate
 * @returns {boolean} True if valid
 * @throws {Error} If configuration is invalid
 */
function validateConfig(config) {
  const { type } = config;

  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Invalid type: ${type}`);
  }

  // Validate SSH parameters for ssh+ types
  if (type.startsWith('ssh+')) {
    const requiredSshFields = ['sshHost', 'sshPort', 'sshUsername', 'sshKeyName'];
    for (const field of requiredSshFields) {
      if (!config[field]) {
        throw new Error(`SSH field required: ${field}`);
      }
    }
  }

  // Validate DB parameters (dbPasswordKey is optional for local connections)
  const requiredDbFields = ['dbHost', 'dbPort', 'dbName', 'dbUsername'];
  for (const field of requiredDbFields) {
    if (!config[field]) {
      throw new Error(`Database field required: ${field}`);
    }
  }

  return true;
}

/**
 * ADR-064: Get decrypted password for establishing actual DB connections
 * This is the ONLY place where passwords should be decrypted.
 * @param {Object} dataSource - Data source object from database
 * @returns {string} Decrypted password (empty string if none set)
 */
function getDecryptedPassword(dataSource) {
  if (dataSource.db_password_encrypted) {
    try {
      return decryptCredential(dataSource.db_password_encrypted);
    } catch (err) {
      dbLogger.error({ err, dataSourceId: dataSource.id }, 'Failed to decrypt data source password');
      throw new Error('Failed to decrypt data source credentials');
    }
  }
  return '';
}

export {
  VALID_TYPES,
  get,
  list,
  create,
  update,
  del as delete_,
  testConnection,
  validateConfig,
  getDecryptedPassword,
};
