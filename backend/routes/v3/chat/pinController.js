// ADR-0068 WP-E — Pinned messages.
//
// Two idempotent endpoints for the PinnedBanner (📌 N закреплённых ▾) and
// the ⋮-menu pin toggle in MessageBubble. Both share one permission gate:
//
//   - group / channel chat (conversations.type IN ('group','channel')):
//       any conversation participant may pin/unpin.
//   - direct chat / DM (conversations.type = 'direct'):
//       only the conversation owner (conversations.created_by) may pin/unpin.
//       This mirrors the locked acceptance contract in T-159793.
//
// Soft cap: at most 50 pinned messages per conversation. The 51st POST
// returns 409 `{ error: 'pin_cap_reached', cap: 50 }`. Cap is checked AFTER
// idempotency — re-pinning an already-pinned message never trips the cap.

import {
  dbRun, dbGet, isPostgres, apiLogger,
  success, error, badRequest, notFound, forbidden,
  requireAuth,
} from './chatShared.js';

const PIN_CAP_PER_CONVERSATION = 50;

// Group/channel: participant gate. Direct: owner gate.
// Returns `{ ok: true, conversationId }` on success, or `{ ok: false, status, code, message }`
// on a 4xx. Centralizes the gate so POST and DELETE share it verbatim.
async function checkPinPermission({ messageId, userId }) {
  const message = await dbGet(
    isPostgres()
      ? `SELECT id, conversation_id, pinned_at FROM messages WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = 0)`
      : `SELECT id, conversation_id, pinned_at FROM messages WHERE id = ? AND (is_deleted IS NULL OR is_deleted = 0)`,
    [messageId]
  );
  if (!message) {
    return { ok: false, status: 404, code: 'MESSAGE_NOT_FOUND', message: 'Message not found' };
  }

  const conversation = await dbGet(
    isPostgres()
      ? `SELECT id, type, created_by FROM conversations WHERE id = $1`
      : `SELECT id, type, created_by FROM conversations WHERE id = ?`,
    [message.conversation_id]
  );
  if (!conversation) {
    return { ok: false, status: 404, code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' };
  }

  const isDirect = conversation.type === 'direct';
  if (isDirect) {
    if (Number(conversation.created_by) !== Number(userId)) {
      return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Only the chat owner can pin in a direct chat' };
    }
  } else {
    const participant = await dbGet(
      isPostgres()
        ? `SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`
        : `SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`,
      [conversation.id, userId]
    );
    if (!participant) {
      return { ok: false, status: 403, code: 'FORBIDDEN', message: 'No access to this conversation' };
    }
  }

  return { ok: true, message, conversation };
}

export default function registerPinRoutes(router) {

  // POST /messages/:id/pin — idempotent pin.
  // (Mounted under /api/v3/chat by index.js, so effective URL is
  //  /api/v3/chat/messages/:id/pin.)
  //
  // Already-pinned message → 200 with the current pinned_at (no UPDATE).
  // Otherwise → cap check, then UPDATE pinned_at = NOW().
  router.post('/messages/:id/pin', requireAuth, async (req, res) => {
    try {
      const messageId = Number(req.params.id);
      if (!Number.isFinite(messageId) || messageId <= 0) {
        return badRequest(res, 'Invalid message id');
      }
      const userId = req.user.userId;

      const gate = await checkPinPermission({ messageId, userId });
      if (!gate.ok) {
        if (gate.status === 404) return notFound(res, gate.message);
        if (gate.status === 403) return forbidden(res, gate.message);
        return error(res, gate.code, gate.message, gate.status);
      }

      // Idempotent: already pinned → return current pinned_at unchanged.
      if (gate.message.pinned_at) {
        return success(res, { id: gate.message.id, pinned_at: gate.message.pinned_at });
      }

      // Soft cap: count existing pinned messages in this conversation.
      const capRow = await dbGet(
        isPostgres()
          ? `SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = $1 AND pinned_at IS NOT NULL`
          : `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND pinned_at IS NOT NULL`,
        [gate.conversation.id]
      );
      const currentCount = Number(capRow?.n || 0);
      if (currentCount >= PIN_CAP_PER_CONVERSATION) {
        return res.status(409).json({
          success: false,
          error: 'pin_cap_reached',
          cap: PIN_CAP_PER_CONVERSATION,
          message: `Cannot pin more than ${PIN_CAP_PER_CONVERSATION} messages per conversation`,
        });
      }

      const updated = await dbGet(
        isPostgres()
          ? `UPDATE messages SET pinned_at = NOW() WHERE id = $1 RETURNING id, pinned_at`
          : `UPDATE messages SET pinned_at = datetime('now') WHERE id = ?`,
        [messageId]
      );

      // SQLite has no RETURNING — re-read.
      const result = updated && updated.pinned_at
        ? updated
        : await dbGet(
            isPostgres()
              ? `SELECT id, pinned_at FROM messages WHERE id = $1`
              : `SELECT id, pinned_at FROM messages WHERE id = ?`,
            [messageId]
          );

      apiLogger.info({ messageId, userId, conversationId: gate.conversation.id }, 'WP-E pinned message');
      return success(res, { id: result.id, pinned_at: result.pinned_at });
    } catch (err) {
      apiLogger.error({ err }, 'Error pinning message');
      return error(res, 'PIN_MESSAGE_ERROR', err.message, 500);
    }
  });

  // DELETE /messages/:id/pin — idempotent unpin.
  // (Mounted under /api/v3/chat by index.js → /api/v3/chat/messages/:id/pin.)
  //
  // Already-unpinned message → 200 with pinned_at: null.
  // Otherwise → UPDATE pinned_at = NULL.
  router.delete('/messages/:id/pin', requireAuth, async (req, res) => {
    try {
      const messageId = Number(req.params.id);
      if (!Number.isFinite(messageId) || messageId <= 0) {
        return badRequest(res, 'Invalid message id');
      }
      const userId = req.user.userId;

      const gate = await checkPinPermission({ messageId, userId });
      if (!gate.ok) {
        if (gate.status === 404) return notFound(res, gate.message);
        if (gate.status === 403) return forbidden(res, gate.message);
        return error(res, gate.code, gate.message, gate.status);
      }

      // Idempotent: already unpinned → no UPDATE.
      if (!gate.message.pinned_at) {
        return success(res, { id: gate.message.id, pinned_at: null });
      }

      await dbRun(
        isPostgres()
          ? `UPDATE messages SET pinned_at = NULL WHERE id = $1`
          : `UPDATE messages SET pinned_at = NULL WHERE id = ?`,
        [messageId]
      );

      apiLogger.info({ messageId, userId, conversationId: gate.conversation.id }, 'WP-E unpinned message');
      return success(res, { id: gate.message.id, pinned_at: null });
    } catch (err) {
      apiLogger.error({ err }, 'Error unpinning message');
      return error(res, 'UNPIN_MESSAGE_ERROR', err.message, 500);
    }
  });
}
