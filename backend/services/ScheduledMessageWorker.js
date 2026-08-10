/**
 * ScheduledMessageWorker (WP-17)
 * Polls scheduled_messages every 30s, sends due messages as regular chat messages.
 */

import { dbRun, dbGet, dbAll, isPostgres } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { executeAgentResponse } from '../routes/v3/chat/chatAgentExecution.js';
import { getAutoRespondAgents, shouldAutoRespondWithAI, getDefaultAgentForConversation } from '../routes/v3/chat/chatAgentAutoRespond.js';
import { conversationLock, parseInvocationMentions, parseInvocationCommands } from '../routes/v3/chat/chatShared.js';
import { resolveMentionedUser, resolveAgentUser, findAiAgentByCommand, autoJoinAgentToConversation } from '../routes/v3/chat/chatAgentHelpers.js';

let _interval = null;
const POLL_INTERVAL_MS = 30_000; // 30 seconds

export function startScheduledMessageWorker() {
  if (_interval) return; // already running
  _interval = setInterval(tick, POLL_INTERVAL_MS);
  apiLogger.info('WP-17: ScheduledMessageWorker started (every 30s)');
}

export function stopScheduledMessageWorker() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    apiLogger.info('WP-17: ScheduledMessageWorker stopped');
  }
}

async function tick() {
  try {
    // Find all pending messages whose scheduled_at has passed
    const dueMessages = await dbAll(
      isPostgres()
        ? `SELECT * FROM scheduled_messages WHERE status = 'pending' AND scheduled_at <= NOW() ORDER BY scheduled_at ASC LIMIT 50`
        : `SELECT * FROM scheduled_messages WHERE status = 'pending' AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC LIMIT 50`
    );

    if (dueMessages.length === 0) return;

    apiLogger.info({ count: dueMessages.length }, 'WP-17: Processing due scheduled messages');

    for (const sm of dueMessages) {
      try {
        await sendScheduledMessage(sm);
      } catch (err) {
        apiLogger.error({ err, scheduledMessageId: sm.id }, 'WP-17: Failed to send scheduled message');
        // Mark as failed
        await dbRun(
          isPostgres()
            ? `UPDATE scheduled_messages SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`
            : `UPDATE scheduled_messages SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?`,
          [err.message, sm.id]
        );
      }
    }
  } catch (err) {
    apiLogger.error({ err }, 'WP-17: ScheduledMessageWorker tick error');
  }
}

export async function sendScheduledMessage(sm) {
  const { id, conversation_id, sender_id, content, content_type, mentions, attachments, metadata } = sm;

  // Insert as a regular message
  let result;
  const mentionsVal = typeof mentions === 'string' ? mentions : JSON.stringify(mentions || []);
  const attachmentsVal = typeof attachments === 'string' ? attachments : JSON.stringify(attachments || []);
  const metaObj = typeof metadata === 'string' ? JSON.parse(metadata || '{}') : (metadata || {});
  metaObj.scheduled_message_id = id;
  const metadataVal = JSON.stringify(metaObj);

  if (isPostgres()) {
    result = await dbRun(
      `INSERT INTO messages (conversation_id, sender_id, role, content, content_type, mentions, attachments, metadata, created_at)
       VALUES ($1, $2, 'user', $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, NOW())`,
      [conversation_id, sender_id, content, content_type, mentionsVal, attachmentsVal, metadataVal]
    );
  } else {
    result = await dbRun(
      `INSERT INTO messages (conversation_id, sender_id, role, content, content_type, mentions, attachments, metadata, created_at)
       VALUES (?, ?, 'user', ?, ?, ?, ?, ?, datetime('now'))`,
      [conversation_id, sender_id, content, content_type, mentionsVal, attachmentsVal, metadataVal]
    );
  }

  const messageId = result.lastInsertRowid;

  // Update conversation timestamp
  await dbRun(
    isPostgres()
      ? `UPDATE conversations SET updated_at = NOW() WHERE id = $1`
      : `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
    [conversation_id]
  );

  // Mark scheduled message as sent
  await dbRun(
    isPostgres()
      ? `UPDATE scheduled_messages SET status = 'sent', sent_message_id = $1, updated_at = NOW() WHERE id = $2`
      : `UPDATE scheduled_messages SET status = 'sent', sent_message_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [messageId, id]
  );

  apiLogger.info({ scheduledMessageId: id, messageId, conversationId: conversation_id }, 'WP-17: Scheduled message sent');

  // Trigger agents — same logic as messageController (explicit mentions + auto-respond)
  try {
    const convId = Number(conversation_id);
    const convForSpaceId = await dbGet(isPostgres() ? `SELECT space_id FROM conversations WHERE id = $1` : `SELECT space_id FROM conversations WHERE id = ?`, [convId]);
    const spaceId = convForSpaceId?.space_id || null;

    // Parse explicit <<@slug>> and <</slug>> from content
    const agentMentions = [...new Set(parseInvocationMentions(content))];
    const rawCommands = parseInvocationCommands(content);
    const seenCommandSlugs = new Set();
    const agentCommands = [];
    for (const cmd of rawCommands) {
      if (!seenCommandSlugs.has(cmd.slug)) {
        seenCommandSlugs.add(cmd.slug);
        agentCommands.push(cmd);
      }
    }
    const commandSlugs = new Set(agentCommands.map(c => c.slug));
    const mentionsFiltered = agentMentions.filter(slug => !commandSlugs.has(slug));
    const hasExplicitTriggers = agentCommands.length > 0 || mentionsFiltered.length > 0;

    apiLogger.info({ scheduledMessageId: id, conversationId: convId, agentCommands, agentMentions, hasExplicitTriggers }, 'WP-17: Parsing scheduled message for agent triggers');

    if (hasExplicitTriggers) {
      let anyAgentResolved = false;

      for (const cmd of agentCommands) {
        const { slug } = cmd;
        let agent = await resolveAgentUser(slug, spaceId);
        if (!agent) agent = await findAiAgentByCommand(slug, spaceId);
        if (agent) {
          anyAgentResolved = true;
          if (agent.id) await autoJoinAgentToConversation(convId, agent.id, { source: 'command' });
          apiLogger.info({ conversationId: convId, slug, agentName: agent.name }, 'WP-17: Triggering /command agent from scheduled message');
          await conversationLock.withLock(convId, () =>
            executeAgentResponse(convId, agent, sender_id, { message_content: content, invocation_type: 'command' })
          );
        }
      }

      for (const slug of mentionsFiltered) {
        const resolved = await resolveMentionedUser(slug);
        if (resolved) {
          const { user: mentionedUser, isAgent } = resolved;
          anyAgentResolved = true;
          if (mentionedUser.id) await autoJoinAgentToConversation(convId, mentionedUser.id, { source: 'mention' });
          if (isAgent) {
            apiLogger.info({ conversationId: convId, slug, userName: mentionedUser.name }, 'WP-17: Triggering @mention agent from scheduled message');
            await conversationLock.withLock(convId, () =>
              executeAgentResponse(convId, mentionedUser, sender_id, { message_content: content, invocation_type: 'mention' })
            );
          }
        } else {
          const agent = await resolveAgentUser(slug, spaceId);
          if (agent) {
            anyAgentResolved = true;
            if (agent.id) await autoJoinAgentToConversation(convId, agent.id, { source: 'mention' });
            apiLogger.info({ conversationId: convId, slug, agentName: agent.name }, 'WP-17: @mention fallback to agent resolution from scheduled message');
            await conversationLock.withLock(convId, () =>
              executeAgentResponse(convId, agent, sender_id, { message_content: content, invocation_type: 'mention' })
            );
          }
        }
      }

      // If no explicit agents resolved, fall back to auto-respond
      if (!anyAgentResolved) {
        const autoRespondAgents = await getAutoRespondAgents(convId, sender_id, content);
        for (const agent of autoRespondAgents) {
          await conversationLock.withLock(convId, () =>
            executeAgentResponse(convId, agent, sender_id, { message_content: content })
          );
        }
      }
    } else {
      // No explicit triggers — use auto-respond logic
      const autoRespondAgents = await getAutoRespondAgents(convId, sender_id, content);
      if (autoRespondAgents.length > 0) {
        apiLogger.info({ conversationId: convId, agentCount: autoRespondAgents.length }, 'WP-17: Triggering auto-respond agents for scheduled message');
        for (const agent of autoRespondAgents) {
          await conversationLock.withLock(convId, () =>
            executeAgentResponse(convId, agent, sender_id, { message_content: content })
          );
        }
      } else {
        const autoRespond = await shouldAutoRespondWithAI(convId, sender_id);
        if (autoRespond) {
          const defaultAgent = await getDefaultAgentForConversation(convId);
          if (defaultAgent) {
            apiLogger.info({ conversationId: convId, agentName: defaultAgent.name }, 'WP-17: Triggering default agent for scheduled message');
            await conversationLock.withLock(convId, () =>
              executeAgentResponse(convId, defaultAgent, sender_id, { message_content: content })
            );
          }
        }
      }
    }
  } catch (agentErr) {
    apiLogger.error({ err: agentErr, scheduledMessageId: id, conversationId: conversation_id }, 'WP-17: Agent auto-respond failed for scheduled message');
  }

  return messageId;
}
