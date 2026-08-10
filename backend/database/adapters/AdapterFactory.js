// backend/database/adapters/AdapterFactory.js
// Factory for creating database adapters (PostgreSQL only)
import { PostgresAdapter } from './PostgresAdapter.js';

/**
 * AdapterFactory - Factory for creating and managing database adapters
 * Supports singleton pattern for application-wide database access
 */
export class AdapterFactory {
  static instance = null;

  /**
   * Create new database adapter (does NOT set as singleton)
   * @param {Object} options
   * @param {string} options.connectionString - PostgreSQL connection string
   * @returns {Promise<DatabaseAdapter>}
   */
  static async create(options = {}) {
    const adapter = new PostgresAdapter(options);
    await adapter.initialize();
    return adapter;
  }

  /**
   * Get singleton adapter instance
   * Creates if not exists
   * @param {Object} options
   * @returns {Promise<DatabaseAdapter>}
   */
  static async getAdapter(options = {}) {
    if (!this.instance) {
      this.instance = await this.create(options);
    }
    return this.instance;
  }

  /**
   * Destroy singleton instance
   * Used for tests and cleanup
   */
  static async destroy() {
    if (this.instance) {
      await this.instance.close();
      this.instance = null;
    }
  }

  /**
   * Reset for testing - creates fresh instance
   * @param {Object} options
   * @returns {Promise<DatabaseAdapter>}
   */
  static async reset(options = {}) {
    await this.destroy();
    return this.getAdapter(options);
  }

  /**
   * Check if instance exists
   * @returns {boolean}
   */
  static hasInstance() {
    return this.instance !== null;
  }
}

export default AdapterFactory;
