// backend/routes/v3/telegram/agentBridge.js
// CRM message sending, agent triggering via HTTP, and response polling/forwarding

import { apiLogger, sendMessage, dbRun, dbGet, dbAll, isPostgres, safeJsonParse } from './shared.js';
import { activeSessions } from './sessions.js';

/**
 * Send a message to a CRM conversation (as the admin user).
 * @param {number} conversationId
 * @param {number} senderId - CRM user ID
 * @param {string} content - Message text
 * @returns {Promise<number>} Message ID
 */
async function sendCrmMessage(conversationId, senderId, content, attachments = []) {
  const attachmentsJson = JSON.stringify(attachments);
  let result;
  if (isPostgres()) {
    result = await dbRun(`
      INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, metadata, created_at, updated_at)
      VALUES ($1, $2, 'human', 'user', $3, 'text', '[]'::jsonb, $4::jsonb, '{}'::jsonb, NOW(), NOW())
      RETURNING id
    `, [conversationId, senderId, content, attachmentsJson]);
  } else {
    result = await dbRun(`
      INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, metadata, created_at, updated_at)
      VALUES (?, ?, 'human', 'user', ?, 'text', '[]', ?, '{}', datetime('now'), datetime('now'))
    `, [conversationId, senderId, content, attachmentsJson]);
  }

  const messageId = result?.rows?.[0]?.id || result?.lastInsertRowid;

  // Update conversation timestamp
  if (isPostgres()) {
    await dbRun(`
      UPDATE conversations
      SET last_message_at = NOW(), last_message_preview = $1, updated_at = NOW()
      WHERE id = $2
    `, [content.substring(0, 200), conversationId]);
  } else {
    await dbRun(`
      UPDATE conversations
      SET last_message_at = datetime('now'), last_message_preview = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [content.substring(0, 200), conversationId]);
  }

  return messageId;
}

/**
 * Trigger agent response in a CRM conversation.
 * Calls the internal chat API endpoint to trigger the agent execution pipeline.
 *
 * We do this by calling the internal HTTP endpoint so all the agent execution
 * logic (AgentLoopService, tool resolution, etc.) is reused.
 */
async function triggerAgentViaHttp(conversationId, content, adminUserId, attachments = []) {
  try {
    const baseUrl = process.env.INTERNAL_URL || 'http://localhost:' + (process.env.PORT || 5001);

    // Get a valid JWT token for the admin user
    const { default: jwt } = await import('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET;
    const token = jwt.sign({ id: adminUserId, email: 'admin@godcrm.local' }, jwtSecret, { expiresIn: '1h' });

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
      apiLogger.error({ status: response.status, body, conversationId }, '[Telegram] Failed to trigger agent via HTTP');
      return false;
    }

    apiLogger.info({ conversationId }, '[Telegram] Agent triggered via HTTP');
    return true;
  } catch (err) {
    apiLogger.error({ err, conversationId }, '[Telegram] Error triggering agent via HTTP');
    return false;
  }
}

/**
 * Poll for agent responses in a conversation and send them to Telegram.
 * Checks for new messages from agents after a given message ID.
 * Uses fast polling for the first 15 attempts (every 2s), then slow polling (every 5s).
 * On timeout, sends a notification and starts a background follow-up poller.
 */
async function pollAndForwardAgentResponse(chatId, conversationId, afterMessageId, maxRetries = 90) {
  const FAST_POLL_MS = 2000;  // First 15 attempts: every 2s
  const SLOW_POLL_MS = 5000;  // After that: every 5s
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
            displayText = displayText.substring(0, 3900) + '\n\n... _(truncated, see full response in CRM)_';
          }

          const header = `🤖 *${agentName}:*\n\n`;
          await sendMessage(chatId, header + displayText);
        }

        const maxId = newMessages[newMessages.length - 1].id;
        const session = activeSessions.get(chatId);
        if (session) {
          session.lastPolledMessageId = maxId;
        }

        apiLogger.info({ conversationId, messageCount: newMessages.length }, '[Telegram] Forwarded agent responses');
        return true;
      }

      // If processing went false, give one more cycle to catch late writes
      if (!conv?.is_processing) {
        if (processingWentFalse) {
          // Already gave it an extra cycle, stop
          apiLogger.info({ conversationId, attempt }, '[Telegram] Processing complete, no new messages after grace period');
          return false;
        }
        processingWentFalse = true;
        // Continue to next iteration — one more chance
      }
    } catch (err) {
      apiLogger.error({ err, conversationId, attempt }, '[Telegram] Error polling for agent response');
    }
  }

  // Timeout — notify user and start background follow-up
  await sendMessage(chatId,
    '⏳ Agent is taking longer than expected. Check CRM for response:\n' +
    `https://devcrm.hltrn.cc/chat/${conversationId}`
  );

  // Fire-and-forget: background follow-up for 10 more minutes
  scheduleDelayedForward(chatId, conversationId, afterMessageId).catch(err => {
    apiLogger.error({ err, conversationId }, '[Telegram] Delayed forward failed');
  });

  return false;
}

/**
 * Background follow-up poller — catches agent responses that arrive after the timeout sentinel.
 * Runs for up to 10 minutes, polling every 10 seconds.
 */
async function scheduleDelayedForward(chatId, conversationId, afterMessageId) {
  const MAX_DELAYED_ATTEMPTS = 60;  // 60 x 10s = 10 minutes
  const DELAYED_POLL_MS = 10000;

  for (let i = 0; i < MAX_DELAYED_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, DELAYED_POLL_MS));

    try {
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
            displayText = displayText.substring(0, 3900) + '\n\n... _(truncated, see full response in CRM)_';
          }

          const header = `🤖 *${agentName}* _(delayed):_\n\n`;
          await sendMessage(chatId, header + displayText);
        }

        // Update session
        const maxId = newMessages[newMessages.length - 1].id;
        const session = activeSessions.get(chatId);
        if (session) {
          session.lastPolledMessageId = maxId;
        }

        apiLogger.info({ conversationId, messageCount: newMessages.length }, '[Telegram] Delayed forward: sent agent responses');
        return;
      }

      // Check if conversation is no longer processing (agent finished but no text response)
      const conv = await dbGet(
        isPostgres()
          ? `SELECT is_processing FROM conversations WHERE id = $1`
          : `SELECT is_processing FROM conversations WHERE id = ?`,
        [conversationId]
      );
      if (!conv?.is_processing && i > 5) {
        apiLogger.info({ conversationId }, '[Telegram] Delayed forward: processing complete, no response found');
        return;
      }
    } catch (err) {
      apiLogger.error({ err, conversationId, attempt: i }, '[Telegram] Delayed forward: poll error');
    }
  }

  apiLogger.warn({ conversationId }, '[Telegram] Delayed forward: exhausted all attempts');
}

export {
  sendCrmMessage,
  triggerAgentViaHttp,
  pollAndForwardAgentResponse,
  scheduleDelayedForward,
};
