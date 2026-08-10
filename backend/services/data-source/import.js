// data-source/import.js — Project creation and external table import
import { dbGet, dbRun } from '../../database/connection.js';
import { dbLogger } from '../../utils/logger.js';
import { get } from './crud.js';
import { listTables, listTableColumns } from './queries.js';

/**
 * Create "System Data" project in specified Space when first data source is added
 * Uses type='system_data' for reliable identification regardless of name
 * @param {string} spaceId - Space ID where to create the project
 * @param {number} userId - User ID (owner of the project)
 * @returns {Promise<Object>} Created project with Databases table
 */
async function createDataSourcesProject(spaceId, userId) {
  // Import services to avoid circular dependencies
  const { createProject } = await import('../ProjectService.js');
  const { createDatabasesTable } = await import('../SystemTablesCreator.js');

  // Check if system project already exists in this Space (by type for reliability)
  let existingProject = await dbGet(`
    SELECT id, name, type FROM projects WHERE space_id = ? AND type = 'system_data'
  `, [spaceId]);

  // Fallback: check old type names for migration
  if (!existingProject) {
    existingProject = await dbGet(`
      SELECT id, name, type FROM projects WHERE space_id = ? AND (type = 'data_sources' OR type = 'access_management' OR name = 'Источники данных')
    `, [spaceId]);
  }

  if (existingProject) {
    // Migrate old project to new standard if needed
    if (existingProject.type !== 'system_data' || existingProject.name !== 'System Data') {
      await dbRun(`
        UPDATE projects SET name = 'System Data', type = 'system_data', icon = '⚙️' WHERE id = ?
      `, [existingProject.id]);
      dbLogger.info({ projectId: existingProject.id }, 'Migrated project to System Data');
    }
    dbLogger.debug({ spaceId }, 'System Data project already exists');
    return existingProject;
  }

  // Create "System Data" project in the specified Space with type='system_data'
  const project = await createProject({
    space_id: spaceId,
    name: 'System Data',
    description: 'System tables: databases, users, roles',
    icon: '⚙️',
    type: 'system_data',
    owner_id: userId,
    theme_primary: '#06b6d4',
    theme_secondary: '#3b82f6',
    theme_tertiary: '#8b5cf6'
  });

  // Delete auto-created empty "System Data Data" table
  await dbRun(`
    DELETE FROM universal_tables
    WHERE project_id = ? AND name = 'System Data Data'
  `, [project.id]);

  // Create "Базы данных" table with proper columns
  await createDatabasesTable(project.id);

  dbLogger.info({ projectId: project.id, spaceId, userId }, 'Created System Data project');

  return project;
}

/**
 * Add entry to "Базы данных" table when data source is created
 * @param {number} tableId - Table ID of "Базы данных"
 * @param {Object} data - Data source information
 */
async function addToDatabasesTable(tableId, data) {
  const { name, type, host, port, database, username, password, status, data_source_id } = data;

  try {
    // Insert into table_rows
    await dbRun(`
      INSERT INTO table_rows (
        table_id, base_id, data, created_at, updated_at
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      tableId,
      data_source_id, // Use data_source_id as base_id for linking
      JSON.stringify({
        name,
        type,
        host,
        port,
        database,
        username,
        password,
        status,
        data_source_id
      })
    ]);

    dbLogger.debug({ name }, 'Added data source to Базы данных table');
  } catch (error) {
    dbLogger.error({ err: error }, 'Failed to add to Базы данных table');
    // Don't throw - this is supplementary functionality
  }
}

/**
 * Import all tables from a data source into the CRM
 * @param {string} dataSourceId - Data source ID
 * @param {number} projectId - Project ID where to create tables
 * @returns {Promise<Array>} List of imported tables
 */
async function importExternalTables(dataSourceId, projectId) {
  dbLogger.info({ dataSourceId, projectId }, 'Importing tables from data source');

  // Get the data source info
  const dataSource = await get(dataSourceId);

  // Get list of tables from the external database
  let externalTables = [];
  try {
    externalTables = await listTables(dataSourceId);
    dbLogger.debug({ count: externalTables.length }, 'Found tables in external database');
  } catch (error) {
    dbLogger.error({ err: error }, 'Failed to list tables');
    throw error;
  }

  const importedTables = [];

  for (const extTable of externalTables) {
    // Check if this table already exists
    const existing = await dbGet(`
      SELECT id FROM universal_tables
      WHERE data_source_id = ? AND source_table_name = ?
    `, [dataSourceId, extTable.name]);

    if (existing) {
      dbLogger.debug({ tableName: extTable.name }, 'Table already imported, skipping');
      continue;
    }

    // Create table in CRM
    const result = await dbRun(`
      INSERT INTO universal_tables (
        project_id,
        name,
        description,
        icon,
        is_system,
        data_source_id,
        source_table_name,
        sync_enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, 1, datetime('now'), datetime('now'))
    `, [
      projectId,
      extTable.name,
      `External table from ${dataSource.name}`,
      '🔗',
      dataSourceId,
      extTable.name
    ]);

    const tableId = result.lastID || result.lastInsertRowid;
    dbLogger.debug({ tableName: extTable.name, tableId }, 'Created external table');

    // Import columns for this table
    try {
      const columns = await listTableColumns(dataSourceId, extTable.name);

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];

        // Map external type to internal type
        let internalType = 'text';
        if (col.type.includes('int') || col.type.includes('decimal') || col.type.includes('float') || col.type.includes('double')) {
          internalType = 'number';
        } else if (col.type.includes('date') || col.type.includes('time')) {
          internalType = 'date';
        } else if (col.type.includes('bool')) {
          internalType = 'checkbox';
        }

        await dbRun(`
          INSERT INTO table_columns (
            table_id,
            column_name,
            display_name,
            type,
            is_required,
            order_index,
            is_visible,
            config,
            is_from_source,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 0, ?, 1, ?, 1, datetime('now'), datetime('now'))
        `, [
          tableId,
          col.name,
          col.name,
          internalType,
          i,
          JSON.stringify({})
        ]);
      }

      dbLogger.debug({ tableName: extTable.name, columnCount: columns.length }, 'Imported columns for table');
    } catch (error) {
      dbLogger.error({ err: error, tableName: extTable.name }, 'Failed to import columns');
    }

    importedTables.push({
      id: tableId,
      name: extTable.name,
      data_source_id: dataSourceId
    });
  }

  dbLogger.info({ count: importedTables.length }, 'Imported tables from data source');
  return importedTables;
}

export {
  createDataSourcesProject,
  addToDatabasesTable,
  importExternalTables,
};
