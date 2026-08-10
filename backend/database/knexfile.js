// backend/database/knexfile.js
// Knex configuration — PostgreSQL only (ADR-149)
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleMigrationDirs } from '../modules/loader.js'; // MODULE-CONTRACT v1: module schema travels with the module

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Knex configuration — PostgreSQL for all environments
 */
const pgConfig = {
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'godcrm',
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }
  },
  pool: {
    min: 2,
    max: 20,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis: 30000
  },
  migrations: {
    // Core migrations + any present module's own migration dir. Knex sorts across
    // all dirs by filename, so a module's NNN_*.js interleaves in global order.
    directory: [path.join(__dirname, 'migrations/knex'), ...moduleMigrationDirs()],
    tableName: 'knex_migrations'
  },
  seeds: {
    directory: path.join(__dirname, 'seeds')
  }
};

const config = {
  development: pgConfig,
  test: pgConfig,
  production: pgConfig
};

/**
 * Get configuration for specific environment
 * @param {string} env - Environment name (development, test, production)
 * @returns {Object} Knex configuration
 */
function getConfig(env) {
  const environment = env || process.env.NODE_ENV || 'development';
  return config[environment] || config.production;
}

// Export both the config object and helper function
export default {
  ...config,
  getConfig
};

// Named exports for ESM compatibility
export { config, getConfig };
