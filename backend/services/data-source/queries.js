// data-source/queries.js — External database query operations
import { dbGet, dbAll } from '../../database/connection.js';
import { escapeIdentifier } from '../../utils/sqlSanitizer.js';
import { dbLogger } from '../../utils/logger.js';
import { get } from './crud.js';
import { isMysqlSource, openMysqlConnection } from './mysql.js';

const MYSQL_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** ADR-205: keys per `IN (...)` on the external source. */
const MYSQL_IN_CHUNK = 500;

function assertMysqlIdentifier(tableName) {
  if (!MYSQL_IDENT.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
}

function assertMysqlColumn(columnName) {
  if (!MYSQL_IDENT.test(columnName)) {
    throw new Error(`Invalid column name: ${columnName}`);
  }
}

/**
 * Run `fn(connection)` on the data source's MySQL connection and always close it.
 */
async function withMysql(dataSource, fn) {
  const connection = await openMysqlConnection(dataSource);
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

/**
 * List tables from data source
 * @param {string} id - Data source ID
 * @returns {Promise<Array>} List of tables
 */
async function listTables(id) {
  const dataSource = await get(id);

  if (isMysqlSource(dataSource)) {
    return withMysql(dataSource, async (connection) => {
      const [rows] = await connection.execute('SHOW TABLES');
      const tableKey = `Tables_in_${dataSource.db_name}`;
      return rows.map(row => ({ name: row[tableKey], type: 'table' }));
    });
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

  if (isMysqlSource(dataSource)) {
    assertMysqlIdentifier(tableName);
    return withMysql(dataSource, async (connection) => {
      const [rows] = await connection.execute(`DESCRIBE \`${tableName}\``);
      return rows.map(row => ({ name: row.Field, type: row.Type }));
    });
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

  if (isMysqlSource(dataSource)) {
    assertMysqlIdentifier(tableName);
    return withMysql(dataSource, async (connection) => {
      const [rows] = await connection.execute(
        `SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      dbLogger.debug({ tableName, rowCount: rows.length }, 'Fetched rows from external table');
      return rows;
    });
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

  if (isMysqlSource(dataSource)) {
    assertMysqlIdentifier(tableName);
    return withMysql(dataSource, async (connection) => {
      const [rows] = await connection.execute(
        `SELECT * FROM \`${tableName}\` WHERE id = ?`,
        [rowId]
      );
      dbLogger.debug({ tableName, rowId }, 'Fetched row from external table');
      return rows.length > 0 ? rows[0] : null;
    });
  }

  throw new Error(`Query row by ID not supported for type: ${dataSource.type}`);
}

/**
 * Query rows whose `keyColumn` is one of `keys` (ADR-205 relation lens).
 * Identifiers are asserted/escaped, keys are always bound parameters; MySQL runs
 * one `IN` per MYSQL_IN_CHUNK keys on a single connection.
 * @param {string} id - Data source ID
 * @param {string} tableName - Source table name
 * @param {string} keyColumn - Source column holding the key
 * @param {Array<string|number>} keys
 * @returns {Promise<Array<Object>>} Matching rows as plain objects (order not guaranteed)
 */
async function queryRowsByKeys(id, tableName, keyColumn, keys) {
  if (!keys?.length) return [];
  const dataSource = await get(id);

  if (dataSource.type === 'internal') {
    return dbAll(
      `SELECT * FROM ${escapeIdentifier(tableName)} WHERE ${escapeIdentifier(keyColumn)} IN (${keys.map(() => '?').join(', ')})`,
      keys
    );
  }

  if (isMysqlSource(dataSource)) {
    assertMysqlIdentifier(tableName);
    assertMysqlColumn(keyColumn);
    return withMysql(dataSource, async (connection) => {
      const out = [];
      for (let i = 0; i < keys.length; i += MYSQL_IN_CHUNK) {
        const chunk = keys.slice(i, i + MYSQL_IN_CHUNK);
        const [rows] = await connection.execute(
          `SELECT * FROM \`${tableName}\` WHERE \`${keyColumn}\` IN (${chunk.map(() => '?').join(', ')})`,
          chunk
        );
        out.push(...rows);
      }
      dbLogger.debug({ tableName, keyColumn, keys: keys.length, rowCount: out.length }, 'Fetched rows by keys from external table');
      return out;
    });
  }

  throw new Error(`Query rows by keys not supported for type: ${dataSource.type}`);
}

export {
  MYSQL_IN_CHUNK,
  listTables,
  listTableColumns,
  queryTable,
  queryRowById,
  queryRowsByKeys,
};
