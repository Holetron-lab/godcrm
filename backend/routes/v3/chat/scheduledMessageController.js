/**
 * Scheduled Messages Controller (WP-17)
 * CRUD for messages queued for future delivery.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, safeJsonParse, apiLogger,
  success, created, error, badRequest, notFound, forbidden,
  requireAuth,
} from './chatShared.js';
import { sendScheduledMessage } from '../../../services/ScheduledMessageWorker.js';

export default function registerScheduledMessageRoutes(router) {

  // POST /conversations/:id/scheduled-messages — Schedule a message
  router.post('/conversations/:id/scheduled-messages', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const { content, content_type = 'text', mentions = [], attachments = [], metadata = {}, scheduled_at } = req.body;

      if (!content || !scheduled_at) return badRequest(res, 'content and scheduled_at are required');

      const scheduledDate = new Date(scheduled_at);
      if (isNaN(scheduledDate.getTime())) return badRequest(res, 'Invalid scheduled_at date');
      if (scheduledDate.getTime() <= Date.now()) return badRequest(res, 'scheduled_at must be in the future');

      // Verify conversation exists and user is participant
      const participant = await dbGet(
        isPostgres()
          ? `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`
          : `SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`,
        [id, userId]
      );
      if (!participant) return notFound(res, 'Conversation not found');

      const mentionsJson = JSON.stringify(mentions);
      const attachmentsJson = JSON.stringify(attachments);
      const metadataJson = JSON.stringify(metadata);

      let result;
      if (isPostgres()) {
        result = await dbRun(
          `INSERT INTO scheduled_messages (conversation_id, sender_id, content, content_type, mentions, attachments, metadata, scheduled_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8) RETURNING id`,
          [id, userId, content, content_type, mentionsJson, attachmentsJson, metadataJson, scheduledDate.toISOString()]
        );
      } else {
        result = await dbRun(
          `INSERT INTO scheduled_messages (conversation_id, sender_id, content, content_type, mentions, attachments, metadata, scheduled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, userId, content, content_type, mentionsJson, attachmentsJson, metadataJson, scheduledDate.toISOString()]
        );
      }

      const row = await dbGet(
        isPostgres() ? `SELECT * FROM scheduled_messages WHERE id = $1` : `SELECT * FROM scheduled_messages WHERE id = ?`,
        [result.lastInsertRowid]
      );

      apiLogger.info({ conversationId: id, scheduledMessageId: row.id, scheduledAt: scheduled_at }, 'WP-17: Scheduled message created');
      return created(res, formatRow(row));
    } catch (err) {
      apiLogger.error({ err }, 'Error creating scheduled message');
      return error(res, 'SCHEDULE_MESSAGE_ERROR', err.message, 500);
    }
  });

  // GET /conversations/:id/scheduled-messages — List pending scheduled messages
  router.get('/conversations/:id/scheduled-messages', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const rows = await dbAll(
        isPostgres()
          ? `SELECT sm.*, u.name as sender_name, u.avatar as sender_avatar FROM scheduled_messages sm LEFT JOIN users u ON sm.sender_id = u.id WHERE sm.conversation_id = $1 AND sm.status = 'pending' ORDER BY sm.scheduled_at ASC`
          : `SELECT sm.*, u.name as sender_name, u.avatar as sender_avatar FROM scheduled_messages sm LEFT JOIN users u ON sm.sender_id = u.id WHERE sm.conversation_id = ? AND sm.status = 'pending' ORDER BY sm.scheduled_at ASC`,
        [id]
      );
      return success(res, { scheduled_messages: rows.map(formatRow) });
    } catch (err) {
      apiLogger.error({ err }, 'Error listing scheduled messages');
      return error(res, 'LIST_SCHEDULED_ERROR', err.message, 500);
    }
  });

  // PUT /scheduled-messages/:smId — Edit a pending scheduled message
  router.put('/scheduled-messages/:smId', requireAuth, async (req, res) => {
    try {
      const { smId } = req.params;
      const userId = req.user.userId;

      const existing = await dbGet(
        isPostgres() ? `SELECT * FROM scheduled_messages WHERE id = $1` : `SELECT * FROM scheduled_messages WHERE id = ?`,
        [smId]
      );
      if (!existing) return notFound(res, 'Scheduled message not found');
      if (existing.status !== 'pending') return badRequest(res, 'Can only edit pending messages');
      if (Number(existing.sender_id) !== Number(userId)) return forbidden(res, 'Can only edit your own scheduled messages');

      const { content, scheduled_at, mentions, attachments, metadata } = req.body;
      const updates = [];
      const params = [];
      let paramIdx = 1;

      if (content !== undefined) {
        updates.push(isPostgres() ? `content = $${paramIdx++}` : `content = ?`);
        params.push(content);
      }
      if (scheduled_at !== undefined) {
        const d = new Date(scheduled_at);
        if (isNaN(d.getTime())) return badRequest(res, 'Invalid scheduled_at');
        if (d.getTime() <= Date.now()) return badRequest(res, 'scheduled_at must be in the future');
        updates.push(isPostgres() ? `scheduled_at = $${paramIdx++}` : `scheduled_at = ?`);
        params.push(d.toISOString());
      }
      if (mentions !== undefined) {
        updates.push(isPostgres() ? `mentions = $${paramIdx++}::jsonb` : `mentions = ?`);
        params.push(JSON.stringify(mentions));
      }
      if (attachments !== undefined) {
        updates.push(isPostgres() ? `attachments = $${paramIdx++}::jsonb` : `attachments = ?`);
        params.push(JSON.stringify(attachments));
      }
      if (metadata !== undefined) {
        updates.push(isPostgres() ? `metadata = $${paramIdx++}::jsonb` : `metadata = ?`);
        params.push(JSON.stringify(metadata));
      }

      if (updates.length === 0) return badRequest(res, 'No fields to update');

      updates.push(isPostgres() ? `updated_at = NOW()` : `updated_at = datetime('now')`);
      params.push(smId);

      await dbRun(
        `UPDATE scheduled_messages SET ${updates.join(', ')} WHERE id = ${isPostgres() ? `$${paramIdx}` : '?'}`,
        params
      );

      const updated = await dbGet(
        isPostgres() ? `SELECT * FROM scheduled_messages WHERE id = $1` : `SELECT * FROM scheduled_messages WHERE id = ?`,
        [smId]
      );

      apiLogger.info({ scheduledMessageId: smId }, 'WP-17: Scheduled message updated');
      return success(res, formatRow(updated));
    } catch (err) {
      apiLogger.error({ err }, 'Error updating scheduled message');
      return error(res, 'UPDATE_SCHEDULED_ERROR', err.message, 500);
    }
  });

  // POST /scheduled-messages/:smId/send-now — Force immediate delivery of a pending scheduled message
  router.post('/scheduled-messages/:smId/send-now', requireAuth, async (req, res) => {
    try {
      const { smId } = req.params;
      const userId = req.user.userId;

      const existing = await dbGet(
        isPostgres() ? `SELECT * FROM scheduled_messages WHERE id = $1` : `SELECT * FROM scheduled_messages WHERE id = ?`,
        [smId]
      );
      if (!existing) return notFound(res, 'Scheduled message not found');
      if (Number(existing.sender_id) !== Number(userId)) return forbidden(res, 'Can only send your own scheduled messages');
      if (existing.status !== 'pending') {
        return error(res, 'already_processed', `Scheduled message already processed (status=${existing.status})`, 409);
      }

      // Reuse worker delivery path (insert message, parse mentions, trigger agents, mark sent)
      await sendScheduledMessage(existing);

      // Re-fetch to grab sent_message_id written by sendScheduledMessage
      const sent = await dbGet(
        isPostgres() ? `SELECT sent_message_id FROM scheduled_messages WHERE id = $1` : `SELECT sent_message_id FROM scheduled_messages WHERE id = ?`,
        [smId]
      );

      apiLogger.info({ scheduledMessageId: smId, messageId: sent?.sent_message_id }, 'WP-17: Scheduled message force-sent via send-now');
      return success(res, {
        sent: true,
        message_id: sent?.sent_message_id ? Number(sent.sent_message_id) : null,
        scheduled_message_id: Number(smId),
      });
    } catch (err) {
      apiLogger.error({ err, scheduledMessageId: req.params.smId }, 'Error force-sending scheduled message');
      // Worker has its own try/catch around sendScheduledMessage in tick(), but here we propagate
      return error(res, 'SEND_NOW_ERROR', err.message, 500);
    }
  });

  // DELETE /scheduled-messages/:smId — Cancel a pending scheduled message
  router.delete('/scheduled-messages/:smId', requireAuth, async (req, res) => {
    try {
      const { smId } = req.params;
      const userId = req.user.userId;

      const existing = await dbGet(
        isPostgres() ? `SELECT * FROM scheduled_messages WHERE id = $1` : `SELECT * FROM scheduled_messages WHERE id = ?`,
        [smId]
      );
      if (!existing) return notFound(res, 'Scheduled message not found');
      if (existing.status !== 'pending') return badRequest(res, 'Can only cancel pending messages');
      if (Number(existing.sender_id) !== Number(userId)) return forbidden(res, 'Can only cancel your own scheduled messages');

      await dbRun(
        isPostgres()
          ? `UPDATE scheduled_messages SET status = 'cancelled', updated_at = NOW() WHERE id = $1`
          : `UPDATE scheduled_messages SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`,
        [smId]
      );

      apiLogger.info({ scheduledMessageId: smId }, 'WP-17: Scheduled message cancelled');
      return success(res, { cancelled: true, id: Number(smId) });
    } catch (err) {
      apiLogger.error({ err }, 'Error cancelling scheduled message');
      return error(res, 'CANCEL_SCHEDULED_ERROR', err.message, 500);
    }
  });
}

function formatRow(row) {
  return {
    ...row,
    id: Number(row.id),
    conversation_id: Number(row.conversation_id),
    sender_id: Number(row.sender_id),
    mentions: safeJsonParse(row.mentions) || [],
    attachments: safeJsonParse(row.attachments) || [],
    metadata: safeJsonParse(row.metadata) || {},
  };
}
