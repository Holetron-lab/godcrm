/**
 * Conversations CRUD Controller
 * ADR-024 v2: Uses normalized tables (conversations, messages, conversation_participants)
 */

import { Router } from 'express';
import { dbGet, dbRun, dbAll, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, created, notFound, badRequest, forbidden, unauthorized, error } from '../../../utils/response.js';
import { safeParseJSON } from './shared.js';

const router = Router();

/**
 * GET /api/v3/ai/conversations
 */
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res, 'Authentication required');

    const { spaceId, agentId, labId } = req.query;

    let query = isPostgres()
      ? `SELECT c.id, c.title, c.type, c.space_id, c.agent_id, c.agent_table_id, c.lab_id,
                c.created_by, c.created_at, c.updated_at, c.bound_table_id, c.bound_row_id,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND (m.content_type IS NULL OR m.content_type = 'text' OR m.content_type = 'tool_approval')) as messages_count,
                (SELECT content FROM messages m2 WHERE m2.conversation_id = c.id AND (m2.content_type IS NULL OR m2.content_type = 'text') ORDER BY m2.created_at DESC LIMIT 1) as last_message,
                (SELECT r.data->>'name' FROM table_rows r WHERE r.id = c.agent_id) as agent_name,
                (SELECT r.data->>'icon' FROM table_rows r WHERE r.id = c.agent_id) as agent_icon,
                (SELECT COALESCE(r.data->>'name', r.data->>'title', r.data->>'what', r.data->>'subject', r.data->>'label', '#' || r.id) FROM table_rows r WHERE r.table_id = c.bound_table_id AND r.id = c.bound_row_id LIMIT 1) as bound_row_title,
                (SELECT COALESCE(ut.display_name, ut.name) FROM universal_tables ut WHERE ut.id = c.bound_table_id LIMIT 1) as bound_table_name,
                (SELECT ut.icon FROM universal_tables ut WHERE ut.id = c.bound_table_id LIMIT 1) as bound_table_icon
         FROM conversations c
         INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
         WHERE cp.user_id = $1 AND c.type IN ('chat', 'ai_chat')`
      : `SELECT c.id, c.title, c.type, c.space_id, c.agent_id, c.agent_table_id, c.lab_id,
                c.created_by, c.created_at, c.updated_at, c.bound_table_id, c.bound_row_id,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND (m.content_type IS NULL OR m.content_type = 'text' OR m.content_type = 'tool_approval')) as messages_count,
                (SELECT content FROM messages m2 WHERE m2.conversation_id = c.id AND (m2.content_type IS NULL OR m2.content_type = 'text') ORDER BY m2.created_at DESC LIMIT 1) as last_message,
                (SELECT json_extract(r.data, '$.name') FROM table_rows r WHERE r.id = c.agent_id) as agent_name,
                (SELECT json_extract(r.data, '$.icon') FROM table_rows r WHERE r.id = c.agent_id) as agent_icon,
                (SELECT COALESCE(json_extract(r.data, '$.name'), json_extract(r.data, '$.title'), json_extract(r.data, '$.what'), json_extract(r.data, '$.subject'), json_extract(r.data, '$.label'), '#' || r.id) FROM table_rows r WHERE r.table_id = c.bound_table_id AND r.id = c.bound_row_id LIMIT 1) as bound_row_title,
                (SELECT COALESCE(t.display_name, t.name) FROM tables t WHERE t.id = c.bound_table_id LIMIT 1) as bound_table_name,
                (SELECT t.icon FROM tables t WHERE t.id = c.bound_table_id LIMIT 1) as bound_table_icon
         FROM conversations c
         INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
         WHERE cp.user_id = ? AND c.type IN ('chat', 'ai_chat')`;

    const params = [userId];
    let paramIndex = isPostgres() ? 2 : 1;

    if (spaceId) {
      query += isPostgres() ? ` AND c.space_id = $${paramIndex}` : ' AND c.space_id = ?';
      params.push(parseInt(spaceId));
      paramIndex++;
    }
    if (agentId) {
      query += isPostgres() ? ` AND c.agent_id = $${paramIndex}` : ' AND c.agent_id = ?';
      params.push(parseInt(agentId));
      paramIndex++;
    }
    if (labId) {
      query += isPostgres() ? ` AND c.lab_id = $${paramIndex}` : ' AND c.lab_id = ?';
      params.push(labId);
      paramIndex++;
    }

    const { limit = 500, offset = 0 } = req.query;
    if (isPostgres()) {
      query += ` ORDER BY c.updated_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    } else {
      query += ' ORDER BY c.updated_at DESC LIMIT ? OFFSET ?';
    }
    params.push(parseInt(limit), parseInt(offset));

    const rows = await dbAll(query, params);

    const conversations = rows.map(row => ({
      id: row.id, title: row.title || 'New chat', type: row.type,
      spaceId: row.space_id, agent_id: row.agent_id,
      agent_table_id: row.agent_table_id || null, lab_id: row.lab_id || null,
      agentName: row.agent_name || null, agentIcon: row.agent_icon || null,
      messagesCount: row.messages_count || 0,
      lastMessage: row.last_message ? row.last_message.substring(0, 100) : null,
      createdAt: row.created_at, updatedAt: row.updated_at,
      bound_table_id: row.bound_table_id || null, bound_row_id: row.bound_row_id || null,
      bound_row_title: row.bound_row_title || null,
      bound_table_name: row.bound_table_name || null,
      bound_table_icon: row.bound_table_icon || null
    }));

    return success(res, { conversations });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching AI conversations');
    return error(res, 'FETCH_CONVERSATIONS_ERROR', 'Failed to fetch conversations', 500);
  }
});

/**
 * GET /api/v3/ai/conversations/:conversationId
 */
router.get('/conversations/:conversationId', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res, 'Authentication required');

    const { conversationId } = req.params;

    const conversation = await dbGet(
      isPostgres() ? 'SELECT * FROM conversations WHERE id = $1' : 'SELECT * FROM conversations WHERE id = ?',
      [conversationId]
    );
    if (!conversation) return notFound(res, 'Conversation not found');

    const participant = await dbGet(
      isPostgres()
        ? 'SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2'
        : 'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (!participant) return forbidden(res, 'Access denied');

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 200);
    const before = req.query.before ? parseInt(req.query.before) : null;

    let msgQuery, msgParams;
    if (before) {
      msgQuery = isPostgres()
        ? `SELECT m.id, m.conversation_id, m.sender_id, m.sender_type, m.role, m.content, m.content_type, m.agent_id, m.parent_id, m.tool_results, m.created_at,
                  u.name as sender_name, u.avatar as sender_avatar, u.user_type as sender_user_type
           FROM messages m LEFT JOIN users u ON m.sender_id = u.id
           WHERE m.conversation_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT $3`
        : `SELECT m.id, m.conversation_id, m.sender_id, m.sender_type, m.role, m.content, m.content_type, m.agent_id, m.parent_id, m.tool_results, m.created_at,
                  u.name as sender_name, u.avatar as sender_avatar, u.user_type as sender_user_type
           FROM messages m LEFT JOIN users u ON m.sender_id = u.id
           WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`;
      msgParams = [conversationId, before, limit + 1];
    } else {
      msgQuery = isPostgres()
        ? `SELECT m.id, m.conversation_id, m.sender_id, m.sender_type, m.role, m.content, m.content_type, m.agent_id, m.parent_id, m.tool_results, m.created_at,
                  u.name as sender_name, u.avatar as sender_avatar, u.user_type as sender_user_type
           FROM messages m LEFT JOIN users u ON m.sender_id = u.id
           WHERE m.conversation_id = $1 ORDER BY m.id DESC LIMIT $2`
        : `SELECT m.id, m.conversation_id, m.sender_id, m.sender_type, m.role, m.content, m.content_type, m.agent_id, m.parent_id, m.tool_results, m.created_at,
                  u.name as sender_name, u.avatar as sender_avatar, u.user_type as sender_user_type
           FROM messages m LEFT JOIN users u ON m.sender_id = u.id
           WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT ?`;
      msgParams = [conversationId, limit + 1];
    }

    const rawMessages = await dbAll(msgQuery, msgParams);
    const hasMore = rawMessages.length > limit;
    const messages = hasMore ? rawMessages.slice(0, limit) : rawMessages;
    messages.reverse();

    const nextCursor = hasMore && messages.length > 0 ? messages[0].id : null;

    const parsedMessages = messages.map(m => ({
      ...m,
      toolResults: m.tool_results ? safeParseJSON(m.tool_results, null) : null,
      contentType: m.content_type || 'text',
      senderType: m.sender_type || 'human',
      parentId: m.parent_id || null,
      timestamp: m.created_at,
      sender_name: m.sender_name || null,
      sender_avatar: m.sender_avatar || null,
      sender_user_type: m.sender_user_type || null,
    }));

    return success(res, {
      id: conversation.id, title: conversation.title || 'New chat', type: conversation.type,
      spaceId: conversation.space_id, agentId: conversation.agent_id,
      agent_table_id: conversation.agent_table_id || null, lab_id: conversation.lab_id || null,
      bound_table_id: conversation.bound_table_id || null, bound_row_id: conversation.bound_row_id || null,
      isProcessing: !!conversation.is_processing,
      processingStartedAt: conversation.processing_started_at || null,
      processingAgentId: conversation.processing_agent_id || null,
      processingAgentName: conversation.processing_agent_name || null,
      messages: parsedMessages, hasMore, nextCursor,
      createdAt: conversation.created_at, updatedAt: conversation.updated_at
    });
  } catch (err) {
    apiLogger.error({ err }, 'Error fetching AI conversation');
    return error(res, 'FETCH_CONVERSATION_ERROR', 'Failed to fetch conversation', 500);
  }
});

/**
 * POST /api/v3/ai/conversations
 */
router.post('/conversations', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res, 'Authentication required');

    const { title, agentId, agentName, spaceId, labId, agentTableId } = req.body;

    let resolvedAgentTableId = agentTableId || null;
    if (!resolvedAgentTableId && agentId) {
      try {
        const agentRow = await dbGet(
          isPostgres()
            ? `SELECT tr.table_id FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id WHERE tr.id = $1 AND ut.name LIKE '%Agents%'`
            : `SELECT tr.table_id FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id WHERE tr.id = ? AND ut.name LIKE '%Agents%'`,
          [agentId]
        );
        if (agentRow) resolvedAgentTableId = agentRow.table_id;
      } catch (lookupErr) {
        apiLogger.debug({ err: lookupErr }, 'Could not resolve agent_table_id');
      }
    }

    const result = await dbRun(
      isPostgres()
        ? `INSERT INTO conversations (title, type, space_id, agent_id, agent_table_id, lab_id, created_by, created_at, updated_at)
           VALUES ($1, 'chat', $2, $3, $4, $5, $6, NOW(), NOW())`
        : `INSERT INTO conversations (title, type, space_id, agent_id, agent_table_id, lab_id, created_by, created_at, updated_at)
           VALUES (?, 'chat', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [title || 'New chat', spaceId || null, agentId || null, resolvedAgentTableId, labId || null, userId]
    );

    const conversationId = result.lastInsertRowid;

    await dbRun(
      isPostgres()
        ? `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES ($1, $2, 'admin', NOW())`
        : `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'admin', datetime('now'))`,
      [conversationId, userId]
    );

    const conversation = await dbGet(
      isPostgres() ? 'SELECT * FROM conversations WHERE id = $1' : 'SELECT * FROM conversations WHERE id = ?',
      [conversationId]
    );

    return created(res, {
      id: conversation.id, title: conversation.title, type: conversation.type,
      spaceId: conversation.space_id, agentId: conversation.agent_id,
      agent_table_id: conversation.agent_table_id, lab_id: conversation.lab_id,
      createdAt: conversation.created_at, updatedAt: conversation.updated_at
    });
  } catch (err) {
    apiLogger.error({ err }, 'Error creating AI conversation');
    return error(res, 'CREATE_CONVERSATION_ERROR', 'Failed to create conversation', 500);
  }
});

/**
 * PUT /api/v3/ai/conversations/:conversationId
 */
router.put('/conversations/:conversationId', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res, 'Authentication required');

    const { conversationId } = req.params;
    const { title, message, messages } = req.body;

    const conversation = await dbGet(
      isPostgres() ? 'SELECT * FROM conversations WHERE id = $1' : 'SELECT * FROM conversations WHERE id = ?',
      [conversationId]
    );
    if (!conversation) return notFound(res, 'Conversation not found');

    const participant = await dbGet(
      isPostgres()
        ? 'SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2'
        : 'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (!participant) return forbidden(res, 'Access denied');

    if (title) {
      await dbRun(
        isPostgres()
          ? 'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2'
          : `UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?`,
        [title, conversationId]
      );
    }

    if (messages && Array.isArray(messages) && messages.length > 0) {
      const existingCount = await dbGet(
        isPostgres()
          ? 'SELECT COUNT(*) as count FROM messages WHERE conversation_id = $1'
          : 'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
        [conversationId]
      );
      const dbMessageCount = existingCount?.count || 0;
      const newMessages = messages.slice(dbMessageCount);

      for (const msg of newMessages) {
        if (!msg.content && msg.isStreaming) continue;
        const toolResultsJson = msg.toolResults ? JSON.stringify(msg.toolResults) : null;
        const timestamp = msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString();
        const contentType = msg.contentType || msg.content_type || 'text';
        const senderType = msg.senderType || msg.sender_type || (msg.role === 'user' ? 'human' : 'agent');

        await dbRun(
          isPostgres()
            ? `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, tool_results, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
            : `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, tool_results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [conversationId, userId, senderType, msg.role || 'user', msg.content || '', contentType, toolResultsJson, timestamp]
        );
      }

      if (newMessages.length > 0) {
        await dbRun(
          isPostgres()
            ? 'UPDATE conversations SET updated_at = NOW() WHERE id = $1'
            : `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
          [conversationId]
        );
      }
    }

    if (message) {
      const toolResultsJson = message.toolResults ? JSON.stringify(message.toolResults) : null;
      const contentType = message.contentType || message.content_type || 'text';
      const senderType = message.senderType || message.sender_type || (message.role === 'user' ? 'human' : 'agent');

      await dbRun(
        isPostgres()
          ? `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, tool_results, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`
          : `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, tool_results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [conversationId, userId, senderType, message.role || 'user', message.content, contentType, toolResultsJson]
      );

      await dbRun(
        isPostgres()
          ? 'UPDATE conversations SET updated_at = NOW() WHERE id = $1'
          : `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
        [conversationId]
      );
    }

    const updatedConv = await dbGet(
      isPostgres()
        ? `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND (m.content_type IS NULL OR m.content_type = 'text' OR m.content_type = 'tool_approval')) as messages_count,
                  (SELECT content FROM messages m2 WHERE m2.conversation_id = c.id AND (m2.content_type IS NULL OR m2.content_type = 'text') ORDER BY m2.created_at DESC LIMIT 1) as last_message
           FROM conversations c WHERE c.id = $1`
        : `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND (m.content_type IS NULL OR m.content_type = 'text' OR m.content_type = 'tool_approval')) as messages_count,
                  (SELECT content FROM messages m2 WHERE m2.conversation_id = c.id AND (m2.content_type IS NULL OR m2.content_type = 'text') ORDER BY m2.created_at DESC LIMIT 1) as last_message
           FROM conversations c WHERE c.id = ?`,
      [conversationId]
    );

    return success(res, {
      conversation: {
        id: updatedConv.id, title: updatedConv.title, type: updatedConv.type,
        spaceId: updatedConv.space_id, messagesCount: updatedConv.messages_count,
        lastMessage: updatedConv.last_message
      }
    });
  } catch (err) {
    apiLogger.error({ err }, 'Error updating AI conversation');
    return error(res, 'UPDATE_CONVERSATION_ERROR', 'Failed to update conversation', 500);
  }
});

/**
 * DELETE /api/v3/ai/conversations/:conversationId
 */
router.delete('/conversations/:conversationId', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res, 'Authentication required');

    const { conversationId } = req.params;

    const conversation = await dbGet(
      isPostgres() ? 'SELECT * FROM conversations WHERE id = $1' : 'SELECT * FROM conversations WHERE id = ?',
      [conversationId]
    );
    if (!conversation) return notFound(res, 'Conversation not found');

    const participant = await dbGet(
      isPostgres()
        ? 'SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2'
        : 'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [conversationId, userId]
    );
    if (!participant) return forbidden(res, 'Access denied');

    await dbRun(
      isPostgres() ? 'DELETE FROM conversations WHERE id = $1' : 'DELETE FROM conversations WHERE id = ?',
      [conversationId]
    );

    return success(res, null, 'Conversation deleted');
  } catch (err) {
    apiLogger.error({ err }, 'Error deleting AI conversation');
    return error(res, 'DELETE_CONVERSATION_ERROR', 'Failed to delete conversation', 500);
  }
});

export default router;
