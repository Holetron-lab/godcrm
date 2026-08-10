/**
 * SelectValueResolver — resolve select column text values to numeric IDs
 * + validate all column types (number, email, url, phone, date, datetime, checkbox).
 *
 * Extracted from tables.js (ADR-098) so it can be shared across:
 * - POST /rows (create)
 * - PUT /rows/:id (update)
 * - POST /rows/batch-update
 * - POST /rows/import
 */

import { dbAll, dbGet, safeJsonParse } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { validateColumnValue } from './ColumnService.js';

/**
 * Resolve select column values: convert text labels to numeric IDs.
 *
 * For select columns with relation.enabled (e.g., state, priority, type in tickets),
 * looks up the related table to find the matching row ID by name.
 *
 * For select columns with static options, validates against config.options.
 *
 * @param {number|string} tableId - The table being updated
 * @param {object} data - The data object with column values (keys can be column IDs or names)
 * @returns {object} { resolvedData, errors } - data with text values converted to IDs, and any validation errors
 */
export async function resolveSelectValues(tableId, data) {
  if (!data || typeof data !== 'object') return { resolvedData: data, errors: [] };

  // Get all select columns for this table
  const selectColumns = await dbAll(`
    SELECT id, column_name, type, config
    FROM table_columns
    WHERE table_id = ? AND type IN ('select', 'multi_select')
  `, [tableId]);

  if (selectColumns.length === 0) return { resolvedData: data, errors: [] };

  // Build lookup: column_name → column definition, and column_id → column definition
  const columnLookup = {};
  for (const col of selectColumns) {
    const config = safeJsonParse(col.config) || {};
    const colDef = { ...col, parsedConfig: config };
    columnLookup[col.column_name] = colDef;
    columnLookup[String(col.id)] = colDef;
  }

  const resolvedData = { ...data };
  const errors = [];       // string[] for backward compat
  const rejections = [];   // structured: { column, value, valid_options[] }

  for (const [key, value] of Object.entries(data)) {
    const colDef = columnLookup[key];
    if (!colDef) continue; // Not a select column

    // Skip null/undefined/empty values
    if (value === null || value === undefined || value === '') continue;

    const config = colDef.parsedConfig;

    // Normalize numeric string → number for select columns
    const numericValue = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

    // If value is numeric (number or numeric string), validate it exists for relation-based selects
    if (typeof numericValue === 'number') {
      if (config.relation?.enabled && config.relation?.tableId) {
        const relatedTableId = config.relation.tableId;
        const exists = await dbGet(
          'SELECT id FROM table_rows WHERE table_id = ? AND id = ?',
          [relatedTableId, numericValue]
        );
        if (!exists) {
          const relatedRows = await dbAll(
            'SELECT id, data FROM table_rows WHERE table_id = ?',
            [relatedTableId]
          );
          const validIds = relatedRows.map(r => r.id);
          const validLabels = relatedRows.map(r => {
            const rd = safeJsonParse(r.data) || {};
            return rd[config.relation.labelColumn || 'name'] || `ID:${r.id}`;
          });
          errors.push(`Column "${colDef.column_name}": invalid option ID ${numericValue}. Valid IDs: ${validIds.join(', ')}.`);
          rejections.push({ column: colDef.column_name, value: numericValue, valid_options: validLabels });
          continue;
        }
      }
      resolvedData[key] = numericValue;
      continue;
    }

    // Value is a text string — try to resolve it

    // Case 1: Relation-based select (e.g., state → table 1706 with rows like {name: "backlog"})
    if (config.relation?.enabled && config.relation?.tableId) {
      const relatedTableId = config.relation.tableId;
      const labelColumn = config.relation.labelColumn || 'name';

      // Look up all rows in the related table and find matching label
      const relatedRows = await dbAll(
        'SELECT id, data FROM table_rows WHERE table_id = ?',
        [relatedTableId]
      );

      let matchedId = null;
      const lowerValue = String(value).toLowerCase().trim();

      for (const row of relatedRows) {
        const rowData = safeJsonParse(row.data) || {};
        const label = String(rowData[labelColumn] || '').toLowerCase().trim();
        if (label === lowerValue) {
          matchedId = row.id;
          break;
        }
      }

      if (matchedId !== null) {
        apiLogger.debug({ key, textValue: value, resolvedId: matchedId }, 'Resolved select text to ID');
        resolvedData[key] = matchedId;
      } else {
        const validLabels = relatedRows.map(r => {
          const rd = safeJsonParse(r.data) || {};
          return rd[labelColumn] || `ID:${r.id}`;
        });
        errors.push(`Column "${colDef.column_name}": unknown value "${value}". Valid: ${validLabels.join(', ')}.`);
        rejections.push({ column: colDef.column_name, value, valid_options: validLabels });
      }
      continue;
    }

    // Case 2: Static options (e.g., phase, cycle with config.options[])
    // Options can be plain strings ['owner','admin'] or objects [{label:'Owner',value:'owner'}]
    if (config.options && Array.isArray(config.options)) {
      const lowerValue = String(value).toLowerCase().trim();
      const matched = config.options.find(opt => {
        if (typeof opt === 'string') {
          return opt.toLowerCase().trim() === lowerValue;
        }
        const optLabel = String(opt.label || '').toLowerCase().trim();
        const optValue = String(opt.value || '').toLowerCase().trim();
        return optLabel === lowerValue || optValue === lowerValue;
      });

      if (matched) {
        // Use the option's value (or label if no separate value); plain string returns as-is
        resolvedData[key] = typeof matched === 'string' ? matched : (matched.value || matched.label);
        apiLogger.debug({ key, textValue: value, resolvedValue: resolvedData[key] }, 'Resolved select option text');
      } else if (!config.allow_custom) {
        const validList = config.options.map(o => typeof o === 'string' ? o : (o.label || o.value));
        errors.push(`Column "${colDef.column_name}": unknown option "${value}". Valid: ${validList.join(', ')}.`);
        rejections.push({ column: colDef.column_name, value, valid_options: validList });
      }
      continue;
    }
  }

  return { resolvedData, errors, rejections };
}

// Column types that we validate (non-select)
const VALIDATED_TYPES = new Set([
  'number', 'email', 'url', 'phone', 'date', 'datetime', 'checkbox'
]);

// Human-readable format hints per type
const TYPE_HINTS = {
  number:   'Must be a numeric value',
  email:    'Must be a valid email (e.g. user@example.com)',
  url:      'Must be a valid URL (e.g. https://example.com)',
  phone:    'Must contain only digits, spaces, +, -, parentheses',
  date:     'Must be a date in YYYY-MM-DD format',
  datetime: 'Must be a datetime in YYYY-MM-DD HH:mm format',
  checkbox: 'Must be a boolean (true/false) or 0/1',
};

/**
 * Validate non-select column values against their declared types.
 *
 * Checks: number, email, url, phone, date, datetime, checkbox.
 * Skips nulls/empty, skips columns not in data, skips select (handled by resolveSelectValues).
 *
 * @param {number|string} tableId
 * @param {object} data - Row data (keys = column names or IDs)
 * @returns {object} { errors: string[], rejections: { column, value, expected_type, hint }[] }
 */
export async function validateAllColumns(tableId, data) {
  if (!data || typeof data !== 'object') return { errors: [], rejections: [] };

  const columns = await dbAll(
    `SELECT id, column_name, type, config FROM table_columns WHERE table_id = ?`,
    [tableId]
  );

  // Build lookup by column_name and by column id (as string)
  const colLookup = {};
  for (const col of columns) {
    const config = safeJsonParse(col.config) || {};
    const def = { ...col, parsedConfig: config };
    colLookup[col.column_name] = def;
    colLookup[String(col.id)] = def;
  }

  const errors = [];
  const rejections = [];

  for (const [key, value] of Object.entries(data)) {
    const colDef = colLookup[key];
    if (!colDef) continue;

    // Skip null/undefined/empty
    if (value === null || value === undefined || value === '') continue;

    const colType = colDef.type;

    // Skip select types — handled by resolveSelectValues
    if (colType === 'select' || colType === 'multi_select' || colType === 'multi-select' || colType === 'multiselect') continue;

    // Only validate types we know how to validate
    if (!VALIDATED_TYPES.has(colType)) continue;

    const column = { type: colType, config: colDef.parsedConfig };
    const isValid = validateColumnValue(column, value);

    if (!isValid) {
      const hint = TYPE_HINTS[colType] || `Must be a valid ${colType}`;
      errors.push(`Column "${colDef.column_name}": invalid ${colType} value "${value}". ${hint}.`);
      rejections.push({
        column: colDef.column_name,
        value,
        expected_type: colType,
        hint,
      });
    }
  }

  return { errors, rejections };
}
