/**
 * space/variables.js — Space Variables management (ADR-026)
 *
 * Extracted from SpaceService.js.
 * Handles getSpaceVariables, recalculateSpaceVariables.
 */

import { dbRun, dbGet, dbAll, safeJsonParse } from '../../database/connection.js';

/**
 * Get Variables table ID for a space (ADR-026)
 * @param {number} spaceId - Space ID
 * @returns {Promise<number|null>} Variables table ID or null
 */
async function getVariablesTableId(spaceId) {
  // Find System Data project
  const systemProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [spaceId]
  );

  if (!systemProject) {
    return null;
  }

  // Find Variables table in System Data project
  const variablesTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'Variables'",
    [systemProject.id]
  );

  return variablesTable?.id || null;
}

/**
 * Get all variables for a space (ADR-026)
 * Shortcut API that returns variables from Universal Table
 * @param {number} spaceId - Space ID
 * @returns {Promise<{tableId: number|null, variables: Array}>}
 */
export async function getSpaceVariables(spaceId) {
  const tableId = await getVariablesTableId(spaceId);

  if (!tableId) {
    return { tableId: null, variables: [] };
  }

  // Get all variable rows from the table
  const rows = await dbAll(
    'SELECT id, data FROM table_rows WHERE table_id = ?',
    [tableId]
  );

  // Transform to API format
  const variables = rows.map(row => {
    const data = safeJsonParse(row.data) || {};
    return {
      id: row.id,
      name: data.name,
      value: data.cached_value,
      scope: data.scope_type,
      scopeRef: data.scope_ref || null,
      formula: data.formula,
      description: data.description,
      streamId: data.stream_id
    };
  });

  return { tableId, variables };
}

/**
 * Recalculate all variables for a space (ADR-026)
 * @param {number} spaceId - Space ID
 * @returns {Promise<{calculated: number, cached: number, errors: Array}>}
 */
export async function recalculateSpaceVariables(spaceId) {
  const tableId = await getVariablesTableId(spaceId);

  if (!tableId) {
    return { calculated: 0, cached: 0, errors: [] };
  }

  // Get all variable rows
  const rows = await dbAll(
    'SELECT id, data FROM table_rows WHERE table_id = ?',
    [tableId]
  );

  let calculated = 0;
  let cached = 0;
  const errors = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    try {
      const data = safeJsonParse(row.data) || {};

      // Simple evaluation for constants and basic math
      // TODO: Full formula engine in Sprint 1
      let newValue = data.formula;

      // Try to evaluate simple numeric formulas
      if (data.formula && /^[\d.\s+\-*/()]+$/.test(data.formula)) {
        try {
          // Safe eval for simple math only
          newValue = String(Function('"use strict"; return (' + data.formula + ')')());
        } catch (evalError) {
          // Keep formula as is if eval fails
          newValue = data.formula;
        }
      }

      // Update cached_value and cached_at
      data.cached_value = newValue;
      data.cached_at = now;

      await dbRun(
        'UPDATE table_rows SET data = ? WHERE id = ?',
        [JSON.stringify(data), row.id]
      );

      calculated++;
    } catch (error) {
      errors.push({ rowId: row.id, error: error.message });
    }
  }

  return { calculated, cached, errors };
}
