// backend/routes/v3/telegram/webhook.js
// POST /webhook — receives updates from Telegram Bot API and routes to handlers

import { apiLogger, sendMessage, getFileUrl, parseAgentCommand, ChainHandoffService, dbGet, isPostgres, spinFortuneWheel } from './shared.js';
import { isRegisteredUser } from './userRegistry.js';
import { activeSessions, getCrmUserIdForTelegramUser, restoreSessionFromDb } from './sessions.js';
import { sendCrmMessage, triggerAgentViaHttp, pollAndForwardAgentResponse } from './agentBridge.js';
import { handlePublicComment } from './publicComments.js';
import { handleClubMessage, CLUB_CHAT_ID } from './clubRouter.js';
import {
  handleMyId, handleUnregisteredUser,
  handleAddUser, handleUsers, handleRemoveUser,
  handleStart, handleStatus, handleHelp,
  handleNewChat, handleEndChat, handleChats, handleChatSwitch,
} from './commands.js';
import { handleSprint, handleToday, handleDone, handleWeight, handleMood } from './lifePipeline.js';
import { handleWeek, handleFortuna } from './weeklyFortuna.js';
import { getSecret } from '../../../services/secrets/getSecret.js';

// @godcrm linked discussion group. Set TELEGRAM_GODCRM_DISCUSSION_CHAT_ID
// in env to activate the public-comment capkan. Until set, supergroup
// messages from non-AUTISM-TEAM chats are logged so the operator can
// discover the ID and add it.
const GODCRM_DISCUSSION_CHAT_ID = process.env.TELEGRAM_GODCRM_DISCUSSION_CHAT_ID || null;
const AUTISM_TEAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID || '-1002668749408';

/**
 * Register webhook route on the given router.
 * POST /api/v3/telegram/webhook
 * Receives updates from Telegram Bot API
 * NO authentication — Telegram sends updates directly
 * Security: only processes messages from registered users
 */
export default function registerWebhook(router) {
  router.post('/webhook', async (req, res) => {
    // Telegram expects 200 OK immediately to avoid retries
    res.status(200).json({ ok: true });

    try {
      const update = req.body;

      // ===== CALLBACK QUERY — inline button presses =====
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
        return;
      }

      const message = update.message;

      // Accept text, photo, document, voice, video messages
      if (!message) return;
      const hasContent = message.text || message.caption || message.photo || message.document || message.voice || message.video;
      if (!hasContent) return;

      const chatId = String(message.chat.id);
      const userId = String(message.from.id);
      const text = (message.text || message.caption || '').trim();

      // Extract media attachments from Telegram message
      const telegramAttachments = await extractAttachments(message);

      const fromUser = message.from;
      const userName = fromUser.first_name || fromUser.username || 'User';

      apiLogger.info({ chatId, userId, userName, text: text.substring(0, 100), attachmentCount: telegramAttachments.length }, '[Telegram] Received message');

      // ===== /myid — Always works, even for unregistered users =====
      if (text === '/myid') {
        await handleMyId(chatId, userId, fromUser);
        return;
      }

      // ===== PUBLIC CAPKAN: @godcrm discussion-group comments =====
      // Triggered before the registered-user gate so random visitors can
      // invoke agents via <<@slug>>. Only fires for the configured discussion
      // group; everything else is gated normally.
      const chatType = message.chat?.type;
      const isGroupChat = chatType === 'supergroup' || chatType === 'group';
      if (isGroupChat) {
        // ===== ANTI-MARKETING MARKETING CLUB: internal staging group =====
        // Owner posts into forum topics here; clubRouter auto-translates 🍳
        // kitchen posts to the channels and swallows everything else (so the
        // bot never spams "no active chat" into the staging group).
        if (chatId === String(CLUB_CHAT_ID)) {
          await handleClubMessage(message);
          return;
        }
        if (GODCRM_DISCUSSION_CHAT_ID && chatId === String(GODCRM_DISCUSSION_CHAT_ID)) {
          await handlePublicComment(message, telegramAttachments);
          return;
        }
        // Discovery aid: log unknown supergroup chat IDs so the operator can
        // identify the @godcrm discussion group and configure the env var.
        // The AUTISM TEAM group (forum topics) is suppressed from logging.
        if (chatId !== String(AUTISM_TEAM_GROUP_CHAT_ID)) {
          apiLogger.info({
            chatId,
            chatType,
            chatTitle: message.chat?.title,
            chatUsername: message.chat?.username,
            userId,
            userName,
            textSample: text.substring(0, 80),
            hint: 'set TELEGRAM_GODCRM_DISCUSSION_CHAT_ID to this chatId to enable capkan',
          }, '[Telegram] Unknown group chat — discovery log');
        }
        // Fall through to normal handling (AUTISM TEAM group commands still work
        // for registered admins; unknown groups will be rejected by the gate below).
      }

      // ===== SECURITY: Multi-user authorization =====
      if (!isRegisteredUser(userId)) {
        await handleUnregisteredUser(chatId, userId, fromUser);
        return;
      }

      // ===== ADMIN COMMANDS =====
      if (text.startsWith('/adduser')) { await handleAddUser(chatId, userId, text); return; }
      if (text === '/users') { await handleUsers(chatId, userId); return; }
      if (text.startsWith('/removeuser')) { await handleRemoveUser(chatId, userId, text); return; }

      // ===== BUILT-IN COMMANDS =====
      if (text === '/start') { await handleStart(chatId, userId); return; }
      if (text === '/status') { await handleStatus(chatId, userId); return; }
      if (text === '/help') { await handleHelp(chatId, userId); return; }

      // ===== CHAT COMMANDS =====
      if (text.startsWith('/newchat')) { await handleNewChat(chatId, userId, text); return; }
      if (text === '/endchat') { await handleEndChat(chatId); return; }
      if (text === '/chats') { await handleChats(chatId); return; }

      // /chat_ID — Switch to existing conversation
      const chatSwitchMatch = text.match(/^\/chat_(\d+)$/);
      if (chatSwitchMatch) {
        await handleChatSwitch(chatId, parseInt(chatSwitchMatch[1], 10));
        return;
      }

      // ===== LIFE PIPELINE QUICK COMMANDS =====
      if (text === '/sprint') { await handleSprint(chatId); return; }
      if (text === '/today') { await handleToday(chatId); return; }
      if (text.startsWith('/done')) { await handleDone(chatId, text); return; }
      if (text.startsWith('/weight')) { await handleWeight(chatId, text); return; }
      if (text.startsWith('/mood')) { await handleMood(chatId, text); return; }
      if (text === '/week') { await handleWeek(chatId); return; }
      if (text === '/fortuna' || text === '/fortune' || text === '/wheel') { await handleFortuna(chatId); return; }

      // ===== PLAIN TEXT / MEDIA -> ACTIVE CHAT (with auto-restore from DB) =====
      if (!text.startsWith('/')) {
        await handlePlainText(chatId, userId, text, telegramAttachments);
        return;
      }

      // ===== LEGACY: /agent_name text -> CREATE TICKET =====
      await handleLegacyAgentCommand(chatId, userId, text);

    } catch (err) {
      apiLogger.error({ err }, '[Telegram] Error processing webhook update');
    }
  });
}

/**
 * Handle callback queries (inline button presses).
 */
async function handleCallbackQuery(cb) {
  const cbChatId = String(cb.message?.chat?.id || cb.from.id);
  const cbUserId = String(cb.from.id);
  const cbData = cb.data || '';

  // Answer the callback to remove loading indicator
  try {
    // ADR-0040: vault first, env fallback during transition.
    const BOT_TOKEN_CB = (await getSecret('telegram_bot_token', 'TELEGRAM_BOT_TOKEN'))
      || '<TELEGRAM_BOT_TOKEN>';
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN_CB}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: cb.id })
    });
  } catch (_) {}

  if (cbData === 'fortuna_spin') {
    // /fortuna button pressed from group notification — spin the wheel and DM the result
    try {
      const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || '423753027';
      const targetChatId = cbUserId === adminChatId ? cbUserId : adminChatId;
      const { activity, message: fortuneMsg } = spinFortuneWheel();
      const inlineKeyboard = {
        reply_markup: JSON.stringify({
          inline_keyboard: [[
            { text: '✅ Сделал! +15 очков', callback_data: 'fortuna_done' },
            { text: '❌ Пропустить', callback_data: 'fortuna_skip' }
          ]]
        })
      };
      await sendMessage(targetChatId, fortuneMsg, inlineKeyboard);
      apiLogger.info({ userId: cbUserId, activity: activity.name }, '[Telegram] /fortuna button pressed from topic');
    } catch (err) {
      apiLogger.error({ err }, '[Telegram] fortuna_spin callback error');
    }
  } else if (cbData === 'fortuna_done') {
    // Award 15 points and confirm
    try {
      await sendMessage(cbChatId,
        `✅ *Отлично!* +15 очков!\n\n🎉 Так держать — каждый перерыв делает тебя продуктивнее!\n\n_Используй /fortuna снова в любой момент._`
      );
      apiLogger.info({ userId: cbUserId, chatId: cbChatId }, '[Telegram] /fortuna: task done, +15 points');
    } catch (err) {
      apiLogger.error({ err }, '[Telegram] fortuna_done callback error');
    }
  } else if (cbData === 'fortuna_skip') {
    await sendMessage(cbChatId, `⏭ Пропустил. Бывает! Попробуй в следующий раз 💪`);
  }
}

/**
 * Extract media attachments from a Telegram message.
 */
async function extractAttachments(message) {
  const attachments = [];

  if (message.photo && message.photo.length > 0) {
    // Get highest resolution photo (last in array)
    const photo = message.photo[message.photo.length - 1];
    const fileUrl = await getFileUrl(photo.file_id);
    if (fileUrl) {
      attachments.push({
        type: 'image',
        name: `photo_${photo.file_id}.jpg`,
        url: fileUrl,
        size: photo.file_size || 0,
        telegram_file_id: photo.file_id
      });
    }
  }
  if (message.document) {
    const fileUrl = await getFileUrl(message.document.file_id);
    if (fileUrl) {
      attachments.push({
        type: message.document.mime_type || 'file',
        name: message.document.file_name || `file_${message.document.file_id}`,
        url: fileUrl,
        size: message.document.file_size || 0,
        telegram_file_id: message.document.file_id
      });
    }
  }
  if (message.voice) {
    const fileUrl = await getFileUrl(message.voice.file_id);
    if (fileUrl) {
      attachments.push({
        type: 'voice',
        name: `voice_${message.voice.file_id}.ogg`,
        url: fileUrl,
        size: message.voice.file_size || 0,
        duration: message.voice.duration,
        telegram_file_id: message.voice.file_id
      });
    }
  }
  if (message.video) {
    const fileUrl = await getFileUrl(message.video.file_id);
    if (fileUrl) {
      attachments.push({
        type: 'video',
        name: message.video.file_name || `video_${message.video.file_id}.mp4`,
        url: fileUrl,
        size: message.video.file_size || 0,
        duration: message.video.duration,
        telegram_file_id: message.video.file_id
      });
    }
  }

  return attachments;
}

/**
 * Handle plain text / media messages -> route to active chat session.
 */
async function handlePlainText(chatId, userId, text, telegramAttachments) {
  let session = activeSessions.get(chatId);

  // Auto-restore from DB if no in-memory session
  if (!session) {
    session = await restoreSessionFromDb(chatId);
  }

  if (!session) {
    await sendMessage(chatId,
      '💡 No active chat. Start one first:\n' +
      '`/newchat` — Chat with Orchestrator\n' +
      '`/newchat developer` — Chat with Developer\n' +
      '`/chats` — Resume a previous chat\n\n' +
      'Or use legacy commands: `/orchestrator <task>`'
    );
    return;
  }

  // Build message content — use text if available, otherwise describe attachment(s)
  const messageContent = text || telegramAttachments.map(a => `[${a.type}: ${a.name}]`).join(' ') || '[empty message]';

  // Send message to CRM conversation via HTTP API (triggers full agent pipeline)
  const crmUserId = await getCrmUserIdForTelegramUser(userId);
  const triggered = await triggerAgentViaHttp(session.conversationId, messageContent, crmUserId, telegramAttachments);

  if (!triggered) {
    // Fallback: direct DB insert (won't trigger agent, but at least saves message)
    const msgId = await sendCrmMessage(session.conversationId, crmUserId, messageContent, telegramAttachments);
    await sendMessage(chatId,
      '⚠️ Message saved but agent trigger failed. Check CRM:\n' +
      `https://devcrm.hltrn.cc/chat/${session.conversationId}`
    );
    return;
  }

  // Get the message ID we just created (for polling)
  const lastMsg = await dbGet(
    isPostgres()
      ? `SELECT id FROM messages WHERE conversation_id = $1 AND role = 'user' ORDER BY id DESC LIMIT 1`
      : `SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1`,
    [session.conversationId]
  );
  const afterId = lastMsg?.id || session.lastPolledMessageId;

  // Send typing indicator
  try {
    const tgModule = await import('../../../services/TelegramService.js');
    const TG_API = tgModule.default?.TG_API || tgModule.TG_API;
    if (TG_API) {
      await fetch(`${TG_API}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      });
    }
  } catch (_) { /* ignore typing indicator errors */ }

  // Poll for agent response and forward to Telegram
  await pollAndForwardAgentResponse(chatId, session.conversationId, afterId);
}

/**
 * Handle legacy /agent_name text -> create ticket.
 */
async function handleLegacyAgentCommand(chatId, userId, text) {
  const command = parseAgentCommand(text);
  if (!command) {
    await sendMessage(chatId,
      '❓ Unknown command. Use `/help` for available commands.\n\n' +
      '💡 Tip: Use `/newchat` for interactive chat mode!'
    );
    return;
  }

  // Resolve agent user ID
  const agentUserId = ChainHandoffService.resolveAgentId(command.agent);

  if (!agentUserId) {
    await sendMessage(chatId, `❌ Agent *@${command.agent}* not found in system.`);
    return;
  }

  // If no message provided, just show agent status
  if (!command.message) {
    await sendMessage(chatId,
      `ℹ️ *@${command.agent}* is available.\n\n` +
      `Usage: \`/${command.agent} <task description>\`\n` +
      `💡 Or use \`/newchat ${command.agent}\` for interactive chat!`
    );
    return;
  }

  // Create a real ticket via ChainHandoffService (legacy behavior)
  try {
    const ticket = await ChainHandoffService.dispatchSubtask({
      what: `[Telegram] ${command.message}`,
      why: `Dispatched via Telegram by admin (user ${userId})`,
      assigned_to: agentUserId,
      dispatched_by: ChainHandoffService.AGENT_USERS.ORCHESTRATOR,
      priority: 24274,
      type: 24269,
    });

    const ticketId = ticket?.ticket_id || ticket?.id || 'unknown';

    await sendMessage(chatId,
      `✅ *Ticket #${ticketId}* created\n\n` +
      `*Agent:* @${command.agent}\n` +
      `*Task:* ${command.message}\n` +
      `*Status:* backlog → assigned\n\n` +
      `Track: https://devcrm.hltrn.cc/tables/1708\n\n` +
      `💡 Tip: Use \`/newchat ${command.agent}\` for interactive chat!`
    );

    apiLogger.info({ agent: command.agent, ticketId, message: command.message }, '[Telegram] Ticket created via agent command');
  } catch (dispatchErr) {
    apiLogger.error({ err: dispatchErr, agent: command.agent }, '[Telegram] Failed to dispatch ticket');

    await sendMessage(chatId,
      `⚠️ Routed to *@${command.agent}* (activity logged)\n\n` +
      `📝 _${command.message}_\n\n` +
      `Ticket creation failed: ${dispatchErr.message}\n` +
      `Command logged to activity. Agent will pick up manually.`
    );

    try {
      await ChainHandoffService.logActivity({
        action: 'telegram_command',
        agent_id: 'telegram-bot',
        details: {
          target_agent: command.agent,
          message: command.message,
          from_user: userId,
          error: dispatchErr.message,
        }
      });
    } catch (logErr) {
      apiLogger.error({ err: logErr }, '[Telegram] Failed to log activity');
    }
  }
}
