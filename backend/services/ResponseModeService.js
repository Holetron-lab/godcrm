/**
 * ResponseModeService - Two-Level Response Mode Resolution
 *
 * ADR-091 Phase 2 Task 7 / Ticket #41160 (AC14)
 *
 * Resolves the effective response_mode for an agent in a conversation
 * with the following priority chain:
 *
 *   1. Per-conversation override: conversation_participants.agent_response_mode
 *   2. Sub-agents JSONB override: conversations.sub_agents[].response_mode  (migration period)
 *   3. Global agent config: AI Agents table row data.response_mode
 *   4. Default: 'mention_only'
 *
 * Valid response_mode values:
 *   - 'always'       — agent auto-responds to every message
 *   - 'topic_only'   — agent responds when message is relevant to its domain
 *   - 'mention_only' — agent responds only when explicitly mentioned or /commanded
 */

import { dbGet, safeJsonParse } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { getAgentTableIds } from './agentTableResolver.js';

/** Valid response_mode values */
export const VALID_RESPONSE_MODES = ['always', 'topic_only', 'mention_only'];

/** Default when nothing is configured */
export const DEFAULT_RESPONSE_MODE = 'mention_only';

/**
 * Resolve the effective response_mode for an agent in a specific conversation.
 *
 * @param {number} agentUserId   - The agent's user ID (users.id where user_type='agent')
 * @param {number} conversationId - The conversation ID
 * @returns {Promise<string>} Resolved response_mode: 'always' | 'topic_only' | 'mention_only'
 */
export async function resolveResponseMode(agentUserId, conversationId) {
  if (!agentUserId || !conversationId) {
    return DEFAULT_RESPONSE_MODE;
  }

  try {
    // ----- Priority 1: Per-conversation override (conversation_participants) -----
    const participant = await dbGet(
      `SELECT agent_response_mode FROM conversation_participants
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, agentUserId]
    );

    if (participant?.agent_response_mode && VALID_RESPONSE_MODES.includes(participant.agent_response_mode)) {
      apiLogger.debug({
        agentUserId,
        conversationId,
        resolved: participant.agent_response_mode,
        source: 'conversation_participants'
      }, 'ResponseMode: resolved from per-conversation override');
      return participant.agent_response_mode;
    }

    // ----- Priority 2: Sub-agents JSONB (migration period backward compat) -----
    const agentRowId = await getAgentRowId(agentUserId);

    if (agentRowId) {
      const subAgentMode = await getSubAgentResponseMode(conversationId, agentRowId);
      if (subAgentMode && VALID_RESPONSE_MODES.includes(subAgentMode)) {
        apiLogger.debug({
          agentUserId,
          conversationId,
          agentRowId,
          resolved: subAgentMode,
          source: 'sub_agents_jsonb'
        }, 'ResponseMode: resolved from sub_agents JSONB');
        return subAgentMode;
      }

      // ----- Priority 3: Global agent config (AI Agents table row) -----
      const globalMode = await getGlobalAgentResponseMode(agentRowId);
      if (globalMode && VALID_RESPONSE_MODES.includes(globalMode)) {
        apiLogger.debug({
          agentUserId,
          conversationId,
          agentRowId,
          resolved: globalMode,
          source: 'agent_row_config'
        }, 'ResponseMode: resolved from global agent config');
        return globalMode;
      }
    }

    // ----- Priority 4: Default -----
    apiLogger.debug({
      agentUserId,
      conversationId,
      resolved: DEFAULT_RESPONSE_MODE,
      source: 'default'
    }, 'ResponseMode: using default');

    return DEFAULT_RESPONSE_MODE;
  } catch (err) {
    apiLogger.error({ err, agentUserId, conversationId }, 'ResponseMode: error resolving, falling back to default');
    return DEFAULT_RESPONSE_MODE;
  }
}

/**
 * Resolve response_mode for a sub-agent (identified by row_id, not user_id).
 * Used for agents that don't yet have user accounts (sub_agents JSONB path).
 *
 * @param {number} agentRowId    - The agent's row_id in the AI Agents table
 * @param {number} conversationId - The conversation ID
 * @returns {Promise<string>} Resolved response_mode
 */
export async function resolveResponseModeByRowId(agentRowId, conversationId) {
  if (!agentRowId || !conversationId) {
    return DEFAULT_RESPONSE_MODE;
  }

  try {
    // Try to find a user account for this agent row
    const user = await dbGet(
      `SELECT id FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent' LIMIT 1`,
      [agentRowId]
    );

    if (user?.id) {
      // Has user account — full resolution chain
      return resolveResponseMode(user.id, conversationId);
    }

    // No user account — skip Priority 1, go directly to Priority 2 & 3

    // Priority 2: sub_agents JSONB
    const subAgentMode = await getSubAgentResponseMode(conversationId, agentRowId);
    if (subAgentMode && VALID_RESPONSE_MODES.includes(subAgentMode)) {
      return subAgentMode;
    }

    // Priority 3: Global agent config
    const globalMode = await getGlobalAgentResponseMode(agentRowId);
    if (globalMode && VALID_RESPONSE_MODES.includes(globalMode)) {
      return globalMode;
    }

    return DEFAULT_RESPONSE_MODE;
  } catch (err) {
    apiLogger.error({ err, agentRowId, conversationId }, 'ResponseMode: error resolving by row_id, falling back to default');
    return DEFAULT_RESPONSE_MODE;
  }
}

/**
 * Update the per-conversation response_mode override for an agent.
 *
 * @param {number} agentUserId    - Agent user ID
 * @param {number} conversationId - Conversation ID
 * @param {string|null} mode      - New mode ('always'|'topic_only'|'mention_only') or null to clear override
 * @returns {Promise<boolean>} true if updated successfully
 */
export async function setConversationResponseMode(agentUserId, conversationId, mode) {
  if (!agentUserId || !conversationId) return false;

  // Validate mode
  if (mode !== null && !VALID_RESPONSE_MODES.includes(mode)) {
    throw new Error(`Invalid response_mode "${mode}". Valid: ${VALID_RESPONSE_MODES.join(', ')}`);
  }

  try {
    const result = await dbGet(
      `UPDATE conversation_participants
       SET agent_response_mode = $1
       WHERE conversation_id = $2 AND user_id = $3
       RETURNING id`,
      [mode, conversationId, agentUserId]
    );

    return !!result;
  } catch (err) {
    apiLogger.error({ err, agentUserId, conversationId, mode }, 'ResponseMode: error setting override');
    return false;
  }
}

// =====================================================================
// Internal helpers
// =====================================================================

/**
 * Get the agent's row_id in the AI Agents table from their user ID.
 * @param {number} agentUserId - Agent user ID
 * @returns {Promise<number|null>} Agent row_id or null
 */
async function getAgentRowId(agentUserId) {
  const user = await dbGet(
    `SELECT managed_by_agent_row_id FROM users WHERE id = $1`,
    [agentUserId]
  );
  return user?.managed_by_agent_row_id || null;
}

/**
 * Check sub_agents JSONB for a per-conversation response_mode override.
 * This covers the migration period where sub_agents stores [{row_id, response_mode}].
 *
 * @param {number} conversationId - Conversation ID
 * @param {number} agentRowId     - Agent row_id to look for in sub_agents
 * @returns {Promise<string|null>} response_mode from sub_agents entry or null
 */
async function getSubAgentResponseMode(conversationId, agentRowId) {
  const conversation = await dbGet(
    `SELECT sub_agents FROM conversations WHERE id = $1`,
    [conversationId]
  );

  if (!conversation) return null;

  const subAgents = safeJsonParse(conversation.sub_agents) || [];
  if (!Array.isArray(subAgents) || subAgents.length === 0) return null;

  // Find matching agent entry
  for (const item of subAgents) {
    if (typeof item === 'object' && item !== null) {
      if (item.row_id === agentRowId && item.response_mode) {
        return item.response_mode;
      }
    }
    // Plain number entries have no per-conversation override
  }

  return null;
}

/**
 * Get the global response_mode from the AI Agents table row data.
 *
 * @param {number} agentRowId - Agent's row_id in the AI Agents table
 * @returns {Promise<string|null>} response_mode from agent config or null
 */
async function getGlobalAgentResponseMode(agentRowId) {
  // ADR-164 Phase 3a: marker-aware agent-table resolve. tableIn is internal integer PKs — safe to inline.
  const agentTableIds = await getAgentTableIds();
  if (agentTableIds.length === 0) return null;

  const row = await dbGet(
    `SELECT tr.data FROM table_rows tr
     WHERE tr.table_id IN (${agentTableIds.join(',')}) AND tr.id = $1`,
    [agentRowId]
  );

  if (!row) return null;

  const data = safeJsonParse(row.data) || {};
  return data.response_mode || null;
}

// =====================================================================
// Exports
// =====================================================================

export default {
  resolveResponseMode,
  resolveResponseModeByRowId,
  setConversationResponseMode,
  VALID_RESPONSE_MODES,
  DEFAULT_RESPONSE_MODE,
};
