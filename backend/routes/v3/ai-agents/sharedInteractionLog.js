/**
 * Shared interaction logging helper.
 * Logs agent run/chat interactions to the Run Logs table.
 */

import { dbGet, dbRun } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';

/**
 * Log an agent interaction (run or chat) to the Run Logs table.
 */
export async function logInteraction({
  spaceId, agentId, agentName, userId, model, providerName,
  message, responseText, usage, iterations, toolResults,
  agentLoopStartTime
}) {
  try {
    const logsTable = await dbGet(`
      SELECT ut.id FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ? AND (
        ut.name LIKE '%Run Logs%' OR ut.name LIKE '%Message Logs%' OR
        ut.name LIKE '%Chat History%' OR ut.name LIKE '%Logs%'
      )
      ORDER BY CASE
        WHEN ut.name LIKE '%Run Logs%' THEN 1
        WHEN ut.name LIKE '%Chat History%' THEN 2
        ELSE 3
      END LIMIT 1
    `, [spaceId]);

    if (logsTable) {
      const logData = {
        run_id: `run-${Date.now()}`, agent_id: agentId, agent_name: agentName,
        user_id: userId, type: 'agent', model, provider: providerName,
        input_preview: message.substring(0, 500),
        output_preview: responseText.substring(0, 500),
        tokens: usage.total_tokens, tokens_in: usage.prompt_tokens,
        tokens_out: usage.completion_tokens,
        iterations, tool_results: toolResults,
        latency_ms: Date.now() - agentLoopStartTime,
        status: 'success', timestamp: new Date().toISOString()
      };

      await dbRun(`
        INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `, [logsTable.id, `log-${Date.now()}`, JSON.stringify(logData), userId]);
    }
  } catch (logError) {
    apiLogger.warn({ err: logError.message }, 'Failed to log interaction');
  }
}
