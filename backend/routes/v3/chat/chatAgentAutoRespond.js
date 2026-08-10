/** Chat agent auto-respond logic — determines which agents should auto-respond. */
import { dbGet, dbAll, isPostgres, safeJsonParse, apiLogger, isMessageRelevantToAgent } from './chatShared.js';
import { enrichSubAgents } from './chatAgentHelpers.js';
// Re-export for backward compatibility
export {
  shouldAutoRespondWithAI,
  getDefaultAgentForConversation,
} from './chatAgentAutoRespondDefaults.js';

/**
 * Ticket #41053: Get sub-agent(s) that should respond for a conversation.
 */
async function getRespondingSubAgents(conversationId) {
  try {
    const conversation = await dbGet(
      isPostgres()
        ? `SELECT sub_agents FROM conversations WHERE id = $1`
        : `SELECT sub_agents FROM conversations WHERE id = ?`,
      [conversationId]
    );

    if (!conversation) return [];

    const subAgents = safeJsonParse(conversation.sub_agents, []);
    if (!Array.isArray(subAgents) || subAgents.length === 0) return [];

    const enriched = await enrichSubAgents(subAgents);
    if (enriched.length === 0) return [];

    if (enriched.length === 1) {
      const agent = enriched[0];
      const agentRow = await dbGet(
        isPostgres()
          ? `SELECT tr.data FROM table_rows tr WHERE tr.id = $1`
          : `SELECT tr.data FROM table_rows tr WHERE tr.id = ?`,
        [agent.row_id]
      );
      const agentConfig = agentRow ? safeJsonParse(agentRow.data, {}) : {};
      return [{
        id: null,
        name: agent.name,
        email: null,
        managed_by_agent_row_id: agent.row_id,
        _isAiAgentRow: true,
        _agentConfig: agentConfig
      }];
    }

    const responding = [];
    for (const agent of enriched) {
      if (agent.response_mode === 'always') {
        const agentRow = await dbGet(
          isPostgres()
            ? `SELECT tr.data FROM table_rows tr WHERE tr.id = $1`
            : `SELECT tr.data FROM table_rows tr WHERE tr.id = ?`,
          [agent.row_id]
        );
        const agentConfig = agentRow ? safeJsonParse(agentRow.data, {}) : {};
        responding.push({
          id: null,
          name: agent.name,
          email: null,
          managed_by_agent_row_id: agent.row_id,
          _isAiAgentRow: true,
          _agentConfig: agentConfig
        });
      }
    }

    return responding;
  } catch (err) {
    apiLogger.error({ err, conversationId }, 'Error getting responding sub-agents');
    return [];
  }
}

/**
 * ADR-091 / Ticket #41159 (AC23): Get agents that should auto-respond to a message.
 */
async function getAutoRespondAgents(conversationId, senderId, messageContent = '') {
  try {
    const agentsMap = new Map();

    // Source 1: conversation_participants with user_type='agent'
    const participantAgents = await dbAll(
      isPostgres()
        ? `SELECT u.id, u.name, u.email, u.managed_by_agent_row_id, u.managed_by_agent_table_id, u.agent_config, cp.agent_response_mode
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = $1 AND u.user_type = 'agent'`
        : `SELECT u.id, u.name, u.email, u.managed_by_agent_row_id, u.managed_by_agent_table_id, u.agent_config, cp.agent_response_mode
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = ? AND u.user_type = 'agent'`,
      [conversationId]
    );

    for (const pa of participantAgents) {
      const rowId = pa.managed_by_agent_row_id;
      if (!rowId) continue;

      const agentRow = await dbGet(
        isPostgres()
          ? `SELECT tr.data FROM table_rows tr WHERE tr.id = $1`
          : `SELECT tr.data FROM table_rows tr WHERE tr.id = ?`,
        [rowId]
      );
      const agentConfig = agentRow ? safeJsonParse(agentRow.data, {}) : {};

      agentsMap.set(rowId, {
        id: pa.id,
        name: pa.name || agentConfig.name || 'AI Agent',
        email: pa.email,
        managed_by_agent_row_id: rowId,
        _isAiAgentRow: true,
        _agentConfig: { ...agentConfig, row_id: rowId },
        _source: 'participant',
        _response_mode_override: pa.agent_response_mode || undefined
      });
    }

    // Source 2: sub_agents JSONB (legacy backward compatibility)
    const conversation = await dbGet(
      isPostgres()
        ? `SELECT sub_agents FROM conversations WHERE id = $1`
        : `SELECT sub_agents FROM conversations WHERE id = ?`,
      [conversationId]
    );

    const subAgents = safeJsonParse(conversation?.sub_agents, []);
    if (Array.isArray(subAgents) && subAgents.length > 0) {
      const enriched = await enrichSubAgents(subAgents);
      for (const sa of enriched) {
        if (agentsMap.has(sa.row_id)) continue;

        const agentRow = await dbGet(
          isPostgres()
            ? `SELECT tr.data FROM table_rows tr WHERE tr.id = $1`
            : `SELECT tr.data FROM table_rows tr WHERE tr.id = ?`,
          [sa.row_id]
        );
        const agentConfig = agentRow ? safeJsonParse(agentRow.data, {}) : {};

        agentsMap.set(sa.row_id, {
          id: null,
          name: sa.name || agentConfig.name || 'AI Agent',
          email: null,
          managed_by_agent_row_id: sa.row_id,
          _isAiAgentRow: true,
          _agentConfig: { ...agentConfig, row_id: sa.row_id },
          _source: 'sub_agents',
          _response_mode_override: sa.response_mode
        });
      }
    }

    if (agentsMap.size === 0) return [];

    // Determine solo vs group mode
    const humanCount = await dbGet(
      isPostgres()
        ? `SELECT COUNT(*) as count FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = $1 AND u.user_type != 'agent'`
        : `SELECT COUNT(*) as count FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = ? AND u.user_type != 'agent'`,
      [conversationId]
    );
    const humanCountNum = parseInt(humanCount?.count || '0');
    const isSoloMode = humanCountNum <= 1;

    const totalParticipants = await dbGet(
      isPostgres()
        ? `SELECT COUNT(*) as count FROM conversation_participants WHERE conversation_id = $1`
        : `SELECT COUNT(*) as count FROM conversation_participants WHERE conversation_id = ?`,
      [conversationId]
    );
    const totalCount = parseInt(totalParticipants?.count || '0');
    const isDirectChat = totalCount === 2 && humanCountNum === 1 && agentsMap.size === 1;

    apiLogger.debug({
      conversationId, humanCount: humanCountNum, totalParticipants: totalCount,
      agentsInMap: agentsMap.size, isSoloMode, isDirectChat
    }, 'Ticket #42410-B: Chat mode detection');

    const result = [];
    for (const agent of agentsMap.values()) {
      const responseMode = agent._response_mode_override
        || agent._agentConfig?.response_mode
        || 'mention_only';
      const groupChatBehavior = agent._agentConfig?.group_chat_behavior || 'always_respond';

      if (isDirectChat) {
        apiLogger.debug({ conversationId, agentName: agent.name, responseMode, groupChatBehavior },
          'Ticket #42410-B: Direct chat — agent auto-responds without @mention');
        result.push(agent);
      } else if (isSoloMode) {
        if (agentsMap.size === 1) {
          result.push(agent);
        } else {
          if (responseMode === 'always') {
            result.push(agent);
          } else if (responseMode === 'topic_only') {
            const relevant = isMessageRelevantToAgent(messageContent, agent._agentConfig);
            if (relevant) {
              apiLogger.debug({ conversationId, agentName: agent.name, responseMode, relevant },
                'Ticket #42127: topic_only agent included in solo mode — message relevant');
              result.push(agent);
            } else {
              apiLogger.debug({ conversationId, agentName: agent.name, responseMode },
                'Ticket #42127: topic_only agent excluded in solo mode — message not relevant');
            }
          }
        }
      } else {
        if (groupChatBehavior === 'silent') {
          apiLogger.debug({ conversationId, agentName: agent.name, groupChatBehavior },
            'Ticket #40735: Agent excluded — group_chat_behavior is silent');
          continue;
        }
        if (groupChatBehavior === 'mention_only') {
          apiLogger.debug({ conversationId, agentName: agent.name, groupChatBehavior },
            'Ticket #40735: Agent excluded — group_chat_behavior is mention_only');
          continue;
        }
        if (responseMode === 'always') {
          result.push(agent);
        } else if (responseMode === 'topic_only') {
          const relevant = isMessageRelevantToAgent(messageContent, agent._agentConfig);
          if (relevant) {
            apiLogger.debug({ conversationId, agentName: agent.name, responseMode, relevant },
              'ADR-091: topic_only agent included — message is relevant');
            result.push(agent);
          } else {
            apiLogger.debug({ conversationId, agentName: agent.name, responseMode },
              'ADR-091: topic_only agent excluded — message not relevant');
          }
        }
      }
    }

    apiLogger.debug({
      conversationId, totalAgents: agentsMap.size, respondingAgents: result.length,
      isSoloMode, messageContentLength: messageContent?.length || 0,
      sources: { participants: participantAgents.length, subAgents: subAgents.length }
    }, 'ADR-091: getAutoRespondAgents result (AC23 dual-source)');

    return result;
  } catch (err) {
    apiLogger.error({ err, conversationId }, 'ADR-091: Error in getAutoRespondAgents');
    return [];
  }
}

export {
  getRespondingSubAgents,
  getAutoRespondAgents,
};
