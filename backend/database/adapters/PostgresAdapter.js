// backend/database/adapters/PostgresAdapter.js
// PostgreSQL implementation of DatabaseAdapter using node-postgres (pg)
import pg from 'pg';
import { DatabaseAdapter } from './DatabaseAdapter.js';

const { Pool } = pg;

/**
 * PostgresAdapter - Adapter for PostgreSQL database using node-postgres
 * Implements DatabaseAdapter interface for PostgreSQL-specific operations
 */
export class PostgresAdapter extends DatabaseAdapter {
  constructor(options = {}) {
    super();
    this.pool = null;
    this.options = options;
  }

  /**
   * Convert SQLite-style ? placeholders to PostgreSQL $1, $2, ... format
   * Also handles datetime('now') → NOW() and CURRENT_TIMESTAMP → NOW()
   * @param {string} sql - SQL with ? placeholders
   * @returns {string} - SQL with $N placeholders
   */
  convertPlaceholders(sql) {
    let counter = 0;
    return sql
      .replace(/\?/g, () => `$${++counter}`)
      .replace(/datetime\('now'\)/gi, 'NOW()')
      .replace(/CURRENT_TIMESTAMP/gi, 'NOW()')
      .replace(/json_extract\s*\(\s*([\w.]+)\s*,\s*'\$\.(\w+)'\s*\)/gi, "$1->>'$2'")
      .replace(/CAST\s*\(\s*([\w.]+)->>'\s*(\w+)\s*'\s*AS\s+INTEGER\s*\)/gi, "($1->>'$2')::integer");
  }

  /**
   * Initialize database connection pool
   * @returns {Promise<void>}
   */
  async initialize() {
    // Support both 'url' and 'connectionString' options, plus POSTGRES_URL env
    const connString = this.options.connectionString || this.options.url || process.env.POSTGRES_URL;
    
    const connectionConfig = connString 
      ? { connectionString: connString }
      : {
          host: this.options.host || process.env.POSTGRES_HOST || 'localhost',
          port: parseInt(this.options.port || process.env.POSTGRES_PORT || '5432', 10),
          database: this.options.database || process.env.POSTGRES_DB || 'godcrm',
          user: this.options.user || process.env.POSTGRES_USER || 'godcrm',
          password: this.options.password || process.env.POSTGRES_PASSWORD,
          ssl: this.options.ssl !== false ? { rejectUnauthorized: false } : false
        };

    this.pool = new Pool({
      ...connectionConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await this.pool.connect();
    client.release();
  }

  /**
   * Execute raw SQL query
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<{rows: Array, rowCount: number}>}
   */
  async query(sql, params = []) {
    if (!this.pool) await this.initialize();
    const result = await this.pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  }

  /**
   * Get single row
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<Object|null>}
   */
  async get(sql, params = []) {
    if (!this.pool) await this.initialize();
    const result = await this.pool.query(sql, params);
    return result.rows[0] || null;
  }

  /**
   * Get all rows
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<Array>}
   */
  async all(sql, params = []) {
    if (!this.pool) await this.initialize();
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  /**
   * Execute INSERT/UPDATE/DELETE
   * For INSERT, uses RETURNING id to get lastInsertRowid
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<{changes: number, lastInsertRowid: number}>}
   */
  async run(sql, params = []) {
    if (!this.pool) await this.initialize();
    
    // Add RETURNING id for INSERT statements to get last insert id
    const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
    const queryWithReturning = isInsert && !sql.toUpperCase().includes('RETURNING')
      ? sql + ' RETURNING id'
      : sql;
    
    const result = await this.pool.query(queryWithReturning, params);
    return {
      changes: result.rowCount || 0,
      lastInsertRowid: result.rows[0]?.id || 0
    };
  }

  /**
   * Execute multiple statements in transaction
   * @param {Function} callback - async function receiving transaction object
   * @returns {Promise<any>}
   */
  async transaction(callback) {
    if (!this.pool) await this.initialize();
    
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const trx = {
        query: async (sql, params = []) => {
          const pgSql = this.convertPlaceholders(sql);
          const result = await client.query(pgSql, params);
          return { rows: result.rows, rowCount: result.rowCount };
        },
        get: async (sql, params = []) => {
          const pgSql = this.convertPlaceholders(sql);
          const result = await client.query(pgSql, params);
          return result.rows[0] || null;
        },
        all: async (sql, params = []) => {
          const pgSql = this.convertPlaceholders(sql);
          const result = await client.query(pgSql, params);
          return result.rows;
        },
        run: async (sql, params = []) => {
          const pgSql = this.convertPlaceholders(sql);
          const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
          const queryWithReturning = isInsert && !pgSql.toUpperCase().includes('RETURNING')
            ? pgSql + ' RETURNING id'
            : pgSql;

          const result = await client.query(queryWithReturning, params);
          return {
            changes: result.rowCount || 0,
            lastInsertRowid: result.rows[0]?.id || 0
          };
        }
      };
      
      const result = await callback(trx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if connection is alive
   * @returns {Promise<boolean>}
   */
  async ping() {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close connection pool
   * @returns {Promise<void>}
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  /**
   * Get Knex instance for advanced queries
   * Note: Knex integration will be added in future iteration
   * @returns {null}
   */
  getKnex() {
    // Knex integration to be implemented in TASK-KNEX-001
    return null;
  }

  /**
   * Get raw pool instance (for backward compatibility)
   * @deprecated Use adapter methods instead
   * @returns {Pool}
   */
  getRawPool() {
    return this.pool;
  }
}

export default PostgresAdapter;
