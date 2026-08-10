/**
 * Participant, read, unread, search, shared conversations, and reactions routes.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, created, error, badRequest, notFound,
  requireAuth,
} from './chatShared.js';

export default function registerParticipantRoutes(router) {

  // POST /conversations/:id/participants - Add participant
  router.post('/conversations/:id/participants', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { user_id, role = 'member' } = req.body;
      const existing = await dbGet(isPostgres() ? `SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2` : `SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`, [id, user_id]);
      if (existing) return error(res, 'PARTICIPANT_EXISTS', 'User already participant', 409);
      if (isPostgres()) await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES ($1, $2, $3, NOW())`, [id, user_id, role]);
      else await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, datetime('now'))`, [id, user_id, role]);
      return created(res, { conversation_id: parseInt(id), user_id, role });
    } catch (err) {
      apiLogger.error('Error adding participant:', err);
      return error(res, 'ADD_PARTICIPANT_ERROR', err.message, 500);
    }
  });

  // DELETE /conversations/:id/participants/:userId - Remove participant
  router.delete('/conversations/:id/participants/:userId', requireAuth, async (req, res) => {
    try {
      const { id, userId: participantId } = req.params;
      if (isPostgres()) await dbRun(`DELETE FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`, [id, participantId]);
      else await dbRun(`DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`, [id, participantId]);
      return success(res, { removed: true });
    } catch (err) {
      apiLogger.error('Error removing participant:', err);
      return error(res, 'REMOVE_PARTICIPANT_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/read - Mark messages as read
  router.post('/conversations/:id/read', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const participant = await dbGet(isPostgres() ? `SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2` : `SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`, [id, userId]);
      if (!participant) return notFound(res, 'Conversation not found');
      if (isPostgres()) await dbRun(`UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`, [id, userId]);
      else await dbRun(`UPDATE conversation_participants SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?`, [id, userId]);
      apiLogger.info(`User ${userId} marked conversation ${id} as read`);
      return success(res, { marked_read: true, conversation_id: parseInt(id) });
    } catch (err) {
      apiLogger.error('Error marking messages as read:', err);
      return error(res, 'MARK_READ_ERROR', err.message, 500);
    }
  });

  // GET /unread - Get total unread count
  router.get('/unread', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      let result;
      if (isPostgres()) {
        result = await dbGet(`SELECT COUNT(*) as total_unread FROM messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1 WHERE m.sender_id != $1 AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at) AND (m.content_type IS NULL OR m.content_type NOT IN ('tool_call', 'tool_result', 'thinking', 'plan', 'agent_status'))`, [userId]);
      } else {
        result = await dbGet(`SELECT COUNT(*) as total_unread FROM messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = ? WHERE m.sender_id != ? AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at) AND (m.content_type IS NULL OR m.content_type NOT IN ('tool_call', 'tool_result', 'thinking', 'plan', 'agent_status'))`, [userId, userId]);
      }
      return success(res, { total_unread: parseInt(result?.total_unread || 0) });
    } catch (err) {
      apiLogger.error('Error getting unread count:', err);
      return error(res, 'GET_UNREAD_ERROR', err.message, 500);
    }
  });

  // GET /search - Search messages
  router.get('/search', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { q, conversation_id, limit = 200 } = req.query;
      if (!q) return success(res, []);

      let messages;
      if (isPostgres()) {
        const sql = `SELECT m.* FROM messages m JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id WHERE cp.user_id = $1 AND m.search_vector @@ plainto_tsquery('english', $2) ${conversation_id ? 'AND m.conversation_id = $3' : ''} ORDER BY m.created_at DESC LIMIT ${conversation_id ? '$4' : '$3'}`;
        const params = conversation_id ? [userId, q, parseInt(conversation_id), parseInt(limit)] : [userId, q, parseInt(limit)];
        messages = await dbAll(sql, params);
      } else {
        const sql = `SELECT m.* FROM messages m JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id WHERE cp.user_id = ? AND m.content LIKE ? ${conversation_id ? 'AND m.conversation_id = ?' : ''} ORDER BY m.created_at DESC LIMIT ?`;
        const params = conversation_id ? [userId, `%${q}%`, parseInt(conversation_id), parseInt(limit)] : [userId, `%${q}%`, parseInt(limit)];
        messages = await dbAll(sql, params);
      }
      return success(res, messages);
    } catch (err) {
      apiLogger.error('Error searching messages:', err);
      return error(res, 'SEARCH_MESSAGES_ERROR', err.message, 500);
    }
  });

  // GET /conversations/with/:userId - Get shared conversations with a user
  router.get('/conversations/with/:userId', requireAuth, async (req, res) => {
    try {
      const currentUserId = req.user.userId;
      const targetUserId = parseInt(req.params.userId);
      const { limit = 200, offset = 0 } = req.query;

      const conversations = await dbAll(
        isPostgres()
          ? `SELECT c.*, COUNT(CASE WHEN m.content_type IS NULL OR m.content_type = 'text' OR m.content_type = 'tool_approval' THEN 1 END) as messages_count, MAX(m.created_at) as last_message_at FROM conversations c JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = $1 JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = $2 LEFT JOIN messages m ON c.id = m.conversation_id GROUP BY c.id ORDER BY COALESCE(MAX(m.created_at), c.updated_at) DESC LIMIT $3 OFFSET $4`
          : `SELECT c.*, COUNT(CASE WHEN m.content_type IS NULL OR m.content_type = 'text' OR m.content_type = 'tool_approval' THEN 1 END) as messages_count, MAX(m.created_at) as last_message_at FROM conversations c JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ? JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ? LEFT JOIN messages m ON c.id = m.conversation_id GROUP BY c.id ORDER BY COALESCE(MAX(m.created_at), c.updated_at) DESC LIMIT ? OFFSET ?`,
        [currentUserId, targetUserId, parseInt(limit), parseInt(offset)]
      );

      const conversationsWithParticipants = await Promise.all(
        conversations.map(async (conv) => {
          const participants = await dbAll(
            isPostgres()
              ? `SELECT cp.user_id, cp.role, u.name, u.email, CASE WHEN length(u.avatar) > 2048 THEN '' ELSE COALESCE(u.avatar, '') END as avatar_url FROM conversation_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.conversation_id = $1 ORDER BY cp.joined_at ASC`
              : `SELECT cp.user_id, cp.role, u.name, u.email FROM conversation_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.conversation_id = ? ORDER BY cp.joined_at ASC`,
            [conv.id]
          );
          return { ...conv, participants, messages_count: parseInt(conv.messages_count || 0) };
        })
      );

      apiLogger.info(`Found ${conversationsWithParticipants.length} shared conversations between users ${currentUserId} and ${targetUserId}`);
      return success(res, conversationsWithParticipants);
    } catch (err) {
      apiLogger.error('Error getting shared conversations:', err);
      return error(res, 'GET_SHARED_CONVERSATIONS_ERROR', err.message, 500);
    }
  });

  // POST /messages/:messageId/reactions - Add reaction
  router.post('/messages/:messageId/reactions', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.params;
      const { emoji } = req.body;
      const userId = req.user.userId;
      if (!emoji) return badRequest(res, 'Emoji is required');

      const existing = await dbGet(isPostgres() ? 'SELECT id FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3' : 'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [messageId, userId, emoji]);

      if (existing) {
        await dbRun(isPostgres() ? 'DELETE FROM message_reactions WHERE id = $1' : 'DELETE FROM message_reactions WHERE id = ?', [existing.id]);
        return success(res, { removed: true, emoji });
      }

      await dbRun(isPostgres() ? 'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)' : 'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [messageId, userId, emoji]);
      return success(res, { added: true, emoji });
    } catch (err) {
      apiLogger.error('Error adding reaction:', err);
      return error(res, 'ADD_REACTION_ERROR', err.message, 500);
    }
  });

  // POST /messages/reactions/batch - Get reactions for multiple messages
  router.post('/messages/reactions/batch', requireAuth, async (req, res) => {
    try {
      const { messageIds } = req.body;
      if (!Array.isArray(messageIds) || messageIds.length === 0) return success(res, {});

      const ids = messageIds.slice(0, 100).map(Number).filter(id => !isNaN(id));
      if (ids.length === 0) return success(res, {});

      const placeholders = isPostgres() ? ids.map((_, i) => `$${i + 1}`).join(',') : ids.map(() => '?').join(',');

      const reactions = await dbAll(
        isPostgres()
          ? `SELECT mr.message_id, mr.emoji, mr.user_id, u.name as user_name FROM message_reactions mr JOIN users u ON mr.user_id = u.id WHERE mr.message_id IN (${placeholders}) ORDER BY mr.created_at ASC`
          : `SELECT mr.message_id, mr.emoji, mr.user_id, u.name as user_name FROM message_reactions mr JOIN users u ON mr.user_id = u.id WHERE mr.message_id IN (${placeholders}) ORDER BY mr.created_at ASC`,
        ids
      );

      const result = {};
      for (const r of reactions) {
        if (!result[r.message_id]) result[r.message_id] = {};
        if (!result[r.message_id][r.emoji]) result[r.message_id][r.emoji] = [];
        result[r.message_id][r.emoji].push({ user_id: r.user_id, user_name: r.user_name });
      }
      for (const id of ids) { if (!result[id]) result[id] = {}; }
      return success(res, result);
    } catch (err) {
      apiLogger.error('Error getting batch reactions:', err);
      return error(res, 'GET_REACTIONS_ERROR', err.message, 500);
    }
  });

  // GET /messages/:messageId/reactions - Get reactions for message
  router.get('/messages/:messageId/reactions', requireAuth, async (req, res) => {
    try {
      const { messageId } = req.params;
      const reactions = await dbAll(
        isPostgres()
          ? `SELECT mr.emoji, mr.user_id, u.name as user_name FROM message_reactions mr JOIN users u ON mr.user_id = u.id WHERE mr.message_id = $1 ORDER BY mr.created_at ASC`
          : `SELECT mr.emoji, mr.user_id, u.name as user_name FROM message_reactions mr JOIN users u ON mr.user_id = u.id WHERE mr.message_id = ? ORDER BY mr.created_at ASC`,
        [messageId]
      );
      const grouped = reactions.reduce((acc, r) => { if (!acc[r.emoji]) acc[r.emoji] = []; acc[r.emoji].push({ user_id: r.user_id, user_name: r.user_name }); return acc; }, {});
      return success(res, grouped);
    } catch (err) {
      apiLogger.error('Error getting reactions:', err);
      return error(res, 'GET_REACTIONS_ERROR', err.message, 500);
    }
  });
}
