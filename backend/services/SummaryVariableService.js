/**
 * ADR-026: Summary Variable Service
 * 
 * Service for creating Variables from column summary aggregations.
 * Allows exporting SUM, AVG, MIN, MAX, COUNT etc. to reusable Variables
 * that can be referenced in formulas across the space.
 */

import { dbGet, dbRun, dbAll } from '../database/connection.js';
import logger from '../utils/logger.js';
import { generateBaseId } from '../utils/baseId.js';

const serviceLogger = logger.child({ service: 'SummaryVariableService' });

/**
 * Valid aggregation types for summary variables
 */
export const VALID_AGGREGATIONS = [
  'sum', 'avg', 'min', 'max', 'count',
  'countUnique', 'countEmpty', 'countFilled',
  'checked', 'unchecked', 'percentChecked',
  'earliest', 'latest', 'dateRange',
  'percentFilled'
];

/**
 * Formula templates for each aggregation type
 */
export const AGGREGATION_FORMULAS = {
  sum: (colName) => `SUM({{${colName}}})`,
  avg: (colName) => `AVG({{${colName}}})`,
  min: (colName) => `MIN({{${colName}}})`,
  max: (colName) => `MAX({{${colName}}})`,
  count: (colName) => `COUNT({{${colName}}})`,
  countUnique: (colName) => `COUNTUNIQUE({{${colName}}})`,
  countEmpty: (colName) => `COUNTEMPTY({{${colName}}})`,
  countFilled: (colName) => `COUNTFILLED({{${colName}}})`,
  checked: (colName) => `COUNTIF({{${colName}}}, true)`,
  unchecked: (colName) => `COUNTIF({{${colName}}}, false)`,
  percentChecked: (colName) => `PERCENTIF({{${colName}}}, true)`,
  earliest: (colName) => `MIN({{${colName}}})`,
  latest: (colName) => `MAX({{${colName}}})`,
  dateRange: (colName) => `DATEDIFF(MAX({{${colName}}}), MIN({{${colName}}}))`,
  percentFilled: (colName) => `PERCENTFILLED({{${colName}}})`,
};

/**
 * Create a Variable from column summary aggregation
 * 
 * @param {Object} params
 * @param {number} params.tableId - Table ID
 * @param {string} params.columnId - Column ID
 * @param {string} params.aggregation - Aggregation type (sum, avg, min, max, count, etc.)
 * @param {number} params.userId - User ID creating the variable
 * @param {string} [params.variableName] - Optional custom variable name
 * @returns {Promise<{success: boolean, variable: Object}>}
 */
export async function createSummaryVariable({ tableId, columnId, aggregation, userId, variableName }) {
  serviceLogger.debug({ tableId, columnId, aggregation }, 'Creating summary variable');

  // Validate aggregation type
  if (!VALID_AGGREGATIONS.includes(aggregation)) {
    throw new Error(`Invalid aggregation type: ${aggregation}. Valid types: ${VALID_AGGREGATIONS.join(', ')}`);
  }

  // Get table info
  const table = await dbGet(`
    SELECT id, name, display_name, project_id
    FROM universal_tables
    WHERE id = ?
  `, [tableId]);

  if (!table) {
    throw new Error('Table not found');
  }

  // Get column info
  const column = await dbGet(`
    SELECT id, name, display_name, type
    FROM table_columns
    WHERE (id = ? OR name = ?) AND table_id = ?
  `, [columnId, columnId, tableId]);

  if (!column) {
    throw new Error('Column not found');
  }

  // Get space info through project
  const projectSpace = await dbGet(`
    SELECT p.id as project_id, s.id as space_id
    FROM projects p
    JOIN spaces s ON s.id = p.space_id
    WHERE p.id = ?
  `, [table.project_id]);

  if (!projectSpace) {
    throw new Error('Space not found for table');
  }

  // Generate variable name if not provided
  let finalName = variableName;
  if (!finalName) {
    finalName = `$${column.name}_${aggregation}`;
  }

  // Check if name already exists and make unique if needed
  const existingVars = await dbAll(`
    SELECT name FROM table_rows
    WHERE table_id IN (
      SELECT id FROM universal_tables
      WHERE project_id IN (
        SELECT id FROM projects
        WHERE space_id = ? AND type = 'system_data'
      )
      AND name = 'Variables'
    )
  `, [projectSpace.space_id]);

  const existingNames = new Set(existingVars.map(v => {
    try {
      const data = JSON.parse(v.name || '{}');
      return data.name || v.name;
    } catch {
      return v.name;
    }
  }));

  if (existingNames.has(finalName)) {
    // Add suffix to make unique
    let suffix = 1;
    while (existingNames.has(`${finalName}_${suffix}`)) {
      suffix++;
    }
    finalName = `${finalName}_${suffix}`;
  }

  // Generate formula
  const formulaFn = AGGREGATION_FORMULAS[aggregation];
  const formula = formulaFn(column.name);

  // Get Variables table for this space
  const variablesTable = await dbGet(`
    SELECT ut.id
    FROM universal_tables ut
    JOIN projects p ON p.id = ut.project_id
    WHERE p.space_id = ? AND p.type = 'system_data' AND ut.name = 'Variables'
  `, [projectSpace.space_id]);

  if (!variablesTable) {
    throw new Error('Variables table not found. Please create it first via Space Settings.');
  }

  // Create the variable row
  const now = new Date().toISOString();
  const variableData = {
    name: finalName,
    scope_type: 'table',
    scope_ref: tableId,
    formula: formula,
    description: `${aggregation.toUpperCase()} of ${column.display_name || column.name}`,
    stream_id: 1,
    order_index: 0,
    cached_value: null,
    cached_at: null,
  };

  const base_id = generateBaseId();
  const result = await dbRun(`
    INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [variablesTable.id, base_id, JSON.stringify(variableData), userId, now, now]);

  serviceLogger.info({ variableId: result.lastID, name: finalName }, 'Summary variable created');

  return {
    success: true,
    variable: {
      id: result.lastID,
      name: finalName,
      formula: formula,
      scope: 'table',
      scopeRef: tableId,
      value: null, // Will be calculated on next recalculation
    },
  };
}

/**
 * Get all summary variables linked to a column
 */
export async function getColumnLinkedVariables(tableId, columnId) {
  // This would query variables that reference this column in their formula
  // For now, return empty - will be implemented with full variable resolution
  return [];
}

export default {
  createSummaryVariable,
  getColumnLinkedVariables,
  AGGREGATION_FORMULAS,
  VALID_AGGREGATIONS,
};
