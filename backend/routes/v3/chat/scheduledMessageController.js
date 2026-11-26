/**
 * Scheduled Messages Controller (WP-17)
 * CRUD for messages queued for future delivery.
 */

import {
  dbGet, isPostgres, apiLogger,
  success, created, error, notFound, forbidden,
  requireAuth,
} from './chatShared.js';
import { sendScheduledMessage } from '../../../services/ScheduledMessageWorker.js';
import {
  ScheduledMessageError, cancelScheduledMessage, createScheduledMessage,
  listScheduledMessages, setScheduledMessageStatus, updateScheduledMessage,
} from '../../../services/scheduled-messages/operations.js';

function respondError(res, err, fallbackCode, fallbackMessage) {
  if (err instanceof ScheduledMessageError) return error(res, err.code, err.message, err.statusCode);
  apiLogger.error({ err }, fallbackMessage);
  return error(res, fallbackCode, err.message, 500);
}

export default function registerScheduledMessageRoutes(router) {

  // POST /conversations/:id/scheduled-messages — Schedule a message
  router.post('/conversations/:id/scheduled-messages', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const metadata = req.body.metadata || {};
      const row = await createScheduledMessage({
        conversationId: id,
        input: req.body,
        author: {
          senderId: userId, senderType: 'human', agentId: null,
          defaultRole: 'user', metadata: JSON.stringify(metadata),
        },
      });
      apiLogger.info({ conversationId: id, scheduledMessageId: row.id, scheduledAt: row.scheduled_at }, 'WP-17: Scheduled message created');
      return created(res, row);
    } catch (err) {
      return respondError(res, err, 'SCHEDULE_MESSAGE_ERROR', 'Error creating scheduled message');
    }
  });

  // GET /conversations/:id/scheduled-messages — List pending and paused scheduled messages
  router.get('/conversations/:id/scheduled-messages', requireAuth, async (req, res) => {
    try {
      const rows = await listScheduledMessages(req.params.id, req.user.userId);
      return success(res, { scheduled_messages: rows });
    } catch (err) {
      return respondError(res, err, 'LIST_SCHEDULED_ERROR', 'Error listing scheduled messages');
    }
  });

  // PUT /scheduled-messages/:smId — Edit a pending scheduled message
  router.put('/scheduled-messages/:smId', requireAuth, async (req, res) => {
    try {
      const updated = await updateScheduledMessage(req.params.smId, req.user.userId, req.body);
      apiLogger.info({ scheduledMessageId: req.params.smId }, 'WP-17: Scheduled message updated');
      return success(res, updated);
    } catch (err) {
      return respondError(res, err, 'UPDATE_SCHEDULED_ERROR', 'Error updating scheduled message');
    }
  });

  // PATCH /scheduled-messages/:smId/status — Pause or resume a scheduled message
  router.patch('/scheduled-messages/:smId/status', requireAuth, async (req, res) => {
    try {
      const updated = await setScheduledMessageStatus(req.params.smId, req.user.userId, req.body.status);
      return success(res, updated);
    } catch (err) {
      return respondError(res, err, 'STATUS_SCHEDULED_ERROR', 'Error changing scheduled message status');
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

  // DELETE /scheduled-messages/:smId — Cancel a pending or paused scheduled message
  router.delete('/scheduled-messages/:smId', requireAuth, async (req, res) => {
    try {
      const result = await cancelScheduledMessage(req.params.smId, req.user.userId);
      apiLogger.info({ scheduledMessageId: req.params.smId }, 'WP-17: Scheduled message cancelled');
      return success(res, result);
    } catch (err) {
      return respondError(res, err, 'CANCEL_SCHEDULED_ERROR', 'Error cancelling scheduled message');
    }
  });
}
