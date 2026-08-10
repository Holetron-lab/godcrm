/**
 * monitoring/db-helpers.js
 * Database helpers and SQL compatibility layer for MonitoringService
 */

// SQL syntax helpers for PostgreSQL
export const SQL = {
  autoIncrement: 'SERIAL PRIMARY KEY',
  datetime: 'TIMESTAMP',
  currentTimestamp: 'CURRENT_TIMESTAMP'
};

/**
 * Safely parse JSON
 */
export function tryParseJSON(str) {
  if (!str) return null;
  if (typeof str !== 'string') return str;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
