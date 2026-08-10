/**
 * agent-loop/status.js — Agent status placeholder management
 *
 * Extracted from AgentLoopService.js (ADR-094).
 * Handles creating, finding, resetting, updating, and finalizing
 * agent status placeholder messages in conversations.
 */

import { dbRun, dbGet } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

/**
 * Create a pre-emptive placeholder message that shows agent working status.
 * This message is created BEFORE the agent starts processing, so the user
 * sees an immediate visual indicator in the chat.
 *
 * @param {number} conversationId
 * @param {Object} opts
 * @param {string} opts.agentName - Display name of the agent
 * @param {string} [opts.agentIcon] - Agent emoji icon
 * @param {string} [opts.agentColor] - Agent hex color
 * @param {number|null} [opts.agentRowId] - Agent row ID
 * @param {number|null} [opts.senderId] - Agent sender_id in users table
 * @returns {Promise<number>} The placeholder message ID
 */
export async function createAgentStatusPlaceholder(conversationId, opts) {
  const {
    agentName = 'AI Agent',
    agentIcon = null,
    agentColor = null,
    agentRowId = null,
    senderId = null,
  } = opts;

  const metadata = JSON.stringify({
    agent_name: agentName,
    agent_icon: agentIcon,
    agent_color: agentColor,
    agent_row_id: agentRowId,
    agent_status: 'starting',
    agent_action: 'Initializing...',
    placeholder: true,
    tools_used: 0,
    tools_completed: 0,
    started_at: new Date().toISOString(),
  });

  // Delete old plan AND agent_status messages BEFORE inserting the new one —
  // prevents showing stale data from a previous agent run.
  try {
    await dbRun(
      `DELETE FROM messages WHERE conversation_id = $1 AND content_type IN ('plan', 'agent_status')`,
      [conversationId]
    );
  } catch (planErr) {
    apiLogger.warn({ err: planErr.message, conversationId }, 'AgentLoopService: Failed to clear old status/plan on new placeholder (non-fatal)');
  }

  const result = await dbRun(
    `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, metadata, created_at, updated_at)
     VALUES ($1, $2, 'agent', 'assistant', '', 'agent_status', $3, $4::jsonb, NOW(), NOW())`,
    [conversationId, senderId, agentRowId, metadata]
  );

  // Update conversation updated_at
  await dbRun(
    'UPDATE conversations SET updated_at = NOW() WHERE id = $1',
    [conversationId]
  );

  apiLogger.info({ conversationId, placeholderId: result.lastInsertRowid, agentName }, 'AgentLoopService: Created agent status placeholder');
  return result.lastInsertRowid;
}

/**
 * Find an existing agent_status placeholder for this agent in this conversation.
 * Used to implement "1 agent = 1 worker per conversation" — reusing the same
 * status bubble instead of creating a new one each time.
 *
 * @param {number} conversationId
 * @param {number} agentRowId - The agent's row ID in the AI Agents table
 * @returns {Promise<{id: number, metadata: Object}|null>} The existing placeholder or null
 */
export async function findExistingAgentStatus(conversationId, agentRowId) {
  if (!conversationId || !agentRowId) return null;

  const row = await dbGet(
    `SELECT id, metadata FROM messages
     WHERE conversation_id = $1 AND content_type = 'agent_status' AND agent_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId, agentRowId]
  );

  if (!row) return null;

  let metadata = row.metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
  }

  return { id: row.id, metadata: metadata || {} };
}

/**
 * Reset an existing agent_status placeholder for reuse (new invocation of same agent).
 * Updates the metadata to reflect a new "starting" state while preserving identity fields.
 *
 * @param {number} messageId - Existing placeholder message ID
 * @param {Object} [extra] - Optional extra metadata to merge (job_id, etc.)
 * @returns {Promise<void>}
 */
export async function resetAgentStatusForReuse(messageId, extra = {}) {
  const now = new Date().toISOString();

  let metadataExpr = 'metadata';
  metadataExpr = `jsonb_set(${metadataExpr}, '{agent_status}', '"starting"'::jsonb)`;
  metadataExpr = `jsonb_set(${metadataExpr}, '{agent_action}', '"Resuming..."'::jsonb)`;
  metadataExpr = `jsonb_set(${metadataExpr}, '{placeholder}', 'true'::jsonb)`;
  metadataExpr = `jsonb_set(${metadataExpr}, '{tools_used}', '0'::jsonb)`;
  metadataExpr = `jsonb_set(${metadataExpr}, '{tools_completed}', '0'::jsonb)`;
  metadataExpr = `jsonb_set(${metadataExpr}, '{started_at}', $1::jsonb)`;
  const params = [JSON.stringify(now)];

  let paramIdx = 2;
  const EXTRA_FIELDS = ['job_id', 'job_db_id', 'terminal_session_id'];
  for (const field of EXTRA_FIELDS) {
    if (extra[field] != null) {
      metadataExpr = `jsonb_set(${metadataExpr}, '{${field}}', $${paramIdx}::jsonb)`;
      params.push(JSON.stringify(extra[field]));
      paramIdx++;
    }
  }

  params.push(messageId);
  await dbRun(
    `UPDATE messages SET metadata = ${metadataExpr}, updated_at = NOW() WHERE id = $${paramIdx}`,
    params
  );

  apiLogger.info({ messageId }, 'AgentLoopService: Reset agent status placeholder for reuse');

  // Also delete the old plan message from this conversation (if any).
  // Without this, the frontend shows the plan from the PREVIOUS agent run
  // until the new run creates its own plan.
  try {
    const statusRow = await dbGet(
      `SELECT conversation_id FROM messages WHERE id = $1`,
      [messageId]
    );
    if (statusRow?.conversation_id) {
      // Delete old plan messages
      await dbRun(
        `DELETE FROM messages WHERE conversation_id = $1 AND content_type = 'plan'`,
        [statusRow.conversation_id]
      );
      // Delete OTHER agents' stale agent_status messages (keep only the current one).
      // Without this, stale statuses from different agents accumulate in the DB,
      // and the frontend's limit=N fetch returns wrong agent's status (highest ID wins).
      await dbRun(
        `DELETE FROM messages WHERE conversation_id = $1 AND content_type = 'agent_status' AND id != $2`,
        [statusRow.conversation_id, messageId]
      );
    }
  } catch (planErr) {
    apiLogger.warn({ err: planErr.message, messageId }, 'AgentLoopService: Failed to clear old plan/stale status (non-fatal)');
  }
}

/**
 * Update the agent status on a placeholder message.
 * Efficiently updates only the metadata JSON fields.
 *
 * @param {number} messageId - Placeholder message ID
 * @param {string} status - 'starting' | 'thinking' | 'tool_call' | 'generating' | 'finished' | 'error'
 * @param {string} action - Human-readable action description
 * @param {Object} [extra] - Optional extra metadata fields (tools_used, tools_completed, etc.)
 */
export async function updateAgentStatus(messageId, status, action, extra = {}) {
  const sets = [];
  const params = [];

  // Arbitrary extra fields that should be stored in metadata (e.g. job_id, terminal_session_id)
  const EXTRA_FIELDS = ['tools_used', 'tools_completed', 'job_id', 'job_db_id', 'terminal_session_id'];

  // PostgreSQL: use jsonb_set chained
  let metadataExpr = 'metadata';
  metadataExpr = `jsonb_set(${metadataExpr}, '{agent_status}', $1::jsonb)`;
  params.push(JSON.stringify(status));
  metadataExpr = `jsonb_set(${metadataExpr}, '{agent_action}', $2::jsonb)`;
  params.push(JSON.stringify(action));

  let paramIdx = 3;
  for (const field of EXTRA_FIELDS) {
    if (extra[field] != null) {
      metadataExpr = `jsonb_set(${metadataExpr}, '{${field}}', $${paramIdx}::jsonb)`;
      params.push(JSON.stringify(extra[field]));
      paramIdx++;
    }
  }
  if (status === 'finished' || status === 'error') {
    metadataExpr = `jsonb_set(${metadataExpr}, '{placeholder}', 'false'::jsonb)`;
  } else {
    // Always ensure placeholder=true for active statuses — prevents race condition
    // where a stale finalizeAgentStatus from a previous job overwrites placeholder
    metadataExpr = `jsonb_set(${metadataExpr}, '{placeholder}', 'true'::jsonb)`;
  }

  params.push(messageId);
  await dbRun(
    `UPDATE messages SET metadata = ${metadataExpr}, updated_at = NOW() WHERE id = $${paramIdx}`,
    params
  );
}

/**
 * Finalize an agent status placeholder: update status to 'finished' and optionally set final content.
 *
 * @param {number} messageId
 * @param {string} [finalContent] - Final text response to set on the placeholder
 */
export async function finalizeAgentStatus(messageId, finalContent) {
  await updateAgentStatus(messageId, 'finished', 'Complete');

  if (finalContent) {
    await dbRun(
      `UPDATE messages SET content = $1, updated_at = NOW() WHERE id = $2`,
      [finalContent, messageId]
    );
  }
}
