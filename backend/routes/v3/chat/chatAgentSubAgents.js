/**
 * Sub-agent validation, enrichment, auto-join, and message agent info resolution.
 * Extracted from chatAgentHelpers.js to keep files under 400 lines.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
} from './chatShared.js';
import { getAgentTableIds } from '../../../services/agentTableResolver.js';

/**
 * Ticket #41053: Validate sub_agents row_ids against the AI Agents table.
 */
async function validateSubAgentRowIds(rowIds) {
  if (!Array.isArray(rowIds) || rowIds.length === 0) return [];

  const ids = rowIds.map(item => typeof item === 'object' ? item.row_id : item).filter(id => typeof id === 'number' && id > 0);
  if (ids.length === 0) return [];

  // ADR-164 Phase 3a: agent tables resolved via the canonical marker-aware helper
  // instead of the `ut.name='AI Agents'` literal. tableIn is internal integer PKs — safe to inline.
  const agentTableIds = await getAgentTableIds();
  if (agentTableIds.length === 0) return [];
  const tableIn = agentTableIds.join(',');

  const placeholders = isPostgres()
    ? ids.map((_, i) => `$${i + 1}`).join(',')
    : ids.map(() => '?').join(',');

  const rows = await dbAll(
    `SELECT tr.id as row_id FROM table_rows tr
     WHERE tr.table_id IN (${tableIn}) AND tr.id IN (${placeholders})`,
    ids
  );

  const validIds = new Set(rows.map(r => r.row_id));
  return ids.filter(id => validIds.has(id));
}

/**
 * Ticket #41053: Enrich sub_agents row_ids with agent name/icon from AI Agents table.
 */
async function enrichSubAgents(subAgents) {
  if (!Array.isArray(subAgents) || subAgents.length === 0) return [];

  const ids = subAgents.map(item => typeof item === 'object' ? item.row_id : item).filter(id => typeof id === 'number' && id > 0);
  if (ids.length === 0) return [];

  // ADR-164 Phase 3a: marker-aware agent-table resolve. tableIn is internal integer PKs — safe to inline.
  // No early return on an empty set: the original ran the query and fell through to the
  // fallback map below, so we mirror that (rows = []) to keep behaviour byte-identical.
  const agentTableIds = await getAgentTableIds();

  const placeholders = isPostgres()
    ? ids.map((_, i) => `$${i + 1}`).join(',')
    : ids.map(() => '?').join(',');

  const rows = agentTableIds.length === 0 ? [] : await dbAll(
    `SELECT tr.id as row_id, tr.data FROM table_rows tr
     WHERE tr.table_id IN (${agentTableIds.join(',')}) AND tr.id IN (${placeholders})`,
    ids
  );

  const rowMap = {};
  for (const row of rows) {
    const data = safeJsonParse(row.data, {});
    rowMap[row.row_id] = {
      row_id: row.row_id,
      name: data.name || 'Unknown Agent',
      icon: data.icon || data.emoji || null,
      color: data.color || null,
      response_mode: data.response_mode || 'mention_only'
    };
  }

  return subAgents.map(item => {
    const rowId = typeof item === 'object' ? item.row_id : item;
    const base = rowMap[rowId];
    if (!base) return null;
    if (typeof item === 'object' && item.response_mode) {
      return { ...base, response_mode: item.response_mode };
    }
    return base;
  }).filter(Boolean);
}

/**
 * ADR-091 / Ticket #41157: Auto-join agent as conversation participant.
 */
async function autoJoinAgentToConversation(conversationId, agentUserId, options = {}) {
  const { response_mode = null, source = null } = options;
  try {
    if (!conversationId || !agentUserId) return false;

    // ADR-0057 Option 2 (2026-05-12): /-invocations are ephemeral — the agent
    // executes against the chat but does NOT become a participant. Membership
    // is reserved for @-mentions and explicit creation/delegation.
    if (source === 'command') {
      apiLogger.debug({ conversationId, agentUserId }, 'ADR-0057: skipping auto-join for /command (ephemeral invocation)');
      return false;
    }

    if (isPostgres()) {
      await dbRun(`
        INSERT INTO conversation_participants (conversation_id, user_id, role, user_type, agent_response_mode, joined_at)
        VALUES ($1, $2, 'member', 'agent', $3, NOW())
        ON CONFLICT (conversation_id, user_id) DO UPDATE SET agent_response_mode = COALESCE(EXCLUDED.agent_response_mode, conversation_participants.agent_response_mode)
      `, [conversationId, agentUserId, response_mode]);
    } else {
      await dbRun(`
        INSERT OR REPLACE INTO conversation_participants (conversation_id, user_id, role, user_type, agent_response_mode, joined_at)
        VALUES (?, ?, 'member', 'agent', ?, datetime('now'))
      `, [conversationId, agentUserId, response_mode]);
    }

    apiLogger.info({ conversationId, agentUserId, response_mode }, 'ADR-091: Agent auto-joined conversation');
    return true;
  } catch (err) {
    apiLogger.error({ err, conversationId, agentUserId }, 'ADR-091: Error auto-joining agent');
    return false;
  }
}

/**
 * Ticket #41055: Resolve agent info (name, icon) for all agent messages.
 */
async function resolveAgentInfoForMessages(messages) {
  const agentIdsToLookup = new Set();

  for (const m of messages) {
    const meta = m.metadata ? (typeof m.metadata === 'string' ? safeJsonParse(m.metadata, {}) : m.metadata) : {};
    if (meta.agent_name) continue;
    if (m.sender_name && m.sender_user_type === 'agent') continue;
    if (m.agent_id) agentIdsToLookup.add(m.agent_id);
  }

  const agentMap = {};
  if (agentIdsToLookup.size > 0) {
    for (const agentId of agentIdsToLookup) {
      try {
        const agentRow = await dbGet(
          isPostgres()
            ? `SELECT tr.id as row_id, tr.data FROM table_rows tr WHERE tr.id = $1`
            : `SELECT tr.id as row_id, tr.data FROM table_rows tr WHERE tr.id = ?`,
          [agentId]
        );
        if (agentRow) {
          const agentData = safeJsonParse(agentRow.data, {});
          agentMap[agentId] = {
            sender_name: agentData.name || 'AI Agent',
            sender_avatar: agentData.icon || agentData.emoji || null,
            color: agentData.color || null
          };
        }
      } catch (err) {
        apiLogger.warn({ err, agentId }, 'Ticket #41055: Failed to resolve agent info from table_rows');
      }
    }
  }

  const agentRowIdsNeedingColor = new Set();
  for (const m of messages) {
    const meta = m.metadata ? (typeof m.metadata === 'string' ? safeJsonParse(m.metadata, {}) : m.metadata) : {};
    if (meta.agent_row_id && !meta.agent_color) {
      agentRowIdsNeedingColor.add(meta.agent_row_id);
    }
  }
  const colorMap = {};
  if (agentRowIdsNeedingColor.size > 0) {
    for (const rowId of agentRowIdsNeedingColor) {
      if (agentMap[rowId]?.color) {
        colorMap[rowId] = agentMap[rowId].color;
        continue;
      }
      try {
        const agentRow = await dbGet(
          isPostgres()
            ? `SELECT tr.data FROM table_rows tr WHERE tr.id = $1`
            : `SELECT tr.data FROM table_rows tr WHERE tr.id = ?`,
          [rowId]
        );
        if (agentRow) {
          const agentData = safeJsonParse(agentRow.data, {});
          colorMap[rowId] = agentData.color || null;
        }
      } catch (err) {
        // Non-fatal — color is cosmetic
      }
    }
  }

  return messages.map(m => {
    const isAgentMessage = m.sender_type === 'agent' || m.role === 'assistant' || m.agent_id;
    if (!isAgentMessage) return m;

    const meta = m.metadata ? (typeof m.metadata === 'string' ? safeJsonParse(m.metadata, {}) : m.metadata) : {};

    const agentName = meta.agent_name || m.sender_name || (m.agent_id && agentMap[m.agent_id]?.sender_name) || null;
    const agentIcon = meta.agent_icon || m.sender_avatar || (m.agent_id && agentMap[m.agent_id]?.sender_avatar) || null;
    const agentColor = meta.agent_color || (meta.agent_row_id && colorMap[meta.agent_row_id]) || (m.agent_id && agentMap[m.agent_id]?.color) || null;

    const enrichedMeta = { ...meta };
    if (agentColor && !enrichedMeta.agent_color) {
      enrichedMeta.agent_color = agentColor;
    }

    return {
      ...m,
      sender_name: agentName || m.sender_name || 'AI Agent',
      sender_avatar: agentIcon || m.sender_avatar || null,
      agent_name: agentName || 'AI Agent',
      agent_icon: agentIcon || null,
      agent_color: agentColor || null,
      metadata: Object.keys(enrichedMeta).length > 0 ? enrichedMeta : undefined,
    };
  });
}

export {
  validateSubAgentRowIds,
  enrichSubAgents,
  autoJoinAgentToConversation,
  resolveAgentInfoForMessages,
};
