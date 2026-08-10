// backend/routes/v3/telegramNikitron/polling.js
// Agent triggering via HTTP and response polling/forwarding

import { apiLogger } from '../../../utils/logger.js';
import { dbGet, dbAll, isPostgres, safeJsonParse } from '../../../database/connection.js';
import { activeSessions } from './config.js';
import { sendMessage } from './shared.js';

export async function triggerAgentViaHttp(conversationId, content, adminUserId, attachments = []) {
  try {
    const baseUrl = process.env.INTERNAL_URL || 'http://localhost:' + (process.env.PORT || 5001);
    const { default: jwt } = await import('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      apiLogger.error('[NikitronBot] JWT_SECRET not set');
      return false;
    }
    const token = jwt.sign({ id: adminUserId, email: 'nikitron@godcrm.local' }, jwtSecret, { expiresIn: '1h' });

    const response = await fetch(`${baseUrl}/api/v3/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        content,
        content_type: 'text',
        agent_mode: 'agent',
        attachments,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      apiLogger.error({ status: response.status, body, conversationId }, '[NikitronBot] Agent trigger failed');
      return false;
    }
    return true;
  } catch (err) {
    apiLogger.error({ err, conversationId }, '[NikitronBot] Agent trigger error');
    return false;
  }
}

export async function pollAndForwardAgentResponse(chatId, conversationId, afterMessageId, maxRetries = 90) {
  const FAST_POLL_MS = 2000;
  const SLOW_POLL_MS = 5000;
  let processingWentFalse = false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const interval = attempt < 15 ? FAST_POLL_MS : SLOW_POLL_MS;
    await new Promise(resolve => setTimeout(resolve, interval));

    try {
      const conv = await dbGet(
        isPostgres()
          ? `SELECT is_processing FROM conversations WHERE id = $1`
          : `SELECT is_processing FROM conversations WHERE id = ?`,
        [conversationId]
      );

      const newMessages = await dbAll(
        isPostgres()
          ? `SELECT id, content, sender_type, role, metadata, created_at
             FROM messages
             WHERE conversation_id = $1 AND id > $2 AND role = 'assistant'
               AND content_type = 'text'
             ORDER BY id ASC`
          : `SELECT id, content, sender_type, role, metadata, created_at
             FROM messages
             WHERE conversation_id = ? AND id > ? AND role = 'assistant'
               AND content_type = 'text'
             ORDER BY id ASC`,
        [conversationId, afterMessageId]
      );

      if (newMessages.length > 0) {
        for (const msg of newMessages) {
          const metadata = safeJsonParse(msg.metadata, {});
          const agentName = metadata.agent_name || 'Agent';
          const text = (msg.content || '').trim();
          if (!text) continue;

          let displayText = text;
          if (displayText.length > 3900) {
            displayText = displayText.substring(0, 3900) + '\n\n... _(truncated)_';
          }

          await sendMessage(chatId, `*${agentName}:*\n\n${displayText}`);
        }

        const maxId = newMessages[newMessages.length - 1].id;
        const session = activeSessions.get(chatId);
        if (session) session.lastPolledMessageId = maxId;
        return true;
      }

      if (!conv?.is_processing) {
        if (processingWentFalse) return false;
        processingWentFalse = true;
      }
    } catch (err) {
      apiLogger.error({ err, conversationId, attempt }, '[NikitronBot] Poll error');
    }
  }

  // Timeout
  await sendMessage(chatId, 'Agent is taking longer than expected. Check CRM:\nhttps://devcrm.hltrn.cc/chat/' + conversationId);

  // Background follow-up (fire and forget)
  scheduleDelayedForward(chatId, conversationId, afterMessageId).catch(() => {});
  return false;
}

export async function scheduleDelayedForward(chatId, conversationId, afterMessageId) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const newMessages = await dbAll(
        isPostgres()
          ? `SELECT id, content, metadata FROM messages
             WHERE conversation_id = $1 AND id > $2 AND role = 'assistant' AND content_type = 'text'
             ORDER BY id ASC`
          : `SELECT id, content, metadata FROM messages
             WHERE conversation_id = ? AND id > ? AND role = 'assistant' AND content_type = 'text'
             ORDER BY id ASC`,
        [conversationId, afterMessageId]
      );

      if (newMessages.length > 0) {
        for (const msg of newMessages) {
          const metadata = safeJsonParse(msg.metadata, {});
          const text = (msg.content || '').trim();
          if (!text) continue;
          let displayText = text.length > 3900 ? text.substring(0, 3900) + '\n\n...' : text;
          await sendMessage(chatId, `*${metadata.agent_name || 'Agent'}* _(delayed):_\n\n${displayText}`);
        }
        const session = activeSessions.get(chatId);
        if (session) session.lastPolledMessageId = newMessages[newMessages.length - 1].id;
        return;
      }

      const conv = await dbGet(
        isPostgres()
          ? `SELECT is_processing FROM conversations WHERE id = $1`
          : `SELECT is_processing FROM conversations WHERE id = ?`,
        [conversationId]
      );
      if (!conv?.is_processing && i > 5) return;
    } catch (_) {}
  }
}
