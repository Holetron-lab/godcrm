/**
 * Conversation extras routes: bind, bind-lab, labs, settings, sub-agents.
 * Extracted from conversationCrudController.js to keep files under 400 lines.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, created, error, badRequest, notFound,
  requireAuth,
} from './chatShared.js';
import {
  resolveAgentUser, validateSubAgentRowIds, enrichSubAgents,
} from './chatAgentHelpers.js';

export default function registerConversationExtrasRoutes(router) {

  // POST /conversations/:id/bind - Bind to task
  router.post('/conversations/:id/bind', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { table_id, row_id } = req.body;
      if (isPostgres()) await dbRun(`UPDATE conversations SET bound_table_id = $1, bound_row_id = $2, updated_at = NOW() WHERE id = $3`, [table_id, row_id, id]);
      else await dbRun(`UPDATE conversations SET bound_table_id = ?, bound_row_id = ?, updated_at = datetime('now') WHERE id = ?`, [table_id, row_id, id]);
      const conversation = await dbGet(isPostgres() ? `SELECT * FROM conversations WHERE id = $1` : `SELECT * FROM conversations WHERE id = ?`, [id]);
      return success(res, conversation);
    } catch (err) {
      apiLogger.error('Error binding conversation:', err);
      return error(res, 'BIND_CONVERSATION_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/bind-lab - Bind to lab
  router.post('/conversations/:id/bind-lab', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { lab_id } = req.body;
      if (!lab_id) return badRequest(res, 'lab_id is required');
      if (isPostgres()) await dbRun(`UPDATE conversations SET lab_id = $1, updated_at = NOW() WHERE id = $2`, [lab_id, id]);
      else await dbRun(`UPDATE conversations SET lab_id = ?, updated_at = datetime('now') WHERE id = ?`, [lab_id, id]);
      const conversation = await dbGet(isPostgres() ? `SELECT * FROM conversations WHERE id = $1` : `SELECT * FROM conversations WHERE id = ?`, [id]);
      apiLogger.info({ conversationId: id, labId: lab_id }, 'Conversation bound to lab');
      return success(res, conversation);
    } catch (err) {
      apiLogger.error({ err }, 'Error binding conversation to lab');
      return error(res, 'BIND_LAB_ERROR', err.message, 500);
    }
  });

  // GET /labs/:labId/conversations - Get conversations for a lab
  router.get('/labs/:labId/conversations', requireAuth, async (req, res) => {
    try {
      const { labId } = req.params;
      const userId = req.user.userId;
      const { limit = 500, offset = 0 } = req.query;

      const conversations = await dbAll(
        isPostgres()
          ? `SELECT c.* FROM conversations c JOIN conversation_participants cp ON c.id = cp.conversation_id WHERE c.lab_id = $1 AND cp.user_id = $2 ORDER BY c.updated_at DESC LIMIT $3 OFFSET $4`
          : `SELECT c.* FROM conversations c JOIN conversation_participants cp ON c.id = cp.conversation_id WHERE c.lab_id = ? AND cp.user_id = ? ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
        [labId, userId, parseInt(limit), parseInt(offset)]
      );

      const conversationsWithParticipants = await Promise.all(
        conversations.map(async (conv) => {
          const participants = await dbAll(
            isPostgres()
              ? `SELECT cp.user_id, cp.role, u.name, u.email, COALESCE(u.avatar, '') as avatar_url FROM conversation_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.conversation_id = $1 ORDER BY cp.joined_at ASC`
              : `SELECT cp.user_id, cp.role, u.name, u.email FROM conversation_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.conversation_id = ? ORDER BY cp.joined_at ASC`,
            [conv.id]
          );
          return { ...conv, participants };
        })
      );

      return success(res, conversationsWithParticipants);
    } catch (err) {
      apiLogger.error({ err }, 'Error getting lab conversations');
      return error(res, 'GET_LAB_CONVERSATIONS_ERROR', err.message, 500);
    }
  });

  // PUT /conversations/:id/sub-agents - Update sub_agents
  router.put('/conversations/:id/sub-agents', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { sub_agents } = req.body;
      if (!Array.isArray(sub_agents)) return badRequest(res, 'sub_agents must be an array');

      let subAgentsJson = '[]';
      if (sub_agents.length > 0) {
        const validIds = await validateSubAgentRowIds(sub_agents);
        if (validIds.length === 0) return badRequest(res, 'None of the provided sub_agents row_ids are valid AI Agents');
        const normalizedSubAgents = sub_agents
          .map(item => { const rowId = typeof item === 'object' ? item.row_id : item; if (!validIds.includes(rowId)) return null; if (typeof item === 'object') return { row_id: item.row_id, response_mode: item.response_mode || 'always' }; return { row_id: item, response_mode: 'always' }; })
          .filter(Boolean);
        subAgentsJson = JSON.stringify(normalizedSubAgents);
      }

      if (isPostgres()) await dbRun(`UPDATE conversations SET sub_agents = $1::jsonb, updated_at = NOW() WHERE id = $2`, [subAgentsJson, id]);
      else await dbRun(`UPDATE conversations SET sub_agents = ?, updated_at = datetime('now') WHERE id = ?`, [subAgentsJson, id]);

      const enriched = await enrichSubAgents(JSON.parse(subAgentsJson));
      apiLogger.info({ conversationId: id, subAgentsCount: enriched.length }, 'Ticket #41053: Updated sub_agents');
      return success(res, { sub_agents: enriched });
    } catch (err) {
      apiLogger.error({ err }, 'Error updating sub_agents');
      return error(res, 'UPDATE_SUB_AGENTS_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/settings - Save chat settings
  router.post('/conversations/:id/settings', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const newSettings = req.body;
      const existing = await dbGet(isPostgres() ? `SELECT settings FROM conversations WHERE id = $1` : `SELECT settings FROM conversations WHERE id = ?`, [id]);
      let currentSettings = {};
      if (existing?.settings) { try { currentSettings = JSON.parse(existing.settings); } catch { /* ignore */ } }
      const merged = { ...currentSettings, ...newSettings };
      if (isPostgres()) await dbRun(`UPDATE conversations SET settings = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(merged), id]);
      else await dbRun(`UPDATE conversations SET settings = ?, updated_at = datetime('now') WHERE id = ?`, [JSON.stringify(merged), id]);
      return success(res, { saved: true });
    } catch (err) {
      apiLogger.error({ err }, 'Error saving settings');
      return error(res, 'SAVE_SETTINGS_ERROR', err.message, 500);
    }
  });

  // PATCH /conversations/:id/readonly — ADR-0068 WP-B (B3).
  // Toggle channel-style lock. Only the conversation creator OR space owner can
  // flip it. Owners always retain write access via sender_kind='space'; non-owners
  // see a read-only banner with a deep link to the comment thread (resolved on
  // the client via comment_thread_child_id in the list response).
  router.patch('/conversations/:id/readonly', requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return badRequest(res, 'invalid conversation id');
    }
    const desired = req.body?.is_readonly;
    if (typeof desired !== 'boolean') {
      return badRequest(res, 'is_readonly must be a boolean');
    }
    const userId = req.user.userId;
    try {
      const conv = await dbGet(
        isPostgres()
          ? `SELECT c.id, c.created_by, c.space_id, s.owner_id AS space_owner_id
               FROM conversations c LEFT JOIN spaces s ON s.id = c.space_id
              WHERE c.id = $1`
          : `SELECT c.id, c.created_by, c.space_id, s.owner_id AS space_owner_id
               FROM conversations c LEFT JOIN spaces s ON s.id = c.space_id
              WHERE c.id = ?`,
        [conversationId]
      );
      if (!conv) return notFound(res, 'Conversation not found');

      const isCreator = Number(conv.created_by) === Number(userId);
      const isSpaceOwner = conv.space_owner_id != null
        && Number(conv.space_owner_id) === Number(userId);
      if (!isCreator && !isSpaceOwner) {
        return error(res, 'FORBIDDEN', 'Only the conversation creator or space owner can toggle readonly', 403);
      }

      await dbRun(
        isPostgres()
          ? `UPDATE conversations SET is_readonly = $1, updated_at = NOW() WHERE id = $2`
          : `UPDATE conversations SET is_readonly = ?, updated_at = datetime('now') WHERE id = ?`,
        [desired, conversationId]
      );
      apiLogger.info({ conversationId, userId, desired }, 'ADR-0068 WP-B (B3): readonly toggled');
      return success(res, { id: conversationId, is_readonly: desired });
    } catch (err) {
      apiLogger.error({ err, conversationId }, 'ADR-0068 WP-B (B3): readonly toggle failed');
      return error(res, 'READONLY_TOGGLE_ERROR', err.message, 500);
    }
  });

  // PATCH /conversations/:id/settings - Update conversation settings
  router.patch('/conversations/:id/settings', requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!conversationId) return badRequest(res, 'Invalid conversation ID');
    try {
      const conv = await dbGet(isPostgres() ? 'SELECT id, settings FROM conversations WHERE id = $1' : 'SELECT id, settings FROM conversations WHERE id = ?', [conversationId]);
      if (!conv) return notFound(res, 'Conversation');
      const existingSettings = safeJsonParse(conv.settings, {});
      const mergedSettings = { ...existingSettings, ...req.body };
      const settingsJson = JSON.stringify(mergedSettings);
      await dbRun(isPostgres() ? 'UPDATE conversations SET settings = $1, updated_at = NOW() WHERE id = $2' : "UPDATE conversations SET settings = ?, updated_at = datetime('now') WHERE id = ?", [settingsJson, conversationId]);
      return success(res, { settings: mergedSettings });
    } catch (err) {
      apiLogger.error({ err, conversationId }, 'Error updating conversation settings');
      return error(res, 'SETTINGS_UPDATE_ERROR', err.message, 500);
    }
  });
}
