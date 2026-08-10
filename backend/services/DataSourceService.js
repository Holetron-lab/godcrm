/**
 * DataSourceService — thin wrapper
 *
 * All logic has been split into modules under ./data-source/:
 *   - crud.js    — CRUD operations, validation, decryption
 *   - queries.js — External database query operations
 *   - import.js  — Project creation and external table import
 *   - index.js   — barrel re-export
 *
 * This file re-exports the default class for backward compatibility.
 */

export { default } from './data-source/index.js';
