/**
 * Enhanced Chat Controller
 * ADR-023: Mentions, task binding, context optimization, chunking
 */

import { Router } from 'express';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import chatChunkingService from '../../../services/chatChunkingService.js';
import { success, notFound, badRequest, error } from '../../../utils/response.js';
import {
  safeParseJSON,
  getConversationMessages,
  resolveConversationsTableId,
  parseMentions,
} from './shared.js';

const router = Router();

/**
 * POST /api/v3/ai/chat/send
 * Send message with @mention support
 */
router.post('/chat/send', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { conversationId, message, agentId, mentions = [] } = req.body;

    if (!message && !conversationId) return badRequest(res, 'Message or conversationId is required');

    const parsedMentions = parseMentions(message);
    const allMentions = [...new Set([...mentions, ...parsedMentions])];

    let conversation;
    if (conversationId) {
      const row = await dbGet(`SELECT id, data, table_id FROM table_rows WHERE id = ?`, [conversationId]);
      if (row) {
        conversation = { id: row.id, tableId: row.table_id, data: safeParseJSON(row.data, {}) };
      }
    }

    const newMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user', content: message, userId, mentions: allMentions,
      timestamp: new Date().toISOString()
    };

    if (conversation) {
      const messages = getConversationMessages(conversation.data);
      messages.push(newMessage);
      conversation.data.messages = messages;
      conversation.data.content = messages;
      conversation.data.messages_count = messages.length;
      conversation.data.last_message = message.substring(0, 100);

      await dbRun(`UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(conversation.data), conversationId]);
    }

    const mentionedAgents = [];
    if (allMentions.length > 0) {
      const agentUsers = await dbAll(`
        SELECT u.id, u.name, u.agent_config, u.managed_by_agent_row_id, tr.data as agent_data
        FROM users u LEFT JOIN table_rows tr ON tr.id = u.managed_by_agent_row_id
        WHERE u.user_type = 'agent'
      `);

      for (const mention of allMentions) {
        const agent = agentUsers.find(a => {
          const nameSlug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          return nameSlug.includes(mention) || mention.includes(nameSlug.split('-')[0]);
        });
        if (agent) {
          mentionedAgents.push({
            id: agent.id, name: agent.name, agentRowId: agent.managed_by_agent_row_id,
            config: safeParseJSON(agent.agent_config, {}), agentData: safeParseJSON(agent.agent_data, {})
          });
        }
      }
    }

    return success(res, {
      message: newMessage, conversationId: conversation?.id,
      mentionedAgents: mentionedAgents.map(a => ({
        id: a.id, name: a.name,
        willRespond: !a.config.respond_only_when_mentioned || allMentions.length > 0
      }))
    });
  } catch (err) {
    apiLogger.error({ err, context: 'Chat Send' }, 'Error sending chat message');
    return error(res, 'CHAT_SEND_ERROR', 'Failed to send message', 500);
  }
});

/**
 * POST /api/v3/ai/chat/:conversationId/bind-task
 */
router.post('/chat/:conversationId/bind-task', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { tableId, rowId } = req.body;

    if (!tableId || !rowId) return badRequest(res, 'tableId and rowId are required');

    const conversation = await dbGet(`SELECT id, data FROM table_rows WHERE id = ?`, [conversationId]);
    if (!conversation) return notFound(res, 'Conversation not found');

    const task = await dbGet(`SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`, [rowId, tableId]);
    if (!task) return notFound(res, 'Task not found');

    const data = safeParseJSON(conversation.data, {});
    data.bound_table_id = Number(tableId);
    data.bound_row_id = Number(rowId);

    await dbRun(`UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
      [JSON.stringify(data), conversationId]);

    return success(res, {
      message: 'Conversation bound to task',
      binding: { conversationId: Number(conversationId), tableId: Number(tableId), rowId: Number(rowId) }
    });
  } catch (err) {
    apiLogger.error({ err, context: 'Chat Bind Task' }, 'Error binding chat to task');
    return error(res, 'BIND_TASK_ERROR', 'Failed to bind task', 500);
  }
});

/**
 * GET /api/v3/ai/chat/:conversationId/context
 */
router.get('/chat/:conversationId/context', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { includeRaw = false, maxMessages = 20, includeSummaries = true } = req.query;

    const conversation = await dbGet(`SELECT id, data FROM table_rows WHERE id = ?`, [conversationId]);
    if (!conversation) return notFound(res, 'Conversation not found');

    const data = safeParseJSON(conversation.data, {});
    const messages = getConversationMessages(data);

    const context = {
      conversationId: Number(conversationId), title: data.title,
      agentId: data.agent_id, agentName: data.agent_name, totalMessages: messages.length,
      activeMessages: messages.slice(-Number(maxMessages)),
      boundTask: data.bound_table_id ? { tableId: data.bound_table_id, rowId: data.bound_row_id } : null
    };

    if (includeSummaries && data.summaries) context.summaries = data.summaries;
    if (includeRaw === 'true') context.rawMessages = messages;

    return success(res, { context });
  } catch (err) {
    apiLogger.error({ err, context: 'Chat Context' }, 'Error getting chat context');
    return error(res, 'CHAT_CONTEXT_ERROR', 'Failed to get context', 500);
  }
});

/**
 * GET /api/v3/tasks/:tableId/:rowId/chat
 */
router.get('/tasks/:tableId/:rowId/chat', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { tableId, rowId } = req.params;

    const task = await dbGet(`
      SELECT tr.id, tr.data, ut.project_id, p.space_id
      FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id JOIN projects p ON ut.project_id = p.id
      WHERE tr.id = ? AND tr.table_id = ?
    `, [rowId, tableId]);
    if (!task) return notFound(res, 'Task not found');

    const { tableId: conversationsTableId } = await resolveConversationsTableId({ spaceId: task.space_id });
    if (!conversationsTableId) return notFound(res, 'No conversations table found. Please create AI Chat History table.');

    const existingChat = await dbGet(`
      SELECT id, data FROM table_rows
      WHERE table_id = ? AND data->>'bound_table_id' = ? AND data->>'bound_row_id' = ?
    `, [conversationsTableId, String(tableId), String(rowId)]);

    if (existingChat) {
      const chatData = safeParseJSON(existingChat.data, {});
      return success(res, {
        conversation: {
          id: existingChat.id, title: chatData.title,
          messages: getConversationMessages(chatData), messagesCount: chatData.messages_count || 0,
          boundTask: { tableId: Number(tableId), rowId: Number(rowId) }
        }
      });
    }

    const taskData = safeParseJSON(task.data, {});
    const taskTitle = taskData.title || taskData.name || `Task #${rowId}`;
    const sessionId = `task-${tableId}-${rowId}-${Date.now()}`;
    const conversationData = {
      title: `Chat: ${taskTitle}`, user_id: String(userId), space_id: task.space_id,
      session_id: sessionId, messages: [], content: [], messages_count: 0,
      bound_table_id: Number(tableId), bound_row_id: Number(rowId),
      created_at: new Date().toISOString()
    };

    const result = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [conversationsTableId, sessionId, JSON.stringify(conversationData), userId]);

    return success(res, {
      conversation: {
        id: result.lastInsertRowid || result.lastID, title: conversationData.title,
        messages: [], messagesCount: 0,
        boundTask: { tableId: Number(tableId), rowId: Number(rowId) }
      }
    });
  } catch (err) {
    apiLogger.error({ err, context: 'Task Chat' }, 'Error getting task chat');
    return error(res, 'TASK_CHAT_ERROR', 'Failed to get task chat', 500);
  }
});

/**
 * POST /api/v3/ai/chat/:conversationId/optimize-context
 */
router.post('/chat/:conversationId/optimize-context', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { maxTokens = 4000 } = req.body;

    const conversation = await dbGet(`SELECT id, data FROM table_rows WHERE id = ?`, [conversationId]);
    if (!conversation) return notFound(res, 'Conversation not found');

    const data = safeParseJSON(conversation.data, {});
    const optimizedContext = chatChunkingService.buildOptimizedContext(data, maxTokens);

    return success(res, {
      context: optimizedContext,
      chunking: {
        chunkSize: chatChunkingService.CHUNK_SIZE,
        keepRecent: chatChunkingService.KEEP_RECENT_MESSAGES,
        needsSummarization: chatChunkingService.needsSummarization(data)
      }
    });
  } catch (err) {
    apiLogger.error({ err, context: 'Optimize Context' }, 'Error optimizing context');
    return error(res, 'OPTIMIZE_CONTEXT_ERROR', 'Failed to optimize context', 500);
  }
});

/**
 * GET /api/v3/ai/chat/:conversationId/chunks
 */
router.get('/chat/:conversationId/chunks', async (req, res) => {
  try {
    const { conversationId } = req.params;

    const conversation = await dbGet(`SELECT id, data FROM table_rows WHERE id = ?`, [conversationId]);
    if (!conversation) return notFound(res, 'Conversation not found');

    const data = safeParseJSON(conversation.data, {});
    const messages = getConversationMessages(data);
    const { chunks, recentMessages } = chatChunkingService.chunkMessages(messages);
    const summaries = data.chunk_summaries || [];

    const chunksWithStatus = chunks.map(chunk => ({
      ...chunk,
      hasSummary: summaries.some(s => s.chunkId === chunk.id),
      summary: summaries.find(s => s.chunkId === chunk.id)?.content
    }));

    return success(res, {
      chunks: chunksWithStatus, recentMessages: recentMessages.length,
      totalMessages: messages.length, summariesCount: summaries.length
    });
  } catch (err) {
    apiLogger.error({ err, context: 'Chat Chunks' }, 'Error getting chat chunks');
    return error(res, 'CHAT_CHUNKS_ERROR', 'Failed to get chat chunks', 500);
  }
});

/**
 * POST /api/v3/ai/chat/:conversationId/summarize-chunk
 */
router.post('/chat/:conversationId/summarize-chunk', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { chunkId, summary } = req.body;

    if (!chunkId) return badRequest(res, 'chunkId is required');

    if (summary) {
      const result = await chatChunkingService.saveChunkSummary(Number(conversationId), chunkId, summary);
      return success(res, { summary: result });
    }

    const conversation = await dbGet(`SELECT id, data FROM table_rows WHERE id = ?`, [conversationId]);
    if (!conversation) return notFound(res, 'Conversation not found');

    const data = safeParseJSON(conversation.data, {});
    const messages = getConversationMessages(data);
    const { chunks } = chatChunkingService.chunkMessages(messages);

    const chunk = chunks.find(c => c.id === chunkId);
    if (!chunk) return notFound(res, 'Chunk not found');

    const prompt = chatChunkingService.generateSummaryPrompt(chunk.messages);

    return success(res, {
      chunk: { id: chunk.id, messageCount: chunk.messageCount, startTime: chunk.startTime, endTime: chunk.endTime },
      summaryPrompt: prompt
    });
  } catch (err) {
    apiLogger.error({ err, context: 'Summarize Chunk' }, 'Error summarizing chunk');
    return error(res, 'SUMMARIZE_CHUNK_ERROR', 'Failed to summarize chunk', 500);
  }
});

export default router;
