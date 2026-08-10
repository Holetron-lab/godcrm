/**
 * AgentActivityLogger - Logs agent actions to the Agent Activity table (1701)
 * Ticket #40813: Agent Activity logging for audit trail and monitoring.
 *
 * All logging is fire-and-forget (non-blocking): callers should NOT await
 * the returned promise unless they need the row ID for chaining.
 *
 * Table 1701 columns (column names from API):
 *   agent_id     (select)    - Agent identifier (e.g. "developer-ralph")
 *   task_id      (number)    - Related task/ticket ID
 *   action       (select)    - Action type (task_started, message_sent, etc.)
 *   timestamp    (datetime)  - ISO 8601 timestamp
 *   details      (longtext)  - Free-text details / context
 *   success      (checkbox)  - Whether the action succeeded
 *   duration_ms  (number)    - Duration in milliseconds
 *   tokens_used  (number)    - Token consumption
 *   cost_usd     (number)    - Estimated cost in USD
 *   error_message (text)     - Error message if action failed
 */

import { dbRun, sqlNow } from '../database/connection.js';
import { generateBaseId } from '../utils/baseId.js';
import { aiLogger } from '../utils/logger.js';

/** The universal_tables ID for Agent Activity */
const ACTIVITY_TABLE_ID = 1701;

/**
 * Valid action types matching the select column options in table 1701.
 */
export const ACTION_TYPES = [
  'task_created',
  'task_assigned',
  'task_started',
  'task_completed',
  'task_failed',
  'code_change',
  'test_run',
  'quality_check_passed',
  'quality_check_failed',
  'message_sent',
  'agent_mentioned',
  'error_occurred',
  'retry_attempted',
];

/**
 * Log an agent activity row into table 1701.
 *
 * This function is designed to be fire-and-forget: it catches all errors
 * internally so it never throws and never blocks the caller.
 *
 * @param {Object} entry - Activity entry
 * @param {string} entry.agent_id       - Agent identifier (required)
 * @param {string} entry.action         - Action type from ACTION_TYPES (required)
 * @param {string} [entry.details]      - Free-text details
 * @param {boolean} [entry.success]     - Whether the action succeeded (default true)
 * @param {number} [entry.task_id]      - Related task/ticket ID
 * @param {number} [entry.duration_ms]  - Duration in milliseconds
 * @param {number} [entry.tokens_used]  - Token count
 * @param {number} [entry.cost_usd]     - Cost in USD
 * @param {string} [entry.error_message]- Error message (if failed)
 * @param {string} [entry.conversation_id] - Conversation ID (stored in details)
 * @returns {Promise<number|null>} Inserted row ID or null on failure
 */
export async function logAgentActivity(entry) {
  try {
    if (!entry || !entry.agent_id || !entry.action) {
      aiLogger.warn({ entry }, 'AgentActivityLogger: missing required fields (agent_id, action)');
      return null;
    }

    // Build the data JSON matching table 1701 column names
    const data = {
      agent_id: String(entry.agent_id),
      action: String(entry.action),
      timestamp: new Date().toISOString(),
      success: entry.success !== undefined ? entry.success : true,
    };

    if (entry.details !== undefined) {
      // If conversation_id is passed separately, prepend it to details
      let detailsText = String(entry.details);
      if (entry.conversation_id) {
        detailsText = `[conv:${entry.conversation_id}] ${detailsText}`;
      }
      data.details = detailsText;
    } else if (entry.conversation_id) {
      data.details = `[conv:${entry.conversation_id}]`;
    }

    if (entry.task_id !== undefined) data.task_id = Number(entry.task_id);
    if (entry.duration_ms !== undefined) data.duration_ms = Number(entry.duration_ms);
    if (entry.tokens_used !== undefined) data.tokens_used = Number(entry.tokens_used);
    if (entry.cost_usd !== undefined) data.cost_usd = Number(entry.cost_usd);
    if (entry.error_message !== undefined) data.error_message = String(entry.error_message);

    const baseId = generateBaseId();
    const result = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES (?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
      [ACTIVITY_TABLE_ID, baseId, JSON.stringify(data)]
    );

    const rowId = result?.lastID || result?.lastInsertRowid || null;
    aiLogger.debug(
      { rowId, agent_id: data.agent_id, action: data.action },
      'AgentActivityLogger: row created'
    );
    return rowId;
  } catch (err) {
    // Fire-and-forget: never throw, just log the failure
    aiLogger.error(
      { err, entry },
      'AgentActivityLogger: failed to log activity (non-blocking)'
    );
    return null;
  }
}

/**
 * Convenience: log that an agent started processing a message.
 *
 * @param {string} agentName - Agent name / ID
 * @param {number} conversationId - Conversation ID
 * @param {string} [details] - Additional context
 * @returns {Promise<number|null>}
 */
export function logMessageSent(agentName, conversationId, details) {
  return logAgentActivity({
    agent_id: agentName,
    action: 'message_sent',
    conversation_id: conversationId,
    details: details || 'Agent responded to message',
    success: true,
  });
}

/**
 * Convenience: log that an agent was mentioned in a conversation.
 *
 * @param {string} agentName - Agent name / ID
 * @param {number} conversationId - Conversation ID
 * @param {string} [triggeredBy] - Who mentioned the agent
 * @returns {Promise<number|null>}
 */
export function logAgentMentioned(agentName, conversationId, triggeredBy) {
  return logAgentActivity({
    agent_id: agentName,
    action: 'agent_mentioned',
    conversation_id: conversationId,
    details: triggeredBy ? `Mentioned by user ${triggeredBy}` : 'Agent mentioned',
    success: true,
  });
}

/**
 * Convenience: log that a tool was used by the agent.
 *
 * @param {string} agentName - Agent name / ID
 * @param {string} toolName - Tool that was called
 * @param {number} conversationId - Conversation ID
 * @param {Object} [extra] - { duration_ms, tokens_used, success }
 * @returns {Promise<number|null>}
 */
export function logToolUsed(agentName, toolName, conversationId, extra = {}) {
  return logAgentActivity({
    agent_id: agentName,
    action: 'task_started',
    conversation_id: conversationId,
    details: `Tool used: ${toolName}`,
    success: extra.success !== undefined ? extra.success : true,
    duration_ms: extra.duration_ms,
    tokens_used: extra.tokens_used,
  });
}

/**
 * Convenience: log an error that occurred during agent execution.
 *
 * @param {string} agentName - Agent name / ID
 * @param {number} conversationId - Conversation ID
 * @param {string|Error} err - Error object or message
 * @returns {Promise<number|null>}
 */
export function logAgentError(agentName, conversationId, err) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  return logAgentActivity({
    agent_id: agentName,
    action: 'error_occurred',
    conversation_id: conversationId,
    details: `Error during agent execution`,
    success: false,
    error_message: errorMessage,
  });
}

/**
 * Convenience: log task completion by an agent.
 *
 * @param {string} agentName - Agent name / ID
 * @param {number} conversationId - Conversation ID
 * @param {Object} [extra] - { duration_ms, tokens_used, cost_usd }
 * @returns {Promise<number|null>}
 */
export function logTaskCompleted(agentName, conversationId, extra = {}) {
  return logAgentActivity({
    agent_id: agentName,
    action: 'task_completed',
    conversation_id: conversationId,
    details: 'Agent completed task',
    success: true,
    duration_ms: extra.duration_ms,
    tokens_used: extra.tokens_used,
    cost_usd: extra.cost_usd,
  });
}

export default {
  logAgentActivity,
  logMessageSent,
  logAgentMentioned,
  logToolUsed,
  logAgentError,
  logTaskCompleted,
  ACTION_TYPES,
};
