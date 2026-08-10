// backend/utils/sqlSanitizer.js
// SEC-001: SQL Injection Prevention - ADR-015
// Created: 2026-01-08

/**
 * Whitelist of allowed table names in the system
 * Add new tables here when schema changes
 */
export const ALLOWED_TABLES = new Set([
  // Core
  'users',
  'spaces', 
  'projects',
  'dashboards',
  
  // Tables system
  'universal_tables',
  'table_columns',
  'table_rows',
  
  // Widgets
  'widgets',
  
  // Auth & Security
  'api_keys',
  
  // Webhooks
  'webhooks',
  'webhook_logs',
  
  // Files
  'files',
  'folders',
  
  // Chat
  'chat_threads',
  'chat_participants', 
  'chat_messages',
  
  // System
  'audit_log',
  'system_settings',
  'user_settings',
  
  // Data Sources
  'data_sources',
  'sync_logs',
  
  // Schema
  'schema_layouts',
  
  // Monitoring
  'monitoring_runs',
  'monitoring_events',
  
  // AI System
  'ai_operators',
  'ai_tools',
  'ai_tool_groups',
  'ai_operator_tool_bindings',
  
  // Integrations
  'neometal_products',
  'neometal_categories',
  'neometal_sync_logs'
]);

/**
 * Validate table name against whitelist
 * @param {string} tableName - Table name to validate
 * @returns {string} - Validated table name
 * @throws {Error} - If table name is not in whitelist
 */
export function validateTableName(tableName) {
  if (!tableName || typeof tableName !== 'string') {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  
  return tableName;
}

/**
 * Check if identifier is valid (letters, numbers, underscore, starts with letter/_)
 * @param {string} identifier
 * @returns {boolean}
 */
function isValidIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') return false;
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier);
}

/**
 * Escape identifier for safe use in SQL
 * Wraps in double quotes and escapes embedded quotes
 * @param {string} identifier - Column or alias name
 * @returns {string} - Safely escaped identifier
 * @throws {Error} - If identifier contains dangerous characters
 */
export function escapeIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  
  // Check for dangerous characters (except double quote which we escape)
  // Reject: semicolon, single quote, double dash (--), slash-star (/*)
  if (/[;']|--|\*\/|\/\*/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  
  // Must start with letter or underscore (SQL standard)
  if (!/^[a-zA-Z_]/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  
  // Escape double quotes by doubling them (SQL standard)
  const escaped = identifier.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Build a safe WHERE clause from filters
 * Only allows whitelisted fields and uses parameterized queries
 * @param {Object} filters - Key-value pairs for filtering
 * @param {string[]} allowedFields - Whitelist of allowed field names
 * @returns {{ clause: string, params: any[] }}
 */
export function buildWhereClause(filters, allowedFields) {
  if (!filters || typeof filters !== 'object') {
    return { clause: '', params: [] };
  }
  
  const allowedSet = new Set(allowedFields);
  const conditions = [];
  const params = [];
  
  for (const [key, value] of Object.entries(filters)) {
    if (allowedSet.has(key) && value !== undefined && value !== null) {
      conditions.push(`${escapeIdentifier(key)} = ?`);
      params.push(value);
    }
  }
  
  if (conditions.length === 0) {
    return { clause: '', params: [] };
  }
  
  return {
    clause: `WHERE ${conditions.join(' AND ')}`,
    params
  };
}

/**
 * Build IN clause with proper parameter placeholders
 * @param {string} column - Column name
 * @param {any[]} values - Array of values
 * @returns {{ clause: string, params: any[] }}
 * @throws {Error} - If values is not a non-empty array
 */
export function buildInClause(column, values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Values must be a non-empty array');
  }
  
  const escapedColumn = escapeIdentifier(column);
  const placeholders = values.map(() => '?').join(', ');
  
  return {
    clause: `${escapedColumn} IN (${placeholders})`,
    params: [...values]
  };
}

/**
 * Build ORDER BY clause safely
 * @param {string} column - Column name
 * @param {'ASC' | 'DESC'} direction - Sort direction
 * @param {string[]} allowedColumns - Whitelist of sortable columns
 * @returns {string} - Safe ORDER BY clause or empty string
 */
export function buildOrderByClause(column, direction, allowedColumns) {
  if (!column || !allowedColumns.includes(column)) {
    return '';
  }
  
  const dir = direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return `ORDER BY ${escapeIdentifier(column)} ${dir}`;
}

/**
 * Validate and sanitize LIMIT/OFFSET values
 * @param {number|string} limit 
 * @param {number|string} offset 
 * @param {number} maxLimit - Maximum allowed limit (default: 1000)
 * @returns {{ limit: number, offset: number }}
 */
export function sanitizePagination(limit, offset, maxLimit = 1000) {
  let safeLimit = parseInt(limit, 10);
  let safeOffset = parseInt(offset, 10);
  
  if (isNaN(safeLimit) || safeLimit < 1) {
    safeLimit = 50; // Default limit
  }
  if (safeLimit > maxLimit) {
    safeLimit = maxLimit;
  }
  
  if (isNaN(safeOffset) || safeOffset < 0) {
    safeOffset = 0;
  }
  
  return { limit: safeLimit, offset: safeOffset };
}
