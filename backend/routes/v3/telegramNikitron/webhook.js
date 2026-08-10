// backend/routes/v3/telegramNikitron/webhook.js
// POST /webhook — main Telegram webhook handler

import { apiLogger } from '../../../utils/logger.js';
import { dbGet, isPostgres } from '../../../database/connection.js';
import ChainHandoffService from '../../../services/ChainHandoffService.js';
import { BOT_NAME, activeSessions } from './config.js';
import { getNikitronUserDisplayName } from './userRegistry.js';
import { sendMessage, sendTyping, isAuthorizedUser, extractAttachments } from './shared.js';
import {
  getCrmUserIdForTelegramUser, resolveAgent,
  restoreSessionFromDb, loadConversationSession,
  listRecentChats, createCrmConversation,
} from './crmHelpers.js';
import { triggerAgentViaHttp, pollAndForwardAgentResponse } from './polling.js';
import {
  handleStart, handleHelp, handleStatus,
  handleDice, handleJoke, handleTime, handleWhoami, handleEcho,
} from './commands.js';
import {
  handleSprint, handleToday, handleDone, handleWeight, handleMood, handleWeek,
} from './pipeline.js';

export default function registerWebhookRoutes(router) {
  router.post('/webhook', async (req, res) => {
    // Respond immediately to Telegram
    res.status(200).json({ ok: true });

    try {
      const update = req.body;
      const message = update.message;
      if (!message) return;

      const hasContent = message.text || message.caption || message.photo || message.document || message.voice || message.video;
      if (!hasContent) return;

      const chatId = String(message.chat.id);
      const userId = String(message.from.id);
      const text = (message.text || message.caption || '').trim();
      const userName = message.from.first_name || 'Nikitron';

      apiLogger.info({ chatId, userId, text: text.substring(0, 100) }, '[NikitronBot] Received message');

      // Security: only authorized users
      if (!isAuthorizedUser(userId)) {
        apiLogger.warn({ userId }, '[NikitronBot] Unauthorized user');
        await sendMessage(chatId, 'This bot is private.');
        return;
      }

      // Extract attachments for media messages
      const attachments = await extractAttachments(message);

      // ===== SYSTEM COMMANDS =====

      if (text === '/start') { await handleStart(chatId, userName); return; }
      if (text === '/help') { await handleHelp(chatId); return; }
      if (text === '/status') { await handleStatus(chatId); return; }

      // ===== FUN COMMANDS =====

      if (text === '/dice') { await handleDice(chatId); return; }
      if (text === '/joke') { await handleJoke(chatId); return; }
      if (text === '/time') { await handleTime(chatId); return; }
      if (text === '/whoami') { await handleWhoami(chatId, message); return; }
      if (text.startsWith('/echo')) { await handleEcho(chatId, text); return; }

      // ===== CHAT COMMANDS =====

      if (text.startsWith('/newchat')) {
        const parts = text.split(/\s+/);
        const agentSlug = parts[1] || 'orchestrator';

        const agent = await resolveAgent(agentSlug);
        if (!agent) {
          await sendMessage(chatId,
            `Agent *${agentSlug}* не найден.\n\n` +
            'Доступные: orchestrator, developer, frontend, architect, test-runner, frontend-qa'
          );
          return;
        }

        const existingSession = activeSessions.get(chatId);
        if (existingSession) {
          await sendMessage(chatId, `Предыдущий чат #${existingSession.conversationId} закрыт.`);
        }

        const senderCrmId = await getCrmUserIdForTelegramUser(userId, userName);
        const senderName = getNikitronUserDisplayName(userId);
        const title = `NikitronBot: ${agent.name} — ${senderName} — ${new Date().toLocaleDateString('ru-RU')}`;
        const conversationId = await createCrmConversation(title, senderCrmId, agent, chatId);

        activeSessions.set(chatId, {
          conversationId,
          agentUserId: agent.userId,
          agentName: agent.name,
          agentRowId: agent.rowId,
          lastPolledMessageId: 0,
          createdAt: new Date().toISOString(),
        });

        await sendMessage(chatId,
          `*Чат начат* с *${agent.name}*\n\n` +
          `Чат #${conversationId}\n` +
          `CRM: https://devcrm.hltrn.cc/chat/${conversationId}\n\n` +
          'Просто пиши сообщения — без /.\n' +
          '`/endchat` чтобы закрыть.'
        );
        return;
      }

      if (text === '/endchat') {
        const session = activeSessions.get(chatId);
        if (!session) {
          await sendMessage(chatId, 'Нет активного чата. Используй `/newchat`.');
          return;
        }
        const closedId = session.conversationId;
        const closedAgent = session.agentName;
        activeSessions.delete(chatId);
        await sendMessage(chatId,
          `Чат #${closedId} с *${closedAgent}* закрыт.\n\n` +
          `Вернуться: \`/chat_${closedId}\`\n` +
          'Новый: `/newchat`'
        );
        return;
      }

      if (text === '/chats') {
        const chats = await listRecentChats(10);
        const session = activeSessions.get(chatId);

        if (chats.length === 0) {
          await sendMessage(chatId, 'Нет чатов. Используй `/newchat`.');
          return;
        }

        let msg = '*Чаты:*\n\n';
        for (const chat of chats) {
          const isActive = session && session.conversationId === chat.id;
          const agent = chat.agent_name || 'Unknown';
          const preview = chat.last_message_preview ? chat.last_message_preview.substring(0, 50).replace(/\n/g, ' ') : '';
          msg += `${isActive ? '>' : '-'} \`/chat_${chat.id}\` — *${agent}* (${chat.message_count} msgs)${isActive ? ' *active*' : ''}\n`;
          if (preview) msg += `  _${preview}_\n`;
          msg += '\n';
        }
        msg += 'Нажми `/chat_ID` чтобы перейти.';
        await sendMessage(chatId, msg);
        return;
      }

      const chatSwitchMatch = text.match(/^\/chat_(\d+)$/);
      if (chatSwitchMatch) {
        const targetConvId = parseInt(chatSwitchMatch[1], 10);
        const session = await loadConversationSession(chatId, targetConvId);
        if (!session) {
          await sendMessage(chatId, `Чат #${targetConvId} не найден.\n\`/chats\` — список чатов.`);
          return;
        }
        await sendMessage(chatId,
          `*Переключено на чат #${session.conversationId}*\n\n` +
          `*Agent:* ${session.agentName}\n` +
          `CRM: https://devcrm.hltrn.cc/chat/${session.conversationId}\n\n` +
          'Пиши сообщения — они идут в этот чат.'
        );
        return;
      }

      // ===== SPRINT / LIFE PIPELINE =====

      if (text === '/sprint') { await handleSprint(chatId); return; }
      if (text === '/today') { await handleToday(chatId); return; }
      if (text.startsWith('/done')) { await handleDone(chatId, text); return; }
      if (text.startsWith('/weight')) { await handleWeight(chatId, text); return; }
      if (text.startsWith('/mood')) { await handleMood(chatId, text); return; }
      if (text === '/week') { await handleWeek(chatId); return; }

      // ===== PLAIN TEXT / MEDIA → ACTIVE CHAT =====

      if (!text.startsWith('/')) {
        let session = activeSessions.get(chatId) || await restoreSessionFromDb(chatId);

        if (!session) {
          await sendMessage(chatId,
            'Нет активного чата.\n\n' +
            '`/newchat` — начать чат с Orchestrator\n' +
            '`/newchat developer` — чат с Developer\n' +
            '`/chats` — предыдущие чаты'
          );
          return;
        }

        const messageContent = text || attachments.map(a => `[${a.type}: ${a.name}]`).join(' ') || '[empty]';
        const senderCrmId = await getCrmUserIdForTelegramUser(userId, userName);

        await sendTyping(chatId);

        const triggered = await triggerAgentViaHttp(session.conversationId, messageContent, senderCrmId, attachments);
        if (!triggered) {
          await sendMessage(chatId,
            'Сообщение сохранено, но агент не запустился. Проверь в CRM:\n' +
            `https://devcrm.hltrn.cc/chat/${session.conversationId}`
          );
          return;
        }

        // Get latest user message ID for polling
        const lastMsg = await dbGet(
          isPostgres()
            ? `SELECT id FROM messages WHERE conversation_id = $1 AND role = 'user' ORDER BY id DESC LIMIT 1`
            : `SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1`,
          [session.conversationId]
        );
        const afterId = lastMsg?.id || session.lastPolledMessageId;

        await pollAndForwardAgentResponse(chatId, session.conversationId, afterId);
        return;
      }

      // ===== LEGACY AGENT COMMANDS =====

      // /agent_name text → create ticket
      const match = text.match(/^\/([a-z][a-z0-9_-]*)\s*(.*)/s);
      if (match) {
        const rawAgent = match[1];
        const agentMessage = match[2] ? match[2].trim() : '';

        // Map underscore variants
        const aliases = { 'developer_ralph': 'developer-ralph', 'frontend_qa': 'frontend-qa', 'test_runner': 'test-runner' };
        const agentName = aliases[rawAgent] || rawAgent;

        const agentUserId = ChainHandoffService.resolveAgentId(agentName);
        if (!agentUserId) {
          await sendMessage(chatId, `Неизвестная команда: /${rawAgent}\n\`/help\` — справка`);
          return;
        }

        if (!agentMessage) {
          await sendMessage(chatId, `Agent *@${agentName}* доступен.\n\nИспользуй: \`/${rawAgent} <задача>\`\nИли: \`/newchat ${agentName}\` для интерактивного чата!`);
          return;
        }

        try {
          const ticket = await ChainHandoffService.dispatchSubtask({
            what: `[NikitronBot] ${agentMessage}`,
            why: `Via NikitronBot (user ${userId})`,
            assigned_to: agentUserId,
            dispatched_by: ChainHandoffService.AGENT_USERS.ORCHESTRATOR,
            priority: 24274,
            type: 24269,
          });

          const ticketId = ticket?.ticket_id || ticket?.id || 'unknown';
          await sendMessage(chatId,
            `*Ticket #${ticketId}* создан\n\n` +
            `*Agent:* @${agentName}\n` +
            `*Задача:* ${agentMessage}\n\n` +
            `Трек: https://devcrm.hltrn.cc/tables/1708`
          );
        } catch (err) {
          apiLogger.error({ err, agent: agentName }, '[NikitronBot] Ticket dispatch failed');
          await sendMessage(chatId,
            `Задача отправлена *@${agentName}* (но тикет не создался).\n\n_${agentMessage}_`
          );
        }
        return;
      }

      // Fallback
      await sendMessage(chatId, `Неизвестная команда.\n\`/help\` — справка`);

    } catch (err) {
      apiLogger.error({ err }, '[NikitronBot] Error processing webhook');
      // Don't crash — we already sent 200 OK
    }
  });
}
