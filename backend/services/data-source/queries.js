// data-source/queries.js — External database query operations
import { dbGet, dbAll } from '../../database/connection.js';
import { escapeIdentifier } from '../../utils/sqlSanitizer.js';
import { dbLogger } from '../../utils/logger.js';
import { get, getDecryptedPassword } from './crud.js';

/**
 * List tables from data source
 * @param {string} id - Data source ID
 * @returns {Promise<Array>} List of tables
 */
async function listTables(id) {
  const dataSource = await get(id);

  // For now, only support local_mysql
  if (dataSource.type === 'local_mysql') {
    const mysql = await import('mysql2/promise');

    // ADR-064: Decrypt password for actual connection
    const dbPassword = getDecryptedPassword(dataSource);
    const connection = await mysql.createConnection({
      host: dataSource.db_host,
      port: dataSource.db_port,
      database: dataSource.db_name,
      user: dataSource.db_username,
      password: dbPassword
    });

    try {
      const [rows] = await connection.execute('SHOW TABLES');
      const tableKey = `Tables_in_${dataSource.db_name}`;
      const tables = rows.map(row => ({
        name: row[tableKey],
        type: 'table'
      }));

      return tables;
    } finally {
      await connection.end();
    }
  }

  throw new Error(`Listing tables not supported for type: ${dataSource.type}`);
}

/**
 * List columns from a specific table in data source
 * @param {string} id - Data source ID
 * @param {string} tableName - Table name
 * @returns {Promise<Array>} List of columns
 */
async function listTableColumns(id, tableName) {
  const dataSource = await get(id);

  // For now, only support local_mysql
  if (dataSource.type === 'local_mysql') {
    const mysql = await import('mysql2/promise');

    // ADR-064: Decrypt password for actual connection
    const dbPassword = getDecryptedPassword(dataSource);
    const connection = await mysql.createConnection({
      host: dataSource.db_host,
      port: dataSource.db_port,
      database: dataSource.db_name,
      user: dataSource.db_username,
      password: dbPassword
    });

    try {
      const [rows] = await connection.execute(`DESCRIBE \`${tableName}\``);
      const columns = rows.map(row => ({
        name: row.Field,
        type: row.Type
      }));

      return columns;
    } finally {
      await connection.end();
    }
  }

  throw new Error(`Listing columns not supported for type: ${dataSource.type}`);
}

/**
 * Query data from a specific table in data source
 * @param {string} id - Data source ID
 * @param {string} tableName - Table name
 * @param {Object} options - Query options (limit, offset)
 * @returns {Promise<Array>} List of rows as plain objects
 */
async function queryTable(id, tableName, options = {}) {
  const { limit = 50, offset = 0 } = options;
  const dataSource = await get(id);

  // Internal data source - query local SQLite tables directly
  if (dataSource.type === 'internal') {
    try {
      // Use escapeIdentifier for safe table name handling
      const safeTableName = escapeIdentifier(tableName);
      const rows = await dbAll(
        `SELECT * FROM ${safeTableName} LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      dbLogger.debug({ tableName, rowCount: rows.length }, 'Fetched rows from local table');
      return rows;
    } catch (error) {
      dbLogger.error({ err: error, tableName }, 'Error querying local table');
      throw error;
    }
  }

  // External MySQL data source
  if (dataSource.type === 'local_mysql') {
    const mysql = await import('mysql2/promise');

    // ADR-064: Decrypt password for actual connection
    const dbPassword = getDecryptedPassword(dataSource);
    const connection = await mysql.createConnection({
      host: dataSource.db_host,
      port: dataSource.db_port,
      database: dataSource.db_name,
      user: dataSource.db_username,
      password: dbPassword
    });

    try {
      // Validate table name - MySQL uses backticks for identifiers
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        throw new Error(`Invalid table name: ${tableName}`);
      }
      const [rows] = await connection.execute(
        `SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`,
        [limit, offset]
      );

      dbLogger.debug({ tableName, rowCount: rows.length }, 'Fetched rows from external table');
      return rows;
    } finally {
      await connection.end();
    }
  }

  throw new Error(`Querying table not supported for type: ${dataSource.type}`);
}

/**
 * Query single row by ID from external data source
 * @param {string} id - Data source ID
 * @param {string} tableName - Table name
 * @param {string|number} rowId - Row ID
 * @returns {Promise<Object|null>} Row data or null
 */
async function queryRowById(id, tableName, rowId) {
  const dataSource = await get(id);

  // Internal data source
  if (dataSource.type === 'internal') {
    try {
      // Use escapeIdentifier for safe table name handling
      const safeTableName = escapeIdentifier(tableName);
      const row = await dbGet(
        `SELECT * FROM ${safeTableName} WHERE id = ?`,
        [rowId]
      );
      return row;
    } catch (error) {
      dbLogger.error({ err: error, tableName, rowId }, 'Error querying row by ID');
      throw error;
    }
  }

  // External MySQL data source
  if (dataSource.type === 'local_mysql') {
    const mysql = await import('mysql2/promise');

    // ADR-064: Decrypt password for actual connection
    const dbPassword = getDecryptedPassword(dataSource);
    const connection = await mysql.createConnection({
      host: dataSource.db_host,
      port: dataSource.db_port,
      database: dataSource.db_name,
      user: dataSource.db_username,
      password: dbPassword
    });

    try {
      // Validate table name - MySQL uses backticks for identifiers
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        throw new Error(`Invalid table name: ${tableName}`);
      }
      const [rows] = await connection.execute(
        `SELECT * FROM \`${tableName}\` WHERE id = ?`,
        [rowId]
      );

      dbLogger.debug({ tableName, rowId }, 'Fetched row from external table');
      return rows.length > 0 ? rows[0] : null;
    } finally {
      await connection.end();
    }
  }

  throw new Error(`Query row by ID not supported for type: ${dataSource.type}`);
}

export {
  listTables,
  listTableColumns,
  queryTable,
  queryRowById,
};
