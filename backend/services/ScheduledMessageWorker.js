import {
  dbRun, dbGet, dbAll, safeJsonParse, withTransactionAsync,
} from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { executeAgentResponse } from '../routes/v3/chat/chatAgentExecution.js';
import {
  getAutoRespondAgents, shouldAutoRespondWithAI, getDefaultAgentForConversation,
} from '../routes/v3/chat/chatAgentAutoRespond.js';
import { conversationLock, parseInvocationMentions } from '../routes/v3/chat/chatShared.js';
import { resolveMentionedUser, resolveAgentUser } from '../routes/v3/chat/chatAgentHelpers.js';
import {
  dispatchInvocationsFromContent, hasInvocationTokens,
} from './chat/invocation-dispatcher.js';
import { nextRun, minIntervalMinutes } from './scheduled-messages/recurrence.js';

const CONFIG = {
  pollIntervalMs: 30_000,
  maxAttempts: 3,
  retryBackoffMinutes: [1, 5, 15],
  replyCheckMinutes: 10,
  replyProcessingExtensionMinutes: 5,
  maxReplyRetries: 1,
  minCatchUpMs: 2 * 60_000,
  maxCatchUpMs: 2 * 60 * 60_000,
};

let _interval = null;
let _tickRunning = false;

export function startScheduledMessageWorker() {
  if (_interval) return;
  _interval = setInterval(tick, CONFIG.pollIntervalMs);
  apiLogger.info('WP-17: ScheduledMessageWorker started (every 30s)');
}

export function stopScheduledMessageWorker() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    apiLogger.info('WP-17: ScheduledMessageWorker stopped');
  }
}

export async function tick() {
  if (_tickRunning) return;
  _tickRunning = true;
  try {
    await processDueMessages();
    await processReplyChecks();
  } catch (err) {
    apiLogger.error({ err }, 'WP-17: ScheduledMessageWorker tick error');
  } finally {
    _tickRunning = false;
  }
}

async function processDueMessages() {
  const dueMessages = await dbAll(
    `SELECT * FROM scheduled_messages
     WHERE status = 'pending' AND scheduled_at <= NOW()
       AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
     ORDER BY scheduled_at ASC LIMIT 50`
  );
  if (dueMessages.length === 0) return;

  apiLogger.info({ count: dueMessages.length }, 'WP-17: Processing due scheduled messages');
  for (const sm of dueMessages) {
    try {
      if (await skipMissedRun(sm)) continue;
      await sendScheduledMessage(sm);
    } catch (err) {
      apiLogger.error({ err, scheduledMessageId: sm.id }, 'WP-17: Failed to send scheduled message');
      try {
        await recordDeliveryFailure(sm, err);
      } catch (failureErr) {
        apiLogger.error({ err: failureErr, scheduledMessageId: sm.id }, 'WP-17: Failed to record delivery failure');
      }
    }
  }
}

async function skipMissedRun(sm) {
  if (!sm.recurrence_cron) return false;
  const latenessMs = Date.now() - new Date(sm.scheduled_at).getTime();
  const periodMs = minIntervalMinutes(sm.recurrence_cron, sm.timezone) * 60_000;
  const catchUpMs = Math.min(CONFIG.maxCatchUpMs, Math.max(CONFIG.minCatchUpMs, periodMs / 2));
  if (latenessMs <= catchUpMs) return false;

  const followingRun = nextRun(sm.recurrence_cron, sm.timezone, new Date());
  await dbRun(
    `UPDATE scheduled_messages
     SET scheduled_at = ?, status = ?, error_message = 'skipped: missed window',
         attempts = 0, next_attempt_at = NULL, updated_at = NOW()
     WHERE id = ? AND status = 'pending'`,
    [followingRun?.toISOString() || sm.scheduled_at, followingRun ? 'pending' : 'sent', sm.id]
  );
  apiLogger.warn({ scheduledMessageId: sm.id, latenessMs, catchUpMs }, 'WP-17: Skipped missed recurring run');
  return true;
}

async function recordDeliveryFailure(sm, err) {
  const attempts = Number(sm.attempts || 0) + 1;
  if (attempts < CONFIG.maxAttempts) {
    const delayMinutes = CONFIG.retryBackoffMinutes[attempts - 1];
    await dbRun(
      `UPDATE scheduled_messages
       SET attempts = ?, next_attempt_at = NOW() + (? * INTERVAL '1 minute'),
           error_message = ?, updated_at = NOW()
       WHERE id = ?`,
      [attempts, delayMinutes, err.message, sm.id]
    );
    return;
  }

  if (!sm.recurrence_cron) {
    await dbRun(
      `UPDATE scheduled_messages
       SET status = 'failed', attempts = ?, next_attempt_at = NULL,
           error_message = ?, updated_at = NOW()
       WHERE id = ?`,
      [attempts, err.message, sm.id]
    );
    return;
  }

  const followingRun = nextRun(sm.recurrence_cron, sm.timezone, new Date());
  await dbRun(
    `UPDATE scheduled_messages
     SET status = ?, scheduled_at = ?, attempts = 0, next_attempt_at = NULL,
         error_message = ?, updated_at = NOW()
     WHERE id = ?`,
    [followingRun ? 'pending' : 'sent', followingRun?.toISOString() || sm.scheduled_at, `run failed: ${err.message}`, sm.id]
  );
}

export async function sendScheduledMessage(sm, { retryOf = null } = {}) {
  const delivered = await withTransactionAsync(async (trx) => {
    const current = await trx.get(
      `SELECT * FROM scheduled_messages
       WHERE id = ? ${retryOf === null ? "AND status = 'pending'" : "AND status IN ('pending', 'sent')"}
       FOR UPDATE`,
      [sm.id]
    );
    if (!current) return null;

    const isRetry = retryOf !== null;
    const runsDone = Number(current.runs_done || 0);
    const followingRun = !isRetry && current.recurrence_cron
      ? nextRun(current.recurrence_cron, current.timezone, new Date())
      : null;
    const metadata = safeJsonParse(current.metadata, {}) || {};
    metadata.scheduled_message_id = current.id;
    metadata.run_index = isRetry ? Math.max(1, runsDone) : runsDone + 1;
    if (isRetry) metadata.retry_of = retryOf;

    const mentions = typeof current.mentions === 'string'
      ? current.mentions
      : JSON.stringify(current.mentions || []);
    const attachments = typeof current.attachments === 'string'
      ? current.attachments
      : JSON.stringify(current.attachments || []);
    const agentId = current.agent_id ?? metadata.agent_row_id ?? null;

    const result = await trx.run(
      `INSERT INTO messages (
         conversation_id, sender_id, sender_type, role, agent_id,
         content, content_type, mentions, attachments, metadata, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW())`,
      [
        current.conversation_id, current.sender_id, current.sender_type || 'human',
        current.role || 'user', agentId, current.content, current.content_type || 'text',
        mentions, attachments, JSON.stringify(metadata),
      ]
    );
    const messageId = result.lastInsertRowid;

    await trx.run(`UPDATE conversations SET updated_at = NOW() WHERE id = ?`, [current.conversation_id]);

    if (isRetry) {
      await trx.run(
        `UPDATE scheduled_messages SET sent_message_id = ?, updated_at = NOW() WHERE id = ?`,
        [messageId, current.id]
      );
    } else if (current.recurrence_cron) {
      const completedRuns = runsDone + 1;
      const isComplete = (current.max_runs !== null && completedRuns >= Number(current.max_runs)) || !followingRun;
      await trx.run(
        `UPDATE scheduled_messages
         SET status = ?, runs_done = ?, last_fired_at = NOW(), sent_message_id = ?,
             scheduled_at = ?, attempts = 0, next_attempt_at = NULL, error_message = NULL,
             expect_reply_from = NULL, reply_check_at = NULL, reply_retries = 0, updated_at = NOW()
         WHERE id = ?`,
        [
          isComplete ? 'sent' : 'pending', completedRuns, messageId,
          followingRun?.toISOString() || current.scheduled_at, current.id,
        ]
      );
    } else {
      await trx.run(
        `UPDATE scheduled_messages
         SET status = 'sent', sent_message_id = ?, attempts = 0, next_attempt_at = NULL,
             error_message = NULL, expect_reply_from = NULL, reply_check_at = NULL,
             reply_retries = 0, updated_at = NOW()
         WHERE id = ?`,
        [messageId, current.id]
      );
    }

    return { messageId, row: current };
  });

  if (!delivered) return null;
  const { messageId, row } = delivered;
  apiLogger.info({ scheduledMessageId: row.id, messageId, conversationId: row.conversation_id }, 'WP-17: Scheduled message sent');

  try {
    await triggerScheduledAgents(row, messageId, retryOf === null);
  } catch (err) {
    apiLogger.error({ err, scheduledMessageId: row.id, conversationId: row.conversation_id }, 'WP-17: Agent trigger failed for scheduled message');
  }
  return messageId;
}

async function triggerScheduledAgents(row, messageId, scheduleReplyCheck) {
  const { id, conversation_id: conversationId, sender_id: senderId, content } = row;
  if (hasInvocationTokens(content)) {
    const conversation = await dbGet(`SELECT space_id FROM conversations WHERE id = ?`, [conversationId]);
    await dispatchInvocationsFromContent({
      conversationId: Number(conversationId),
      content,
      userId: senderId,
      spaceId: conversation?.space_id || null,
      sourceLabel: 'scheduled_message',
      sourceMessageId: messageId,
      sourceAgentId: row.agent_id || null,
    });
    if (scheduleReplyCheck) {
      const expectedAgentId = await resolveExpectedReplyAgent(content, conversation?.space_id || null);
      await dbRun(
        `UPDATE scheduled_messages
         SET expect_reply_from = ?, reply_check_at = CASE WHEN ?::integer IS NULL THEN NULL ELSE NOW() + (? * INTERVAL '1 minute') END,
             reply_retries = 0, metadata = ?, updated_at = NOW()
         WHERE id = ?`,
        [expectedAgentId, expectedAgentId, CONFIG.replyCheckMinutes, replyWaitMetadata(row, false), id]
      );
    }
    return;
  }

  const autoRespondAgents = await getAutoRespondAgents(Number(conversationId), senderId, content);
  for (const agent of autoRespondAgents) {
    await conversationLock.withLock(Number(conversationId), () =>
      executeAgentResponse(Number(conversationId), agent, senderId, { message_content: content, trigger_message_id: messageId })
    );
  }
  if (autoRespondAgents.length > 0) return;

  if (await shouldAutoRespondWithAI(Number(conversationId), senderId)) {
    const defaultAgent = await getDefaultAgentForConversation(Number(conversationId));
    if (defaultAgent) {
      await conversationLock.withLock(Number(conversationId), () =>
        executeAgentResponse(Number(conversationId), defaultAgent, senderId, { message_content: content, trigger_message_id: messageId })
      );
    }
  }
}

async function resolveExpectedReplyAgent(content, spaceId) {
  for (const slug of new Set(parseInvocationMentions(content))) {
    const resolved = await resolveMentionedUser(slug);
    const agent = resolved?.isAgent
      ? resolved.user
      : (!resolved ? await resolveAgentUser(slug, spaceId) : null);
    const agentRowId = agent?.managed_by_agent_row_id || agent?._agentConfig?.row_id;
    if (agentRowId) return Number(agentRowId);
  }
  return null;
}

async function processReplyChecks() {
  const rows = await dbAll(
    `SELECT * FROM scheduled_messages
     WHERE reply_check_at IS NOT NULL AND reply_check_at <= NOW()
       AND status IN ('pending', 'sent')
     ORDER BY reply_check_at ASC LIMIT 50`
  );
  for (const sm of rows) {
    try {
      await processReplyCheck(sm);
    } catch (err) {
      apiLogger.error({ err, scheduledMessageId: sm.id }, 'WP-17: Agent reply check failed');
    }
  }
}

async function processReplyCheck(sm) {
  const expectedAgentId = Number(sm.expect_reply_from);
  const reply = await dbGet(
    `SELECT id FROM messages
     WHERE conversation_id = ? AND id > ? AND sender_type = 'agent'
       AND (agent_id = ? OR metadata->>'agent_row_id' = ?)
     ORDER BY id ASC LIMIT 1`,
    [sm.conversation_id, sm.sent_message_id, expectedAgentId, String(expectedAgentId)]
  );
  if (reply) {
    await dbRun(
      `UPDATE scheduled_messages
       SET reply_check_at = NULL, reply_retries = 0, error_message = NULL, metadata = ?, updated_at = NOW()
       WHERE id = ?`,
      [replyWaitMetadata(sm, false), sm.id]
    );
    return;
  }

  const conversation = await dbGet(
    `SELECT is_processing, processing_agent_id FROM conversations WHERE id = ?`,
    [sm.conversation_id]
  );
  const metadata = safeJsonParse(sm.metadata, {}) || {};
  const isExpectedAgentProcessing = conversation?.is_processing
    && Number(conversation.processing_agent_id) === expectedAgentId;
  if (isExpectedAgentProcessing && !metadata.reply_wait_extended) {
    await dbRun(
      `UPDATE scheduled_messages
       SET reply_check_at = NOW() + (? * INTERVAL '1 minute'), metadata = ?, updated_at = NOW()
       WHERE id = ?`,
      [CONFIG.replyProcessingExtensionMinutes, replyWaitMetadata(sm, true), sm.id]
    );
    return;
  }

  if (Number(sm.reply_retries || 0) < CONFIG.maxReplyRetries) {
    const retryMessageId = await sendScheduledMessage(sm, { retryOf: sm.sent_message_id });
    if (retryMessageId === null) throw new Error('Scheduled message disappeared before reply retry');
    await dbRun(
      `UPDATE scheduled_messages
       SET sent_message_id = ?, reply_retries = reply_retries + 1,
           reply_check_at = NOW() + (? * INTERVAL '1 minute'), error_message = NULL,
           metadata = ?, updated_at = NOW()
       WHERE id = ?`,
      [retryMessageId, CONFIG.replyCheckMinutes, replyWaitMetadata(sm, false), sm.id]
    );
    return;
  }

  await dbRun(
    `UPDATE scheduled_messages
     SET reply_check_at = NULL, error_message = 'no agent reply after retry',
         metadata = ?, updated_at = NOW()
     WHERE id = ?`,
    [replyWaitMetadata(sm, false), sm.id]
  );
}

function replyWaitMetadata(sm, extended) {
  const metadata = safeJsonParse(sm.metadata, {}) || {};
  if (extended) metadata.reply_wait_extended = true;
  else delete metadata.reply_wait_extended;
  return JSON.stringify(metadata);
}
