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

    // Space-scoped resolution (ADR-078): first active agent in the space's agent
    // tables. Only space conversations have a space_id — Direct/DM chats carry
    // space_id=NULL and fall through to the participant lookup below.
    if (conversation?.space_id) {
      // ADR-164 Phase 3a: resolve this space's agent tables via the marker-aware helper
      // (space scoping now lives in the helper). tableIn is internal integer PKs — safe to inline.
      const agentTableIds = await getAgentTableIds({ spaceId: conversation.space_id });
      if (agentTableIds.length > 0) {
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
      }
    }

    // ADR-185: Direct/DM chats have space_id=NULL, so the space path above finds
    // nothing. Fall back to the conversation's own agent participant — the agent
    // you are chatting with is the natural default/translator. Mirrors the
    // "Source 1" participant lookup in getAutoRespondAgents.
    const participantAgents = await dbAll(
      isPostgres()
        ? `SELECT u.managed_by_agent_row_id AS row_id, u.name
           FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = $1 AND u.user_type = 'agent'
             AND u.managed_by_agent_row_id IS NOT NULL`
        : `SELECT u.managed_by_agent_row_id AS row_id, u.name
           FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = ? AND u.user_type = 'agent'
             AND u.managed_by_agent_row_id IS NOT NULL`,
      [conversationId]
    );
    for (const pa of participantAgents) {
      const agentRow = await dbGet(
        isPostgres()
          ? `SELECT data FROM table_rows WHERE id = $1`
          : `SELECT data FROM table_rows WHERE id = ?`,
        [pa.row_id]
      );
      const agentData = agentRow ? safeJsonParse(agentRow.data, {}) : {};
      if (agentData.name) {
        return {
          id: null,
          name: pa.name || agentData.name,
          email: null,
          managed_by_agent_row_id: pa.row_id,
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

/**
 * ADR-185 — resolve the agent used to translate messages in a conversation.
 *
 * Translation has its OWN mapping — Settings → Виджет → «Агент перевода»,
 * persisted as that agent's table-row id in `spaces.settings.translation_agent_id`
 * (distinct from `default_agent_id`, which only governs auto-responses). When it
 * resolves to an agent row in this space, translations use exactly that agent.
 * Resolution order: `translation_agent_id` → legacy `default_agent_id` (so
 * existing spaces that never set a dedicated translator keep working) → first
 * active agent. Same return shape as `getDefaultAgentForConversation` so
 * `translateMessageText` is agnostic to which path hit.
 */
async function getTranslationAgentForConversation(conversationId) {
  try {
    const conversation = await dbGet(
      isPostgres()
        ? `SELECT space_id FROM conversations WHERE id = $1`
        : `SELECT space_id FROM conversations WHERE id = ?`,
      [conversationId]
    );
    // The space-settings translator mapping only applies to space conversations.
    // Direct/DM chats (space_id=NULL) skip straight to the participant-based
    // default resolver below — never early-return null, or DMs can't translate.
    if (conversation?.space_id) {
      const space = await dbGet(
        isPostgres()
          ? `SELECT settings FROM spaces WHERE id = $1`
          : `SELECT settings FROM spaces WHERE id = ?`,
        [conversation.space_id]
      );
      const settings = safeJsonParse(space?.settings, {}) || {};
      // Dedicated translator first; fall back to the legacy default-agent mapping
      // for spaces provisioned before «Агент перевода» existed.
      const configuredId = settings.translation_agent_id ?? settings.default_agent_id;

      if (configuredId) {
        // Constrain the row lookup to this space's agent tables so a stale or
        // foreign id can never resolve to a non-agent row.
        const agentTableIds = await getAgentTableIds({ spaceId: conversation.space_id });
        if (agentTableIds.length > 0) {
          const tableIn = agentTableIds.join(',');
          const row = await dbGet(
            isPostgres()
              ? `SELECT id AS row_id, data FROM table_rows WHERE id = $1 AND table_id IN (${tableIn})`
              : `SELECT id AS row_id, data FROM table_rows WHERE id = ? AND table_id IN (${tableIn})`,
            [configuredId]
          );
          if (row) {
            const agentData = safeJsonParse(row.data, {});
            if (agentData.name) {
              return {
                id: null,
                name: agentData.name,
                email: null,
                managed_by_agent_row_id: row.row_id,
                _isAiAgentRow: true,
                _agentConfig: agentData,
              };
            }
          }
          apiLogger.warn({ conversationId, configuredId },
            'ADR-185: configured translation agent id did not resolve to an agent row — falling back');
        }
      }
    }

    // No explicit mapping (or it no longer resolves, or a space-less DM) —
    // participant / first-active default.
    return getDefaultAgentForConversation(conversationId);
  } catch (err) {
    apiLogger.error({ err, conversationId }, 'ADR-185: error resolving translation agent');
    return getDefaultAgentForConversation(conversationId);
  }
}

export {
  shouldAutoRespondWithAI,
  getDefaultAgentForConversation,
  getTranslationAgentForConversation,
};
