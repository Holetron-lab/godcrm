/**
 * Auto-respond decision logic and default agent resolution.
 * Extracted from chatAgentAutoRespond.js to keep files under 400 lines.
 */

import {
  dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
} from './chatShared.js';
import { getAgentTableIds } from '../../../services/agentTableResolver.js';

/**
 * ADR-078: Determine if AI should auto-respond based on participant count.
 */
async function shouldAutoRespondWithAI(conversationId, senderId) {
  try {
    const conversation = await dbGet(
      isPostgres()
        ? `SELECT sub_agents FROM conversations WHERE id = $1`
        : `SELECT sub_agents FROM conversations WHERE id = ?`,
      [conversationId]
    );

    const subAgents = safeJsonParse(conversation?.sub_agents, []);
    if (Array.isArray(subAgents) && subAgents.length > 0) {
      let allSilent = true;
      for (const sa of subAgents) {
        const rowId = typeof sa === 'object' ? sa.row_id : sa;
        if (rowId) {
          const agentRow = await dbGet(
            isPostgres()
              ? `SELECT data FROM table_rows WHERE id = $1`
              : `SELECT data FROM table_rows WHERE id = ?`,
            [rowId]
          );
          const agentConfig = safeJsonParse(agentRow?.data, {});
          if (agentConfig.group_chat_behavior !== 'silent') {
            allSilent = false;
            break;
          }
        } else {
          allSilent = false;
          break;
        }
      }

      if (allSilent) {
        apiLogger.debug({ conversationId, senderId, subAgentsCount: subAgents.length },
          'Ticket #40735: All sub-agents have group_chat_behavior=silent, auto-respond disabled');
        return false;
      }

      apiLogger.debug({ conversationId, senderId, subAgentsCount: subAgents.length, mode: 'sub_agents' },
        'Ticket #41053: Sub-agents present, auto-respond enabled');
      return true;
    }

    const agentParticipantCheck = await dbGet(
      isPostgres()
        ? `SELECT COUNT(*) as count
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = $1
             AND u.user_type = 'agent'`
        : `SELECT COUNT(*) as count
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = ?
             AND u.user_type = 'agent'`,
      [conversationId]
    );
    const agentCount = parseInt(agentParticipantCheck?.count || '0');

    if (agentCount === 0) {
      apiLogger.debug({ conversationId, senderId, agentCount: 0 },
        'Ticket #42500: No agents in conversation — human-only chat, skip auto-respond');
      return false;
    }

    const result = await dbGet(
      isPostgres()
        ? `SELECT COUNT(*) as count
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = $1
             AND cp.user_id != $2
             AND u.user_type != 'agent'`
        : `SELECT COUNT(*) as count
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = ?
             AND cp.user_id != ?
             AND u.user_type != 'agent'`,
      [conversationId, senderId]
    );

    const otherHumans = parseInt(result?.count || '0');
    const isSoloMode = otherHumans === 0;

    apiLogger.debug({ conversationId, senderId, otherHumans, agentCount, mode: isSoloMode ? 'solo' : 'group' },
      'ADR-078: Auto-respond decision');

    return isSoloMode;
  } catch (err) {
    apiLogger.error({ err, conversationId }, 'Error checking auto-respond mode');
    return false;
  }
}

/**
 * ADR-078: Get the default AI agent for a conversation's space.
 */
async function getDefaultAgentForConversation(conversationId) {
  try {
    const conversation = await dbGet(
      isPostgres()
        ? `SELECT space_id FROM conversations WHERE id = $1`
        : `SELECT space_id FROM conversations WHERE id = ?`,
      [conversationId]
    );

    if (!conversation?.space_id) return null;

    // ADR-164 Phase 3a: resolve this space's agent tables via the marker-aware helper
    // (space scoping now lives in the helper). tableIn is internal integer PKs — safe to inline.
    const agentTableIds = await getAgentTableIds({ spaceId: conversation.space_id });
    if (agentTableIds.length === 0) return null;
    const tableIn = agentTableIds.join(',');

    const aiAgentRows = await dbAll(
      `SELECT tr.id as row_id, tr.data FROM table_rows tr
       WHERE tr.table_id IN (${tableIn})
       LIMIT 10`
    );

    for (const row of aiAgentRows) {
      const agentData = safeJsonParse(row.data, {});
      if (agentData.status === 'active' && agentData.name) {
        return {
          id: null,
          name: agentData.name,
          email: null,
          managed_by_agent_row_id: row.row_id,
          _isAiAgentRow: true,
          _agentConfig: agentData
        };
      }
    }

    return null;
  } catch (err) {
    apiLogger.error({ err, conversationId }, 'Error finding default agent');
    return null;
  }
}

export {
  shouldAutoRespondWithAI,
  getDefaultAgentForConversation,
};
