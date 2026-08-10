/**
 * Table summary variable controller
 * Handles: POST /tables/:tableId/columns/:columnId/summary-variable
 */
import express from 'express';
import { dbAll, dbGet, dbRun, safeJsonParse } from '../../../database/connection.js';
import { generateBaseId } from '../../../utils/baseId.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, notFound, badRequest, error } from '../../../utils/response.js';

const router = express.Router();

/**
 * POST /api/v3/tables/:tableId/columns/:columnId/summary-variable
 * ADR-026: Create a Variable from column summary aggregation
 *
 * Creates a new Variable in the Space's Variables table that stores
 * the result of an aggregation (SUM, AVG, MIN, MAX, COUNT, etc.)
 * The variable can then be referenced in formulas via $variable_name
 */
router.post('/tables/:tableId/columns/:columnId/summary-variable', async (req, res) => {
  try {
    const { tableId, columnId } = req.params;
    const { aggregation, variableName } = req.body;
    const userId = req.user?.id;

    apiLogger.debug({ tableId, columnId, aggregation }, 'Creating summary variable');

    // Validate aggregation type
    const validAggregations = [
      'sum', 'avg', 'min', 'max', 'count',
      'countUnique', 'countEmpty', 'countFilled',
      'checked', 'unchecked', 'percentChecked',
      'earliest', 'latest', 'dateRange', 'percentFilled'
    ];

    if (!aggregation || !validAggregations.includes(aggregation)) {
      return badRequest(res, `Invalid aggregation type. Valid types: ${validAggregations.join(', ')}`);
    }

    // Get table info
    const table = await dbGet(`
      SELECT id, name, display_name, project_id
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    if (!table) {
      return notFound(res, 'Table');
    }

    // Get column info
    const column = await dbGet(`
      SELECT id, name, display_name, type
      FROM table_columns
      WHERE (id = ? OR name = ?) AND table_id = ?
    `, [columnId, columnId, tableId]);

    if (!column) {
      return notFound(res, 'Column');
    }

    // Get space through project
    const projectSpace = await dbGet(`
      SELECT p.id as project_id, s.id as space_id
      FROM projects p
      JOIN spaces s ON s.id = p.space_id
      WHERE p.id = ?
    `, [table.project_id]);

    if (!projectSpace) {
      return notFound(res, 'Space');
    }

    // Get or create Variables table
    let variablesTable = await dbGet(`
      SELECT ut.id
      FROM universal_tables ut
      JOIN projects p ON p.id = ut.project_id
      WHERE p.space_id = ? AND p.type = 'system_data' AND ut.name = 'Variables'
    `, [projectSpace.space_id]);

    if (!variablesTable) {
      // Auto-create Variables table if it doesn't exist
      const systemProject = await dbGet(`
        SELECT id FROM projects
        WHERE space_id = ? AND type = 'system_data'
      `, [projectSpace.space_id]);

      if (systemProject) {
        const now = new Date().toISOString();
        const createResult = await dbRun(`
          INSERT INTO universal_tables (name, display_name, project_id, created_at, updated_at, is_system)
          VALUES ('Variables', 'Variables', ?, ?, ?, 1)
        `, [systemProject.id, now, now]);

        variablesTable = { id: createResult.lastID };
        apiLogger.info({ tableId: variablesTable.id }, 'Auto-created Variables table');
      } else {
        return badRequest(res, 'System Data project not found');
      }
    }

    // Generate formula based on aggregation
    const formulaTemplates = {
      sum: (col) => `SUM({{${col}}})`,
      avg: (col) => `AVG({{${col}}})`,
      min: (col) => `MIN({{${col}}})`,
      max: (col) => `MAX({{${col}}})`,
      count: (col) => `COUNT({{${col}}})`,
      countUnique: (col) => `COUNTUNIQUE({{${col}}})`,
      countEmpty: (col) => `COUNTEMPTY({{${col}}})`,
      countFilled: (col) => `COUNTFILLED({{${col}}})`,
      checked: (col) => `COUNTIF({{${col}}}, true)`,
      unchecked: (col) => `COUNTIF({{${col}}}, false)`,
      percentChecked: (col) => `PERCENTIF({{${col}}}, true)`,
      earliest: (col) => `MIN({{${col}}})`,
      latest: (col) => `MAX({{${col}}})`,
      dateRange: (col) => `DATEDIFF(MAX({{${col}}}), MIN({{${col}}}))`,
      percentFilled: (col) => `PERCENTFILLED({{${col}}})`
    };

    const formula = formulaTemplates[aggregation](column.name);

    // Generate variable name
    let finalName = variableName;
    if (!finalName) {
      finalName = `$${column.name}_${aggregation}`;
    }

    // Check for uniqueness and add suffix if needed
    const existingVars = await dbAll(`
      SELECT data FROM table_rows WHERE table_id = ?
    `, [variablesTable.id]);

    const existingNames = new Set(existingVars.map(v => {
      try {
        const data = safeJsonParse(v.data, {});
        return data.name;
      } catch {
        return null;
      }
    }).filter(Boolean));

    if (existingNames.has(finalName)) {
      let suffix = 1;
      while (existingNames.has(`${finalName}_${suffix}`)) {
        suffix++;
      }
      finalName = `${finalName}_${suffix}`;
    }

    // Create variable row
    const now = new Date().toISOString();
    const variableData = {
      name: finalName,
      scope_type: 'table',
      scope_ref: parseInt(tableId, 10),
      formula: formula,
      description: `${aggregation.toUpperCase()} of ${column.display_name || column.name}`,
      stream_id: 1,
      order_index: 0,
      cached_value: null,
      cached_at: null
    };

    const varBaseId = generateBaseId();
    const result = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [variablesTable.id, varBaseId, JSON.stringify(variableData), userId, now, now]);

    apiLogger.info({
      variableId: result.lastInsertRowid || result.lastID,
      name: finalName,
      tableId,
      columnId
    }, 'Summary variable created');

    created(res, {
      variable: {
        id: result.lastInsertRowid || result.lastID,
        name: finalName,
        formula: formula,
        scope: 'table',
        scopeRef: parseInt(tableId, 10),
        value: null
      }
    });

  } catch (err) {
    apiLogger.error({ err }, 'POST summary-variable error');
    error(res, 'CREATE_VARIABLE_FAILED', err.message, 500);
  }
});

export default router;
