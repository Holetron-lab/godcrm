/**
 * Task and row chat routes.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, error, notFound,
  requireAuth,
} from './chatShared.js';

export default function registerTaskRowRoutes(router) {

  // GET /tasks/:tableId/stats - Batch conversation stats for all rows in a table
  // ADR-077: Agent status indicators on Kanban cards
  router.get('/tasks/:tableId/stats', requireAuth, async (req, res) => {
    try {
      const { tableId } = req.params;
      const tid = parseInt(tableId);

      if (isNaN(tid)) return error(res, 'INVALID_TABLE_ID', 'tableId must be a number', 400);

      const stats = await dbAll(
        isPostgres()
          ? `SELECT
               c.bound_row_id AS row_id,
               COALESCE(SUM(c.messages_count), 0)::int AS total_messages,
               COUNT(c.id)::int AS conversation_count,
               MAX(c.last_message_at) AS last_message_at,
               (array_agg(u.name ORDER BY c.last_message_at DESC NULLS LAST))[1] AS last_agent_name,
               (array_agg(u.avatar ORDER BY c.last_message_at DESC NULLS LAST))[1] AS last_agent_avatar,
               (array_agg(u.id ORDER BY c.last_message_at DESC NULLS LAST))[1] AS last_agent_user_id
             FROM conversations c
             LEFT JOIN LATERAL (
               SELECT m.sender_id FROM messages m
               WHERE m.conversation_id = c.id AND m.sender_type = 'agent'
               ORDER BY m.created_at DESC LIMIT 1
             ) lm ON true
             LEFT JOIN users u ON u.id = lm.sender_id
             WHERE c.bound_table_id = $1
               AND c.bound_row_id IS NOT NULL
             GROUP BY c.bound_row_id`
          : `SELECT
               c.bound_row_id AS row_id,
               COALESCE(SUM(c.messages_count), 0) AS total_messages,
               COUNT(c.id) AS conversation_count,
               MAX(c.last_message_at) AS last_message_at,
               NULL AS last_agent_name,
               NULL AS last_agent_avatar,
               NULL AS last_agent_user_id
             FROM conversations c
             WHERE c.bound_table_id = ?
               AND c.bound_row_id IS NOT NULL
             GROUP BY c.bound_row_id`,
        [tid]
      );

      return success(res, stats);
    } catch (err) {
      apiLogger.error('Error getting task stats:', err);
      return error(res, 'GET_TASK_STATS_ERROR', err.message, 500);
    }
  });

  // GET /tasks/:tableId/:rowId - Get task chat
  router.get('/tasks/:tableId/:rowId', requireAuth, async (req, res) => {
    try {
      const { tableId, rowId } = req.params;
      const { create } = req.query;
      const userId = req.user.userId;

      const allConversations = await dbAll(
        isPostgres()
          ? `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as messages_count FROM conversations c WHERE c.bound_table_id = $1 AND c.bound_row_id = $2 ORDER BY c.updated_at DESC`
          : `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as messages_count FROM conversations c WHERE c.bound_table_id = ? AND c.bound_row_id = ? ORDER BY c.updated_at DESC`,
        [parseInt(tableId), parseInt(rowId)]
      );

      let conversation = allConversations.length > 0 ? allConversations[0] : null;
      const isMulti = allConversations.length > 1;

      if (!conversation && create === 'true') {
        if (isPostgres()) {
          const result = await dbRun(`INSERT INTO conversations (type, bound_table_id, bound_row_id, created_by, created_at, updated_at) VALUES ('task', $1, $2, $3, NOW(), NOW())`, [parseInt(tableId), parseInt(rowId), userId]);
          const conversationId = result.lastInsertRowid;
          await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES ($1, $2, 'admin', NOW())`, [conversationId, userId]);
          conversation = await dbGet(`SELECT * FROM conversations WHERE id = $1`, [conversationId]);
        } else {
          const result = await dbRun(`INSERT INTO conversations (type, bound_table_id, bound_row_id, created_by, created_at, updated_at) VALUES ('task', ?, ?, ?, datetime('now'), datetime('now'))`, [parseInt(tableId), parseInt(rowId), userId]);
          const conversationId = result.lastInsertRowid;
          await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'admin', datetime('now'))`, [conversationId, userId]);
          conversation = await dbGet(`SELECT * FROM conversations WHERE id = ?`, [conversationId]);
        }
      }

      if (!conversation) return notFound(res, 'Task chat not found');

      const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 2000);
      const before = req.query.before ? parseInt(req.query.before) : null;

      let msgQuery, msgParams;
      if (before) {
        msgQuery = isPostgres()
          ? `SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.user_type as user_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = $1 AND m.id < $2 ORDER BY m.created_at DESC, m.id DESC LIMIT $3`
          : `SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.user_type as user_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?`;
        msgParams = [conversation.id, before, limit + 1];
      } else {
        msgQuery = isPostgres()
          ? `SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.user_type as user_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`
          : `SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.user_type as user_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?`;
        msgParams = [conversation.id, limit + 1];
      }

      const rawMessages = await dbAll(msgQuery, msgParams);
      const hasMore = rawMessages.length > limit;
      const slicedMessages = hasMore ? rawMessages.slice(0, limit) : rawMessages;
      slicedMessages.reverse();
      const nextCursor = hasMore && slicedMessages.length > 0 ? slicedMessages[0].id : null;

      const messages = slicedMessages.map(m => ({
        ...m,
        user: m.sender_id ? { id: m.sender_id, name: m.user_name || 'Unknown', avatar: m.user_avatar || null, user_type: m.user_user_type || (m.sender_type === 'agent' ? 'agent' : 'user') } : null,
        tool_results: m.tool_results ? safeJsonParse(m.tool_results) : null,
      }));

      const responseData = { ...conversation, conversationId: conversation.id, messages, hasMore, nextCursor };
      if (isMulti) {
        responseData.multi = true;
        responseData.conversations = allConversations.map(c => ({ id: c.id, title: c.title, type: c.type, created_at: c.created_at, updated_at: c.updated_at, messages_count: c.messages_count || 0 }));
      }

      return success(res, responseData);
    } catch (err) {
      apiLogger.error('Error getting task chat:', err);
      return error(res, 'GET_TASK_CHAT_ERROR', err.message, 500);
    }
  });

  // GET /rows/:tableId/:rowId - General row chat (any table)
  router.get('/rows/:tableId/:rowId', requireAuth, async (req, res) => {
    try {
      const { tableId, rowId } = req.params;
      const { create } = req.query;
      const userId = req.user.userId;

      const allConversations = await dbAll(
        isPostgres()
          ? `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as messages_count FROM conversations c WHERE c.bound_table_id = $1 AND c.bound_row_id = $2 ORDER BY c.updated_at DESC`
          : `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as messages_count FROM conversations c WHERE c.bound_table_id = ? AND c.bound_row_id = ? ORDER BY c.updated_at DESC`,
        [parseInt(tableId), parseInt(rowId)]
      );

      let conversation = allConversations.length > 0 ? allConversations[0] : null;
      const isMulti = allConversations.length > 1;

      if (!conversation && create === 'true') {
        if (isPostgres()) {
          const result = await dbRun(`INSERT INTO conversations (type, bound_table_id, bound_row_id, created_by, created_at, updated_at) VALUES ('row', $1, $2, $3, NOW(), NOW())`, [parseInt(tableId), parseInt(rowId), userId]);
          const conversationId = result.lastInsertRowid;
          await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES ($1, $2, 'admin', NOW())`, [conversationId, userId]);
          conversation = await dbGet(`SELECT * FROM conversations WHERE id = $1`, [conversationId]);
        } else {
          const result = await dbRun(`INSERT INTO conversations (type, bound_table_id, bound_row_id, created_by, created_at, updated_at) VALUES ('row', ?, ?, ?, datetime('now'), datetime('now'))`, [parseInt(tableId), parseInt(rowId), userId]);
          const conversationId = result.lastInsertRowid;
          await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'admin', datetime('now'))`, [conversationId, userId]);
          conversation = await dbGet(`SELECT * FROM conversations WHERE id = ?`, [conversationId]);
        }
      }

      if (!conversation) return notFound(res, 'Row chat not found');

      const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 2000);
      const before = req.query.before ? parseInt(req.query.before) : null;

      let msgQuery, msgParams;
      if (before) {
        msgQuery = isPostgres()
          ? `SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.user_type as user_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = $1 AND m.id < $2 ORDER BY m.created_at DESC, m.id DESC LIMIT $3`
          : `SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.user_type as user_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?`;
        msgParams = [conversation.id, before, limit + 1];
      } else {
        msgQuery = isPostgres()
          ? `SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.user_type as user_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`
          : `SELECT m.*, u.name as user_name, u.avatar as user_avatar, u.user_type as user_user_type FROM messages m LEFT JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?`;
        msgParams = [conversation.id, limit + 1];
      }

      const rawMessages = await dbAll(msgQuery, msgParams);
      const hasMore = rawMessages.length > limit;
      const slicedMessages = hasMore ? rawMessages.slice(0, limit) : rawMessages;
      slicedMessages.reverse();
      const nextCursor = hasMore && slicedMessages.length > 0 ? slicedMessages[0].id : null;

      const messages = slicedMessages.map(m => ({
        ...m,
        user: m.sender_id ? { id: m.sender_id, name: m.user_name || 'Unknown', avatar: m.user_avatar || null, user_type: m.user_user_type || (m.sender_type === 'agent' ? 'agent' : 'user') } : null,
        tool_results: m.tool_results ? safeJsonParse(m.tool_results) : null,
      }));

      const responseData = { ...conversation, conversationId: conversation.id, messages, hasMore, nextCursor };
      if (isMulti) {
        responseData.multi = true;
        responseData.conversations = allConversations.map(c => ({ id: c.id, title: c.title, type: c.type, created_at: c.created_at, updated_at: c.updated_at, messages_count: c.messages_count || 0 }));
      }

      return success(res, responseData);
    } catch (err) {
      apiLogger.error('Error getting row chat:', err);
      return error(res, 'GET_ROW_CHAT_ERROR', err.message, 500);
    }
  });
}
