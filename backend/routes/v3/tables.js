/**
 * @swagger
 * tags:
 *   - name: Tables
 *     description: Universal tables management
 */

// API v3: Tables Routes
// Re-exports the router from tables/index.js after refactoring into smaller modules.
// Original monolithic file preserved at tables.js.backup

export { default } from './tables/index.js';
