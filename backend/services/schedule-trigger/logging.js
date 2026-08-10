// schedule-trigger/logging.js — Logging and stats helpers
import crypto from 'crypto';
import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

const LOG_PREFIX = '[ScheduleTrigger]';

/**
 * Find automation tables for a given space ID.
 * Returns { automationsTableId, logsTableId } or null.
 */
async function findAutomationTablesForSpace(spaceId) {
  const systemDataProject = await dbGet(
    "SELECT id FROM projects WHERE space_id = ? AND name = 'System Data'",
    [spaceId]
  );
  if (!systemDataProject) return null;

  const automationsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automations_list'",
    [systemDataProject.id]
  );
  if (!automationsTable) return null;

  const logsTable = await dbGet(
    "SELECT id FROM universal_tables WHERE project_id = ? AND name = 'automation_logs_list'",
    [systemDataProject.id]
  );
  if (!logsTable) return null;

  return {
    automationsTableId: automationsTable.id,
    logsTableId: logsTable.id
  };
}

/**
 * Log an automation execution to the automation_logs_list table.
 */
async function logAutomationExecution(logsTableId, logEntry) {
  try {
    const now = new Date().toISOString();
    const logBaseId = `schedlog_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const logData = {
      automation_id: logEntry.automationId,
      automation_name: logEntry.automationName,
      row_id: logEntry.rowId || null,
      status: logEntry.status,
      trigger_type: 'schedule',
      trigger_data: JSON.stringify(logEntry.triggerData || {}),
      result_data: JSON.stringify(logEntry.resultData || {}),
      error_message: logEntry.errorMessage || null,
      duration_ms: logEntry.durationMs,
      executed_at: now
    };

    await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [logsTableId, logBaseId, JSON.stringify(logData), now, now]
    );
  } catch (err) {
    apiLogger.error({ err, logEntry }, `${LOG_PREFIX} Failed to write automation log`);
  }
}

/**
 * Update automation run_count and last_run timestamp.
 */
async function updateAutomationRunStats(automationRowId, automationData) {
  try {
    const now = new Date().toISOString();
    automationData.run_count = (automationData.run_count || 0) + 1;
    automationData.last_run = now;

    await dbRun(
      'UPDATE table_rows SET data = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(automationData), now, automationRowId]
    );
  } catch (err) {
    apiLogger.error({ err, automationRowId }, `${LOG_PREFIX} Failed to update automation run stats`);
  }
}

export {
  findAutomationTablesForSpace,
  logAutomationExecution,
  updateAutomationRunStats,
};
