// backend/database/adapters/DatabaseAdapter.js
// Abstract interface for database operations
// All database-specific adapters must implement this interface

/**
 * @interface DatabaseAdapter
 * Abstract base class for database adapters (PostgreSQL)
 */
export class DatabaseAdapter {
  /**
   * Execute raw SQL query (for migrations, raw operations)
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<{rows: Array, rowCount: number}>}
   */
  async query(sql, params = []) {
    throw new Error('Not implemented');
  }

  /**
   * Get single row
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<Object|null>}
   */
  async get(sql, params = []) {
    throw new Error('Not implemented');
  }

  /**
   * Get all rows
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<Array>}
   */
  async all(sql, params = []) {
    throw new Error('Not implemented');
  }

  /**
   * Execute INSERT/UPDATE/DELETE
   * @param {string} sql
   * @param {Array} params
   * @returns {Promise<{changes: number, lastInsertRowid: number}>}
   */
  async run(sql, params = []) {
    throw new Error('Not implemented');
  }

  /**
   * Execute multiple statements in transaction
   * @param {Function} callback - async function receiving transaction
   * @returns {Promise<any>}
   */
  async transaction(callback) {
    throw new Error('Not implemented');
  }

  /**
   * Check if connection is alive
   * @returns {Promise<boolean>}
   */
  async ping() {
    throw new Error('Not implemented');
  }

  /**
   * Close connection
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('Not implemented');
  }

  /**
   * Get Knex instance for advanced queries
   * @returns {Knex}
   */
  getKnex() {
    throw new Error('Not implemented');
  }
}

export default DatabaseAdapter;
