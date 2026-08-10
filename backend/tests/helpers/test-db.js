// Test Database Helper - v0.003.000
// Provides clean setup/cleanup for test isolation (PostgreSQL via ADR-149)

import { resetAdapter, destroyAdapter, getAdapter } from '../../database/connection.js';

/**
 * Setup test database (call in beforeEach)
 *
 * This function:
 * 1. Resets database adapter (closes old, creates new connection)
 * 2. Ensures clean state for each test
 *
 * @returns {Promise<DatabaseAdapter>} Fresh adapter instance
 */
export async function setupTestDatabase() {
  const adapter = await resetAdapter();
  return adapter;
}

/**
 * Cleanup test database (call in afterEach)
 *
 * Closes the database connection.
 * Next setupTestDatabase() will create fresh connection.
 */
export async function cleanupTestDatabase() {
  await destroyAdapter();
}

/**
 * Get test database connection
 *
 * Use this if you need direct access to db instance in tests.
 * Usually you should use dbGet/dbAll/dbRun from connection.js instead.
 *
 * @returns {Promise<DatabaseAdapter>}
 */
export async function getTestDb() {
  return getAdapter();
}
