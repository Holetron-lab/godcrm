/**
 * GET /api/v3/chat/conversations/:id/summary — ADR-0031 §Z / WP-24
 *
 * Lightweight read-only metadata endpoint used by the new ChatLinkCard
 * component (replaces MovedStubBubble + MovedFromBanner). Returns ONLY
 * conversation metadata — no messages, no settings — so the frontend can
 * cheaply render link cards in bulk without fanning out to the full
 * GET /conversations/:id endpoint (which loads up to 1000 messages).
 *
 * Response shape:
 *   {
 *     id, title, type,                      // string identity
 *     participants: [{id,name,avatar}],     // capped at 3
 *     participants_total: <int>,            // full count
 *     message_count: <int>,                 // non-deleted messages in conversation
 *     agent: {id,name,icon} | null,         // resolved from conversations.agent_id
 *     bound_row: {table_id,row_id,title} | null,
 *     icon: string,                         // from bound_table.icon when present
 *     deleted: false                        // (or true with stripped payload)
 *   }
 *
 * Soft-delete: conversations table does not (yet) carry an `is_deleted`
 * column, so we treat `settings.deleted=true` as the soft-delete signal
 * (forward-compatible). When set, response is { id, title, deleted: true }
 * with no other fields. A truly missing row → 404.
 *
 * Auth: caller must be a participant of the conversation. Mirrors the
 * access check used by GET /conversations/:id (conversation_participants
 * membership only — there is no separate space-membership table in this
 * schema; space membership is materialised as participant rows on creation).
 *
 * Avatar safety (memory: project_users_avatar_base64_mine): users.avatar may
 * contain multi-MB base64 data-URLs. Strip any avatar > 2048 chars to null,
 * otherwise mobile clients OOM when rendering many cards.
 */

import {
  dbGet, dbAll, safeJsonParse, apiLogger,
  success, error, notFound, forbidden,
  requireAuth,
} from './chatShared.js';

const AVATAR_MAX_BYTES = 2048;
const PARTICIPANTS_PREVIEW_CAP = 3;

function safeAvatar(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  if (raw.length === 0) return null;
  if (raw.length > AVATAR_MAX_BYTES) return null;
  return raw;
}

export default function registerConversationSummaryRoutes(router) {

  router.get('/conversations/:id/summary', requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return error(res, 'INVALID_ID', 'Invalid conversation id', 400);
    }

    try {
      const userId = req.user.userId;

      // 1. Fetch conversation core fields (incl. settings to detect soft-delete)
      const conv = await dbGet(
        `SELECT id, title, type, settings, agent_id, bound_table_id, bound_row_id, space_id, created_at
           FROM conversations WHERE id = $1`,
        [conversationId]
      );
      if (!conv) return notFound(res, 'Conversation not found');

      // 2. Soft-delete short-circuit. Read settings (text or jsonb) and look
      //    for { deleted: true }. When present, return the trimmed payload so
      //    the frontend renders "Чат удалён".
      const settings = safeJsonParse(conv.settings, {}) || {};
      if (settings && settings.deleted === true) {
        return success(res, {
          id: conv.id,
          title: conv.title || null,
          deleted: true,
        });
      }

      // 3. Access check — participant of the conversation. This mirrors
      //    GET /conversations/:id (the canonical read-side check). Admins
      //    aren't auto-granted here; if a use case needs admin override the
      //    parent route can wrap with that policy.
      const participant = await dbGet(
        `SELECT user_id FROM conversation_participants
          WHERE conversation_id = $1 AND user_id = $2`,
        [conversationId, userId]
      );
      if (!participant) {
        return forbidden(res, 'No access to this conversation');
      }

      // 4. Participants — cap to first N for the preview, plus full count.
      //    ORDER BY joined_at to keep the preview stable across calls.
      const participantsRaw = await dbAll(
        `SELECT cp.user_id AS id, u.name, u.avatar
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
          WHERE cp.conversation_id = $1
          ORDER BY cp.joined_at ASC, cp.user_id ASC
          LIMIT $2`,
        [conversationId, PARTICIPANTS_PREVIEW_CAP]
      );
      const participants = participantsRaw.map(p => ({
        id: p.id,
        name: p.name || null,
        avatar: safeAvatar(p.avatar),
      }));

      const totalRow = await dbGet(
        `SELECT COUNT(*)::int AS total
           FROM conversation_participants WHERE conversation_id = $1`,
        [conversationId]
      );
      const participants_total = Number(totalRow?.total || 0);

      // Message count — non-deleted messages in this conversation. Used by
      // <ChatLinkCard> footer ("X участников · Y сообщений").
      const msgCountRow = await dbGet(
        `SELECT COUNT(*)::int AS total
           FROM messages
          WHERE conversation_id = $1
            AND (is_deleted = 0 OR is_deleted IS NULL)`,
        [conversationId]
      );
      const message_count = Number(msgCountRow?.total || 0);

      // Unread count for the caller — mirrors the inbox list endpoint
      // (excludes thinking/tool/agent_status/plan internals).
      const unreadRow = await dbGet(
        `SELECT COUNT(*)::int AS total
           FROM messages m
           JOIN conversation_participants cp
             ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
          WHERE m.conversation_id = $1
            AND m.sender_id != $2
            AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
            AND (m.content_type IS NULL OR m.content_type NOT IN ('tool_call','tool_result','thinking','plan','agent_status'))`,
        [conversationId, userId]
      );
      const unread_count = Number(unreadRow?.total || 0);

      // 5. Agent — resolved from conversations.agent_id (a row in table_rows
      //    of the AI Agents table). icon defaults to null.
      let agent = null;
      if (conv.agent_id) {
        const agentRow = await dbGet(
          `SELECT id, data FROM table_rows WHERE id = $1`,
          [conv.agent_id]
        );
        if (agentRow) {
          const agentData = safeJsonParse(agentRow.data, {}) || {};
          agent = {
            id: agentRow.id,
            name: agentData.name || null,
            icon: agentData.icon || null,
          };
        }
      }

      // 6. Bound row — title resolved from common label fields on the row's
      //    JSONB data column (matches the projection used by the list endpoint).
      let bound_row = null;
      let icon = null;
      if (conv.bound_table_id && conv.bound_row_id) {
        const boundRow = await dbGet(
          `SELECT
              tr.id,
              COALESCE(tr.data->>'name', tr.data->>'title', tr.data->>'what',
                       tr.data->>'subject', tr.data->>'label',
                       '#' || tr.id::text) AS row_title,
              ut.icon AS table_icon,
              COALESCE(ut.display_name, ut.name) AS table_name
             FROM table_rows tr
             LEFT JOIN universal_tables ut ON ut.id = tr.table_id
            WHERE tr.table_id = $1 AND tr.id = $2
            LIMIT 1`,
          [conv.bound_table_id, conv.bound_row_id]
        );
        if (boundRow) {
          bound_row = {
            table_id: conv.bound_table_id,
            row_id: conv.bound_row_id,
            title: boundRow.row_title || null,
            table_name: boundRow.table_name || null,
          };
          icon = boundRow.table_icon || null;
        } else {
          // Row referenced but missing — surface the binding without a title.
          bound_row = {
            table_id: conv.bound_table_id,
            row_id: conv.bound_row_id,
            title: null,
            table_name: null,
          };
        }
      }

      return success(res, {
        id: conv.id,
        title: conv.title || null,
        type: conv.type || null,
        created_at: conv.created_at || null,
        participants,
        participants_total,
        message_count,
        unread_count,
        agent,
        bound_row,
        icon,
        deleted: false,
      });
    } catch (err) {
      apiLogger.error({ err, conversationId: req.params.id }, 'Error in GET /conversations/:id/summary');
      return error(res, 'CONVERSATION_SUMMARY_ERROR', err.message, 500);
    }
  });
}
