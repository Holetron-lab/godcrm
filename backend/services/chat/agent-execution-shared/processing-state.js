/**
 * ADR-093/113: Processing state management and plan handling.
 *
 * Extracted from agent-execution-shared.js
 */

import { dbGet, dbRun, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';

// ─── setConversationProcessing() ──────────────────────────────

/**
 * ADR-093 D2 / ADR-0057 WP-C: Set or clear the is_processing flag on a conversation.
 *
 * Starting (isProcessing=true):
 *   - is_processing flips to true unconditionally.
 *   - processing_agent_id / _name / _started_at are set only if currently NULL
 *     (COALESCE). The first agent in a multi-agent session keeps the scalar
 *     slot; siblings are reflected via `active_agents` in the messages API.
 *
 * Clearing (isProcessing=false):
 *   - If any OTHER agent_jobs row for this conversation is still in
 *     'pending'/'processing', we leave the scalars alone — at least one agent
 *     is still working. The legacy single-agent UI continues to show the
 *     original owner until everyone is done; the new UI reads `active_agents`.
 *   - Otherwise we NULL the scalars as before.
 *
 * @param {number} conversationId - Conversation ID
 * @param {boolean} isProcessing - true to start, false to clear
 * @param {string|null} agentName - Agent display name (only used when isProcessing=true)
 * @param {number|null} agentRowId - Agent row ID (only used when isProcessing=true)
 */
export async function setConversationProcessing(conversationId, isProcessing, agentName = null, agentRowId = null) {
  try {
    if (isProcessing) {
      await dbRun(
        isPostgres()
          ? `UPDATE conversations
                SET is_processing = true,
                    processing_started_at = COALESCE(processing_started_at, NOW()),
                    processing_agent_id   = COALESCE(processing_agent_id, $2),
                    processing_agent_name = COALESCE(processing_agent_name, $3),
                    updated_at = NOW()
              WHERE id = $1`
          : `UPDATE conversations
                SET is_processing = 1,
                    processing_started_at = COALESCE(processing_started_at, datetime('now')),
                    processing_agent_id   = COALESCE(processing_agent_id, ?),
                    processing_agent_name = COALESCE(processing_agent_name, ?),
                    updated_at = datetime('now')
              WHERE id = ?`,
        isPostgres() ? [conversationId, agentRowId, agentName] : [agentRowId, agentName, conversationId]
      );
      return;
    }

    // ADR-0057 WP-C: scope the clear — only NULL scalars if no sibling job
    // is still pending/processing for this conversation.
    const siblingCountRow = await dbGet(
      isPostgres()
        ? `SELECT COUNT(*)::int AS n
             FROM agent_jobs
            WHERE conversation_id = $1
              AND status IN ('pending', 'processing')`
        : `SELECT COUNT(*) AS n
             FROM agent_jobs
            WHERE conversation_id = ?
              AND status IN ('pending', 'processing')`,
      [conversationId]
    );
    const siblingsStillProcessing = Number(siblingCountRow?.n || 0);

    if (siblingsStillProcessing > 0) {
      // Another agent is still working — bump updated_at but leave processing fields.
      await dbRun(
        isPostgres()
          ? `UPDATE conversations SET updated_at = NOW() WHERE id = $1`
          : `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
        [conversationId]
      );
      return;
    }

    await dbRun(
      isPostgres()
        ? `UPDATE conversations
              SET is_processing = false,
                  processing_started_at = NULL,
                  processing_agent_id = NULL,
                  processing_agent_name = NULL,
                  updated_at = NOW()
            WHERE id = $1`
        : `UPDATE conversations
              SET is_processing = 0,
                  processing_started_at = NULL,
                  processing_agent_id = NULL,
                  processing_agent_name = NULL,
                  updated_at = datetime('now')
            WHERE id = ?`,
      [conversationId]
    );
  } catch (err) {
    apiLogger.error({ err, conversationId, isProcessing }, 'ADR-093/0057: setConversationProcessing failed');
  }
}

// ─── handleManagePlan() ───────────────────────────────────────

/**
 * ADR-113: Shared manage_plan handler.
 *
 * Validates the tasks array, sanitises each task, then (when a conversationId
 * is provided) upserts a plan message in the conversation.  If a plan message
 * (content_type = 'plan') already exists for the conversation, it is updated
 * in place.  Otherwise a new message row is inserted.
 *
 * When called without a conversationId the function performs validation only
 * and returns the progress summary without touching the database.
 *
 * Both AgentToolsService.executeTool() and AgentLoopService inline handlers
 * delegate to this single implementation to avoid duplication.
 *
 * @param {Object|null|undefined} args - Tool arguments ({ tasks: Array })
 * @param {number|null} conversationId - Current conversation ID (null = validation-only)
 * @param {string} agentName - Name of the calling agent
 * @param {Object} [options] - Optional extra context
 * @param {number|null} [options.agentId] - Agent user/row ID
 * @returns {Promise<string|{error: string}>} Human-readable progress string, or error object
 */
export async function handleManagePlan(args, conversationId, agentName, options = {}) {
  const { tasks } = args || {};

  // ── Validate input ──
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { error: 'tasks must be a non-empty array' };
  }
  if (tasks.length > 20) {
    return { error: 'Maximum 20 tasks allowed in a plan' };
  }

  const validStatuses = ['pending', 'in_progress', 'completed', 'blocked'];
  const validatedTasks = [];

  for (const task of tasks) {
    if (typeof task.id !== 'number') {
      return { error: `Task id must be a number. Got: ${JSON.stringify(task.id)}` };
    }
    if (typeof task.title !== 'string' || !task.title.trim()) {
      return { error: `Task title must be a non-empty string. Task id=${task.id}` };
    }
    if (!validStatuses.includes(task.status)) {
      return {
        error: `Invalid status "${task.status}" for task ${task.id}. Must be one of: ${validStatuses.join(', ')}`
      };
    }
    validatedTasks.push({
      id: task.id,
      title: task.title.trim(),
      status: task.status,
      ...(task.note ? { note: String(task.note) } : {})
    });
  }

  // ── Compute progress summary ──
  const completed = validatedTasks.filter(t => t.status === 'completed').length;
  const inProgress = validatedTasks.filter(t => t.status === 'in_progress').length;
  const pending = validatedTasks.filter(t => t.status === 'pending').length;
  const blocked = validatedTasks.filter(t => t.status === 'blocked').length;
  const total = validatedTasks.length;

  // ── Persist to DB when conversationId is available ──
  if (conversationId) {
    const { agentId = null } = options;

    const contentJson = JSON.stringify({ tasks: validatedTasks });
    const metadataJson = JSON.stringify({
      agent: agentName,
      tool: 'manage_plan',
      version: 1,
      updated_at: new Date().toISOString()
    });

    const pg = isPostgres();

    // Check for existing plan message in this conversation
    const existingPlan = await dbGet(
      pg
        ? `SELECT id FROM messages WHERE conversation_id = $1 AND content_type = 'plan' ORDER BY id DESC LIMIT 1`
        : `SELECT id FROM messages WHERE conversation_id = ? AND content_type = 'plan' ORDER BY id DESC LIMIT 1`,
      [conversationId]
    );

    if (existingPlan) {
      // UPDATE existing plan in-place — frontend polls for plan updates via content_type check
      await dbRun(
        pg
          ? `UPDATE messages SET content = $1, metadata = $2, updated_at = NOW() WHERE id = $3`
          : `UPDATE messages SET content = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`,
        [contentJson, metadataJson, existingPlan.id]
      );
      apiLogger.info({ planId: existingPlan.id, progress: `${completed}/${total}` }, 'handleManagePlan: plan updated in-place');
    } else {
      // INSERT new plan message
      await dbRun(
        pg
          ? `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, metadata, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`
          : `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, agent_id, metadata, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [conversationId, agentId || null, 'agent', 'tool_result', contentJson, 'plan', agentId || null, metadataJson]
      );
      apiLogger.info({ conversationId, progress: `${completed}/${total}` }, 'handleManagePlan: plan created');
    }
  }

  // ── Build human-readable confirmation ──
  const parts = [];
  if (completed > 0) parts.push(`${completed}/${total} completed`);
  if (inProgress > 0) parts.push(`${inProgress} in progress`);
  if (pending > 0) parts.push(`${pending} pending`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  const summary = parts.length > 0 ? parts.join(', ') : '0 tasks';

  return `Plan updated: ${summary}`;
}
