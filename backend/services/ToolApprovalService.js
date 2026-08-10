/**
 * ToolApprovalService — Ticket #74073: Tool Approval Flow
 *
 * Manages approval gates for dangerous agent tools. When an agent calls a tool
 * that matches a rule in `tool_approval_rules`, execution is paused until a
 * human approves or rejects it (or the timeout expires).
 *
 * Follows the same approval pattern as TerminalService.js (pending → approve/reject).
 *
 * The approval state lives on the `messages` table columns:
 *   - approval_status  ('pending' | 'approved' | 'rejected')
 *   - approved_by      (user ID who approved/rejected)
 *   - approved_at      (timestamp)
 *
 * The `tool_approval_rules` table configures which tools need approval,
 * risk levels, per-agent auto-approve lists, and timeouts.
 */

import { dbRun, dbGet, dbAll } from '../database/connection.js';
import { logger } from '../utils/logger.js';

// ─── Glob-style Pattern Matching ────────────────────────────────────────────

/**
 * Match a tool name against a glob pattern (supports * and ?).
 * @param {string} toolName - e.g. 'delete_row'
 * @param {string} pattern - e.g. 'delete_*', 'mcp__*'
 * @returns {boolean}
 */
function matchGlob(toolName, pattern) {
  if (!pattern) return false;
  // Escape regex special chars except * and ?
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`).test(toolName);
}

// ─── Rule Caching ───────────────────────────────────────────────────────────

/** @type {Array|null} */
let _rulesCache = null;
/** @type {number} */
let _rulesCacheTs = 0;
const RULES_CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Load rules from database, using a short-lived cache to avoid
 * hitting the DB on every single tool call in a loop.
 * @returns {Promise<Array>}
 */
async function loadRules() {
  const now = Date.now();
  if (_rulesCache && (now - _rulesCacheTs) < RULES_CACHE_TTL_MS) {
    return _rulesCache;
  }
  try {
    _rulesCache = await dbAll('SELECT * FROM tool_approval_rules ORDER BY id ASC', []);
    _rulesCacheTs = now;
    return _rulesCache;
  } catch (err) {
    logger.error({ err: err.message }, 'ToolApprovalService: Failed to load approval rules');
    return _rulesCache || [];
  }
}

/** Invalidate the rules cache (after insert/update or in tests). */
export function invalidateRulesCache() {
  _rulesCache = null;
  _rulesCacheTs = 0;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Check whether a tool requires human approval before execution.
 *
 * Matching priority:
 *   1. Exact `tool_name` match
 *   2. Glob `tool_pattern` match
 *   3. Wildcard '*' rule (catch-all)
 *
 * If the agent's ID is in `auto_approve_for_agent_ids`, skip approval.
 *
 * @param {string} toolName
 * @param {number|null} agentId - The agent row ID executing the tool
 * @returns {Promise<boolean>}
 */
export async function requiresApproval(toolName, agentId) {
  try {
    const rules = await loadRules();

    // Find matching rule: exact name → glob pattern → wildcard '*'
    let matchedRule = null;

    for (const rule of rules) {
      // Exact match on tool_name
      if (rule.tool_name === toolName) {
        matchedRule = rule;
        break;
      }
    }

    if (!matchedRule) {
      for (const rule of rules) {
        // Glob pattern match
        if (rule.tool_pattern && matchGlob(toolName, rule.tool_pattern)) {
          matchedRule = rule;
          break;
        }
      }
    }

    if (!matchedRule) {
      for (const rule of rules) {
        // Wildcard catch-all
        if (rule.tool_name === '*') {
          matchedRule = rule;
          break;
        }
      }
    }

    if (!matchedRule || !matchedRule.requires_approval) {
      return false;
    }

    // Check if the agent is in the auto-approve list
    if (agentId && matchedRule.auto_approve_for_agent_ids) {
      let agentIds = matchedRule.auto_approve_for_agent_ids;
      // May be stored as JSON string — parse safely
      if (typeof agentIds === 'string') {
        try { agentIds = JSON.parse(agentIds); } catch { agentIds = []; }
      }
      if (Array.isArray(agentIds) && agentIds.includes(agentId)) {
        return false;
      }
    }

    return true;
  } catch (err) {
    logger.error({ err: err.message, toolName, agentId }, 'ToolApprovalService: Error checking approval requirement');
    // Fail-open: if we can't check rules, don't block execution
    return false;
  }
}

/**
 * Get the timeout (in seconds) for a tool's approval from the matching rule.
 * @param {string} toolName
 * @returns {Promise<number>} Timeout in seconds (default 300)
 */
export async function getTimeoutForTool(toolName) {
  try {
    const rules = await loadRules();
    for (const rule of rules) {
      if (rule.tool_name === toolName || (rule.tool_pattern && matchGlob(toolName, rule.tool_pattern))) {
        return rule.timeout_seconds || 300;
      }
    }
    return 300;
  } catch {
    return 300;
  }
}

/**
 * Create an approval request by updating the tool_call message with pending status.
 *
 * @param {number} conversationId
 * @param {number} messageId - ID of the tool_call message
 * @param {string} toolName
 * @param {Object} args - Tool arguments
 * @param {number|null} agentId
 * @returns {Promise<Object>} Updated message record
 */
export async function createApprovalRequest(conversationId, messageId, toolName, args, agentId) {
  try {
    const timeoutSeconds = await getTimeoutForTool(toolName);
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString();

    // Update the tool_call message with approval_status = 'pending'
    await dbRun(
      `UPDATE messages
       SET approval_status = $1,
           metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $3`,
      [
        'pending',
        JSON.stringify({
          approval_status: 'pending',
          approval_tool: toolName,
          approval_args: args,
          approval_agent_id: agentId,
          approval_expires_at: expiresAt,
          timeout_seconds: timeoutSeconds,
        }),
        messageId,
      ]
    );

    logger.info(
      { conversationId, messageId, toolName, agentId, timeoutSeconds },
      'ToolApprovalService: Created approval request'
    );

    const message = await dbGet('SELECT * FROM messages WHERE id = $1', [messageId]);

    return message;
  } catch (err) {
    logger.error(
      { err: err.message, conversationId, messageId, toolName },
      'ToolApprovalService: Failed to create approval request'
    );
    throw err;
  }
}

/**
 * Poll the database waiting for a user to approve or reject the tool execution.
 *
 * Resolves with 'approved', 'rejected', or 'timeout'.
 *
 * @param {number} messageId
 * @param {number} [timeoutMs=300000] - Max wait time in milliseconds (default 5 min)
 * @returns {Promise<'approved'|'rejected'|'timeout'>}
 */
export async function waitForDecision(messageId, timeoutMs = 300_000) {
  const pollIntervalMs = 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const msg = await dbGet('SELECT approval_status FROM messages WHERE id = $1', [messageId]);

      if (msg?.approval_status === 'approved') return 'approved';
      if (msg?.approval_status === 'rejected') return 'rejected';
    } catch (err) {
      logger.error({ err: err.message, messageId }, 'ToolApprovalService: Error polling for decision');
    }

    // Sleep before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout — update the message to reflect this
  try {
    await dbRun(
      `UPDATE messages SET approval_status = $1, updated_at = NOW() WHERE id = $2 AND approval_status = $3`,
      ['rejected', messageId, 'pending']
    );
  } catch {
    // Best-effort timeout cleanup
  }

  logger.warn({ messageId, timeoutMs }, 'ToolApprovalService: Approval timed out');
  return 'timeout';
}

/**
 * Approve a tool execution.
 *
 * @param {number} messageId
 * @param {number} userId - Who approved
 * @param {boolean} [alwaysAllow=false] - If true, create a rule that auto-approves this tool
 * @returns {Promise<Object>} Updated message record
 */
export async function approveToolExecution(messageId, userId, alwaysAllow = false) {
  try {
    const msg = await dbGet('SELECT * FROM messages WHERE id = $1', [messageId]);

    if (!msg) throw new Error(`Message ${messageId} not found`);
    if (msg.approval_status !== 'pending') {
      throw new Error(`Message ${messageId} is not pending approval (status: ${msg.approval_status})`);
    }

    await dbRun(
      `UPDATE messages SET approval_status = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW() WHERE id = $3`,
      ['approved', userId, messageId]
    );

    logger.info({ messageId, userId, alwaysAllow }, 'ToolApprovalService: Tool execution approved');

    // If alwaysAllow, create a rule that marks this tool as not requiring approval
    if (alwaysAllow) {
      // Extract tool name from metadata
      let toolName = null;
      if (msg.metadata) {
        try {
          const meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
          toolName = meta.approval_tool;
        } catch { /* ignore parse errors */ }
      }
      // Fallback: tool_call messages store the tool name in content
      if (!toolName && msg.content_type === 'tool_call') {
        toolName = msg.content;
      }

      if (toolName) {
        // Check if a rule already exists for this tool
        const existing = await dbGet(
          'SELECT id FROM tool_approval_rules WHERE tool_name = $1',
          [toolName]
        );

        if (existing) {
          await dbRun(
            `UPDATE tool_approval_rules SET requires_approval = $1, updated_at = NOW() WHERE id = $2`,
            [false, existing.id]
          );
        } else {
          await dbRun(
            `INSERT INTO tool_approval_rules (tool_name, risk_level, requires_approval, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [toolName, 'safe', false, userId]
          );
        }
        invalidateRulesCache();
        logger.info({ toolName, userId }, 'ToolApprovalService: Created always-allow rule');
      }
    }

    return dbGet('SELECT * FROM messages WHERE id = $1', [messageId]);
  } catch (err) {
    logger.error({ err: err.message, messageId, userId }, 'ToolApprovalService: Failed to approve tool execution');
    throw err;
  }
}

/**
 * Reject a tool execution.
 *
 * @param {number} messageId
 * @param {number} userId - Who rejected
 * @param {string} [reason] - Optional rejection reason
 * @returns {Promise<Object>} Updated message record
 */
export async function rejectToolExecution(messageId, userId, reason) {
  try {
    const msg = await dbGet('SELECT * FROM messages WHERE id = $1', [messageId]);

    if (!msg) throw new Error(`Message ${messageId} not found`);
    if (msg.approval_status !== 'pending') {
      throw new Error(`Message ${messageId} is not pending approval (status: ${msg.approval_status})`);
    }

    // Update approval status
    await dbRun(
      `UPDATE messages SET approval_status = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW() WHERE id = $3`,
      ['rejected', userId, messageId]
    );

    // Store rejection reason in metadata if provided
    if (reason) {
      await dbRun(
        `UPDATE messages
         SET metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ rejection_reason: reason }), messageId]
      );
    }

    logger.info({ messageId, userId, reason }, 'ToolApprovalService: Tool execution rejected');

    return dbGet('SELECT * FROM messages WHERE id = $1', [messageId]);
  } catch (err) {
    logger.error({ err: err.message, messageId, userId }, 'ToolApprovalService: Failed to reject tool execution');
    throw err;
  }
}

/**
 * Get all pending tool approval requests for a conversation.
 *
 * @param {number} conversationId
 * @returns {Promise<Array>} Pending tool_call messages
 */
export async function getPendingApprovals(conversationId) {
  try {
    return await dbAll(
      `SELECT * FROM messages
       WHERE conversation_id = $1
         AND approval_status = $2
         AND content_type = $3
       ORDER BY created_at ASC`,
      [conversationId, 'pending', 'tool_call']
    );
  } catch (err) {
    logger.error({ err: err.message, conversationId }, 'ToolApprovalService: Failed to get pending approvals');
    return [];
  }
}

/**
 * Get all tool approval rules.
 * @returns {Promise<Array>}
 */
export async function getApprovalRules() {
  invalidateRulesCache();
  return loadRules();
}

/**
 * Update a tool approval rule.
 *
 * Allowed fields: tool_name, tool_pattern, risk_level, requires_approval,
 * auto_approve_for_agent_ids, timeout_seconds.
 *
 * @param {number} ruleId
 * @param {Object} updates
 * @returns {Promise<Object>} Updated rule
 */
export async function updateApprovalRule(ruleId, updates) {
  try {
    const rule = await dbGet('SELECT * FROM tool_approval_rules WHERE id = $1', [ruleId]);

    if (!rule) throw new Error(`Approval rule ${ruleId} not found`);

    const allowedFields = [
      'tool_name', 'tool_pattern', 'risk_level', 'requires_approval',
      'auto_approve_for_agent_ids', 'timeout_seconds',
    ];

    const setClauses = [];
    const params = [];
    let paramIdx = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = $${paramIdx++}`);
        params.push(updates[field]);
      }
    }

    if (setClauses.length === 0) {
      return rule;
    }

    // Add updated_at
    setClauses.push(`updated_at = NOW()`);
    params.push(ruleId);
    await dbRun(
      `UPDATE tool_approval_rules SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      params
    );

    invalidateRulesCache();

    logger.info({ ruleId, updates }, 'ToolApprovalService: Updated approval rule');

    return dbGet('SELECT * FROM tool_approval_rules WHERE id = $1', [ruleId]);
  } catch (err) {
    logger.error({ err: err.message, ruleId }, 'ToolApprovalService: Failed to update approval rule');
    throw err;
  }
}
