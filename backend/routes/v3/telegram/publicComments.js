// backend/routes/v3/telegram/publicComments.js
// Handles public discussion-group comments in the @godcrm linked supergroup.
// Skips user-registration gate, uses isolated per-comment CRM conversations,
// parses <<@slug>> via mention-parsers, falls back to keyword routing.
//
// Activation: set TELEGRAM_GODCRM_DISCUSSION_CHAT_ID in env to the discussion
// group's chat ID (negative integer). Until set, webhook.js logs incoming
// supergroup chat IDs so the operator can discover it.

import { apiLogger, dbAll, dbGet, dbRun, isPostgres, safeJsonParse } from './shared.js';
import { resolveAgent, createCrmConversation } from './sessions.js';
import { sendCrmMessage, triggerAgentViaHttp } from './agentBridge.js';
import { parseDelegations } from '../../../services/chat/mention-parsers.js';
import { getTgApi } from '../../../services/TelegramService.js';

const DEFAULT_FALLBACK_AGENT = 'marketer';

// Simple keyword-based fallback routing when no <<@slug>> is present.
// Order matters — first match wins. Marketer is the catch-all default.
const ROUTING_RULES = [
  { agent: 'architect',    keywords: ['архитектур', 'postgres', 'база данных', 'jsonb', 'схема', 'как устроено', 'database', 'почему row', 'структур'] },
  { agent: 'orchestrator', keywords: ['оркестр', 'процесс', 'workflow', 'агенты как', 'координ', 'агентский', 'агентов между'] },
  { agent: 'smith',        keywords: ['собрать сам', 'форкн', 'fork', 'diy', 'самому', 'плагин', 'кастомн', 'свой виджет', 'писать код'] },
];

function pickFallbackAgent(text) {
  if (!text) return DEFAULT_FALLBACK_AGENT;
  const lower = text.toLowerCase();
  for (const rule of ROUTING_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) return rule.agent;
  }
  return DEFAULT_FALLBACK_AGENT;
}

/**
 * Send a Telegram message that replies to a specific message_id.
 * Falls back to plain text if Markdown parse fails on the agent's output.
 */
async function sendTelegramReply(chatId, text, replyToMessageId) {
  const TG_API = await getTgApi();
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    reply_to_message_id: replyToMessageId,
    allow_sending_without_reply: true,
    disable_web_page_preview: true,
  };

  try {
    let resp = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = await resp.json();
    if (!data.ok && /can't parse/i.test(data.description || '')) {
      // Retry without Markdown parsing on parse failure
      apiLogger.warn({ chatId, description: data.description }, '[Telegram-Public] markdown parse failed, retrying as plain text');
      delete body.parse_mode;
      resp = await fetch(`${TG_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      data = await resp.json();
    }
    if (!data.ok) {
      apiLogger.error({ chatId, description: data.description, error_code: data.error_code }, '[Telegram-Public] sendTelegramReply failed');
    }
    return data.ok;
  } catch (err) {
    apiLogger.error({ err: err.message, chatId }, '[Telegram-Public] sendTelegramReply exception');
    return false;
  }
}

/**
 * Handle a comment in the @godcrm linked discussion group.
 * Each comment spawns a fresh isolated CRM conversation with the resolved agent —
 * no context bleed between random visitors.
 */
async function handlePublicComment(message, attachments = []) {
  const chatId = String(message.chat.id);
  const messageId = message.message_id;
  const text = (message.text || message.caption || '').trim();
  const fromUser = message.from || {};
  const userName = fromUser.first_name || fromUser.username || 'guest';
  const tgUserId = String(fromUser.id || '');

  if (!text) {
    apiLogger.debug({ chatId, messageId }, '[Telegram-Public] empty text — skip');
    return;
  }

  // Ignore the auto-forwarded channel post echo
  if (message.is_automatic_forward) {
    apiLogger.debug({ chatId, messageId }, '[Telegram-Public] auto-forward — skip');
    return;
  }
  // Ignore messages signed by a channel (anonymous channel admins)
  if (message.sender_chat) {
    apiLogger.debug({ chatId, messageId, senderChatId: message.sender_chat.id }, '[Telegram-Public] sender_chat — skip');
    return;
  }
  // Ignore bot's own messages (shouldn't normally fire — webhook filters earlier, but defensive)
  if (fromUser.is_bot) {
    apiLogger.debug({ chatId, messageId, userId: tgUserId }, '[Telegram-Public] bot author — skip');
    return;
  }

  // Parse <<@slug>> mentions
  const delegations = parseDelegations(text);
  let routedSlug;
  let routedByFallback = false;

  if (delegations.length > 0) {
    routedSlug = delegations[0];
  } else {
    routedSlug = pickFallbackAgent(text);
    routedByFallback = true;
  }

  apiLogger.info({
    chatId, messageId, tgUserId, userName, routedSlug, routedByFallback,
    textSample: text.substring(0, 120),
  }, '[Telegram-Public] routing comment');

  const agent = await resolveAgent(routedSlug);
  if (!agent) {
    apiLogger.warn({ routedSlug }, '[Telegram-Public] could not resolve agent slug');
    await sendTelegramReply(
      chatId,
      `агент \`<<@${routedSlug}>>\` не найден. зовите: \`<<@marketer>>\`, \`<<@architect>>\`, \`<<@orchestrator>>\`, \`<<@smith>>\``,
      messageId
    );
    return;
  }

  // Isolated per-comment CRM conversation
  const adminUserId = 1; // GERATRON — owns the conversation; agent is the responder
  const titleSnippet = text.substring(0, 60).replace(/\s+/g, ' ');
  const title = `[@godcrm public] ${userName}: ${titleSnippet}`;

  let conversationId;
  try {
    conversationId = await createCrmConversation(title, adminUserId, agent, null);
    const settings = {
      telegram_chat_id: chatId,
      telegram_message_id: messageId,
      telegram_public: true,
      telegram_user: { id: tgUserId, name: userName },
      reply_to_message_id: messageId,
    };
    if (isPostgres()) {
      await dbRun(`UPDATE conversations SET settings = $1::jsonb WHERE id = $2`, [JSON.stringify(settings), conversationId]);
    } else {
      await dbRun(`UPDATE conversations SET settings = ? WHERE id = ?`, [JSON.stringify(settings), conversationId]);
    }
  } catch (err) {
    apiLogger.error({ err: err.message, agent: routedSlug }, '[Telegram-Public] failed to create conversation');
    await sendTelegramReply(chatId, 'внутренняя ошибка, попробуйте через минуту', messageId);
    return;
  }

  // Strip <<@slug>> tokens from agent-facing text — agent shouldn't echo its own invocation
  const cleanText = text.replace(/<<@[a-z0-9_-]+>>/gi, '').trim();

  const framedContent = [
    `[public comment in @godcrm by ${userName}]`,
    routedByFallback ? `(no <<@slug>> in comment — routed to you via keyword fallback)` : null,
    ``,
    cleanText || text,
    ``,
    `---`,
    `INSTRUCTIONS: reply in 3-5 short lines in your character. lowercase casual russian, no long markdown sections, no trailing summaries. treat this as a single isolated public-thread question from a stranger. no prior context, no follow-up assumed. if the question clearly belongs to another agent (architect / orchestrator / smith / marketer), gently redirect with "лучше позвать <<@slug>>" instead of answering off-topic.`,
  ].filter(Boolean).join('\n');

  // triggerAgentViaHttp posts the user message AND triggers the agent loop —
  // do NOT call sendCrmMessage first or the message gets duplicated.
  const triggered = await triggerAgentViaHttp(conversationId, framedContent, adminUserId, attachments);
  if (!triggered) {
    apiLogger.warn({ conversationId, agent: routedSlug }, '[Telegram-Public] agent trigger failed, fallback insert');
    try {
      await sendCrmMessage(conversationId, adminUserId, framedContent, attachments);
    } catch (_) { /* best-effort */ }
    await sendTelegramReply(chatId, 'агент молчит, попробуйте позже', messageId);
    return;
  }

  await pollAndReplyAsComment(chatId, messageId, conversationId);
}

/**
 * Poll for agent response in the isolated conversation and reply
 * in the discussion thread via reply_to_message_id.
 */
async function pollAndReplyAsComment(telegramChatId, replyToMessageId, conversationId, maxRetries = 60) {
  const FAST_POLL_MS = 2500;
  const SLOW_POLL_MS = 5000;
  let processingWentFalse = false;

  // Baseline: highest message id at trigger time (= the user message we just inserted)
  const baseline = await dbGet(
    isPostgres()
      ? `SELECT id FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 1`
      : `SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`,
    [conversationId]
  );
  const afterId = baseline?.id || 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const interval = attempt < 15 ? FAST_POLL_MS : SLOW_POLL_MS;
    await new Promise(r => setTimeout(r, interval));

    try {
      const conv = await dbGet(
        isPostgres()
          ? `SELECT is_processing FROM conversations WHERE id = $1`
          : `SELECT is_processing FROM conversations WHERE id = ?`,
        [conversationId]
      );

      const newMessages = await dbAll(
        isPostgres()
          ? `SELECT id, content, metadata FROM messages
             WHERE conversation_id = $1 AND id > $2 AND role = 'assistant' AND content_type = 'text'
             ORDER BY id ASC`
          : `SELECT id, content, metadata FROM messages
             WHERE conversation_id = ? AND id > ? AND role = 'assistant' AND content_type = 'text'
             ORDER BY id ASC`,
        [conversationId, afterId]
      );

      if (newMessages.length > 0) {
        for (const msg of newMessages) {
          const text = (msg.content || '').trim();
          if (!text) continue;
          const metadata = safeJsonParse(msg.metadata, {});
          const agentName = metadata.agent_name || 'agent';

          let displayText = text;
          if (displayText.length > 3800) {
            displayText = displayText.substring(0, 3800) + '\n\n_(обрезано)_';
          }

          await sendTelegramReply(
            telegramChatId,
            `🤖 *${agentName}*\n\n${displayText}`,
            replyToMessageId
          );
        }
        apiLogger.info({
          conversationId, telegramChatId, replyToMessageId, count: newMessages.length,
        }, '[Telegram-Public] replied to comment');
        return true;
      }

      // Grace period: if processing flips to false, give one more cycle for late writes
      if (!conv?.is_processing) {
        if (processingWentFalse) {
          apiLogger.info({ conversationId }, '[Telegram-Public] processing complete, no agent response');
          return false;
        }
        processingWentFalse = true;
      }
    } catch (err) {
      apiLogger.error({ err: err.message, conversationId, attempt }, '[Telegram-Public] poll error');
    }
  }

  apiLogger.warn({ conversationId }, '[Telegram-Public] poll timeout');
  return false;
}

export { handlePublicComment };
