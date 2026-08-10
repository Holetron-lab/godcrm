// Database connection wrapper - v0.005.000
// PostgreSQL only (SQLite removed per ADR-149)
import { AdapterFactory } from './adapters/AdapterFactory.js';

/**
 * Check if using PostgreSQL (always true now, kept for backward compat)
 * @returns {boolean}
 */
export function isPostgres() {
  return true;
}

// Export for use in services (backward compat)
export const USE_POSTGRES = true;

/**
 * Convert boolean to database-appropriate value
 * @param {boolean} value - Boolean value
 * @returns {number} - 1 for true, 0 for false
 */
export function toBool(value) {
  return value ? 1 : 0;
}

/**
 * Safely parse JSON - handles both string and object
 * PostgreSQL returns JSON columns as objects, but some columns store as strings
 * @param {string|object|null} value - Value to parse
 * @param {*} [defaultValue=null] - Value to return when parsing fails or value is null/undefined
 * @returns {object|null} - Parsed value or defaultValue
 */
export function safeJsonParse(value, defaultValue = null) {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}

/**
 * Get SQL expression for current timestamp
 * @returns {string} - SQL expression
 */
export function sqlNow() {
  return 'NOW()';
}

/**
 * Get SQL literal for TRUE boolean value
 * @returns {string} - SQL literal
 */
export function sqlTrue() {
  return '1';
}

/**
 * Get SQL literal for FALSE boolean value
 * @returns {string} - SQL literal
 */
export function sqlFalse() {
  return '0';
}

// Singleton adapter instance
let adapterInstance = null;
let adapterInitPromise = null;

/**
 * Get adapter instance (singleton with lazy initialization)
 * @returns {Promise<DatabaseAdapter>}
 */
async function getAdapterInstance() {
  if (!adapterInstance) {
    if (!adapterInitPromise) {
      adapterInitPromise = AdapterFactory.getAdapter({
        url: process.env.POSTGRES_URL,
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT,
        database: process.env.POSTGRES_DB,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD
      });
    }
    adapterInstance = await adapterInitPromise;
  }
  return adapterInstance;
}

/**
 * Execute SQL statement (INSERT, UPDATE, DELETE)
 * @param {string} sql - SQL query with ? placeholders
 * @param {Array} params - Query parameters
 * @returns {Promise<RunResult>}
 */
export async function dbRun(sql, params = []) {
  const adapter = await getAdapterInstance();
  const pgSql = convertPlaceholders(sql);
  return adapter.run(pgSql, params);
}

/**
 * Get single row from database
 * @param {string} sql - SQL query with ? placeholders
 * @param {Array} params - Query parameters
 * @returns {Promise<Object|undefined>}
 */
export async function dbGet(sql, params = []) {
  const adapter = await getAdapterInstance();
  const pgSql = convertPlaceholders(sql);
  return adapter.get(pgSql, params);
}

/**
 * Get multiple rows from database
 * @param {string} sql - SQL query with ? placeholders
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>}
 */
export async function dbAll(sql, params = []) {
  const adapter = await getAdapterInstance();
  const pgSql = convertPlaceholders(sql);
  return adapter.all(pgSql, params);
}

/**
 * Convert SQLite-style SQL to PostgreSQL compatible SQL
 * - ? placeholders → $1, $2, ...
 * - datetime('now') → NOW()
 * - json_extract(data, '$.field') → data->>'field'
 * @param {string} sql - SQL with ? placeholders
 * @returns {string} - SQL with PostgreSQL syntax
 */
function convertPlaceholders(sql) {
  let counter = 0;
  let pgSql = sql
    .replace(/\?/g, () => `$${++counter}`)
    .replace(/datetime\('now'\)/gi, 'NOW()')
    .replace(/CURRENT_TIMESTAMP/gi, 'NOW()')
    .replace(/json_extract\s*\(\s*([\w.]+)\s*,\s*'\$\.(\w+)'\s*\)/gi, "$1->>'$2'")
    .replace(/CAST\s*\(\s*([\w.]+)->>'\s*(\w+)\s*'\s*AS\s+INTEGER\s*\)/gi, "($1->>'$2')::integer");

  return pgSql;
}

/**
 * Close database connection
 */
export function closeDatabase() {
  AdapterFactory.destroy();
  adapterInstance = null;
  adapterInitPromise = null;
}

/**
 * Execute callback within a database transaction
 * Provides trx object with run/get/all methods
 * @param {Function} callback - Async function receiving trx { run, get, all }
 * @returns {Promise<any>} - Result from callback
 */
export async function withTransactionAsync(callback) {
  const adapter = await getAdapterInstance();
  return adapter.transaction(callback);
}

/**
 * Get database adapter instance
 * @param {Object} options - Adapter options
 * @returns {Promise<DatabaseAdapter>}
 */
export async function getAdapter(options = {}) {
  return AdapterFactory.getAdapter({
    url: process.env.POSTGRES_URL,
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    memory: process.env.TEST_MODE === 'true',
    ...options
  });
}

/**
 * Destroy adapter instance (for cleanup)
 * @returns {Promise<void>}
 */
export async function destroyAdapter() {
  return AdapterFactory.destroy();
}

/**
 * Reset adapter for testing
 * @param {Object} options
 * @returns {Promise<DatabaseAdapter>}
 */
export async function resetAdapter(options = {}) {
  adapterInstance = null;
  adapterInitPromise = null;
  return AdapterFactory.reset(options);
}

// Re-export AdapterFactory for direct access
export { AdapterFactory } from './adapters/AdapterFactory.js';
