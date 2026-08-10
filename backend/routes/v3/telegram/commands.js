// backend/routes/v3/telegram/commands.js
// Bot commands: /start, /status, /help, /newchat, /endchat, /chats, /chat_ID
// Admin commands: /adduser, /removeuser, /users
// Auth: /myid, unregistered user handling

import { apiLogger, sendMessage, dbAll, isPostgres, safeJsonParse } from './shared.js';
import { ROOT_ADMIN_ID, userRegistry, saveUserRegistry, isAdmin, getUserInfo, getUserDisplayName } from './userRegistry.js';
import { activeSessions, crmUserIdCache, getCrmUserIdForTelegramUser, resolveAgent, restoreSessionFromDb, loadConversationSession, listRecentTelegramChats, createCrmConversation } from './sessions.js';

/** Handle /myid command. Always works, even for unregistered users. */
export async function handleMyId(chatId, userId, fromUser) {
  const userName = fromUser.first_name || fromUser.username || 'User';
  await sendMessage(chatId,
    `*Your Telegram Info:*\n\n` +
    `*ID:* \`${userId}\`\n` +
    `*Name:* ${userName}\n` +
    `*Username:* ${fromUser.username ? '@' + fromUser.username : '—'}\n` +
    `*Chat ID:* \`${chatId}\`\n\n` +
    '_Send this ID to the admin so they can add you with_ `/adduser`'
  );
}

/** Handle unregistered user access attempt. */
export async function handleUnregisteredUser(chatId, userId, fromUser) {
  const userName = fromUser.first_name || fromUser.username || 'User';
  apiLogger.warn({ userId, userName, username: fromUser.username }, '[Telegram] Unregistered user');
  await sendMessage(chatId,
    `👋 Привет, *${userName}*!\n\n` +
    'Этот бот приватный. Твой Telegram ID:\n\n' +
    `\`${userId}\`\n\n` +
    'Отправь этот ID администратору, чтобы он добавил тебя командой:\n' +
    `\`/adduser ${userId} ${userName} partner\`\n\n` +
    '_Или используй_ `/myid` _чтобы увидеть свой ID._'
  );

  // Also notify admin about the attempt
  const adminChatId = ROOT_ADMIN_ID;
  if (adminChatId !== chatId) {
    await sendMessage(adminChatId,
      `🔔 *Новый пользователь стучится в бот:*\n\n` +
      `*Имя:* ${userName}\n` +
      `*Username:* ${fromUser.username ? '@' + fromUser.username : '—'}\n` +
      `*ID:* \`${userId}\`\n\n` +
      `Добавить: \`/adduser ${userId} ${userName} partner\``
    );
  }
}

/** Handle /adduser command. */
export async function handleAddUser(chatId, userId, text) {
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '⛔ Только админ может добавлять пользователей.');
    return;
  }

  const currentUserName = getUserDisplayName(userId);
  const parts = text.split(/\s+/);
  if (parts.length < 4) {
    await sendMessage(chatId,
      '*Использование:*\n' +
      '`/adduser <telegram_id> <name> <role>`\n' +
      '`/adduser <telegram_id> <name> <role> <crm_user_id>`\n\n' +
      '*Роли:* admin, partner, viewer\n\n' +
      '*Пример:*\n' +
      '`/adduser 123456789 NIKITRON partner`\n' +
      '`/adduser 123456789 NIKITRON partner 2`'
    );
    return;
  }

  const targetId = parts[1];
  const targetName = parts[2];
  const targetRole = parts[3].toLowerCase();
  const targetCrmUserId = parts[4] ? parseInt(parts[4], 10) : null;

  if (!['admin', 'partner', 'viewer'].includes(targetRole)) {
    await sendMessage(chatId, '❌ Роль должна быть: admin, partner или viewer');
    return;
  }

  if (!/^\d+$/.test(targetId)) {
    await sendMessage(chatId, '❌ Telegram ID должен быть числом.');
    return;
  }

  const existed = userRegistry.has(targetId);
  userRegistry.set(targetId, {
    name: targetName,
    role: targetRole,
    crm_user_id: targetCrmUserId,
    added_at: new Date().toISOString(),
    added_by: currentUserName,
  });
  saveUserRegistry();

  // Clear CRM user cache for this user
  crmUserIdCache.delete(targetId);

  await sendMessage(chatId,
    `✅ Пользователь ${existed ? 'обновлён' : 'добавлен'}!\n\n` +
    `*Имя:* ${targetName}\n` +
    `*ID:* \`${targetId}\`\n` +
    `*Роль:* ${targetRole}\n` +
    (targetCrmUserId ? `*CRM User ID:* ${targetCrmUserId}\n` : '') +
    '\nТеперь этот пользователь может использовать бот.'
  );

  apiLogger.info({ targetId, targetName, targetRole, addedBy: currentUserName }, '[Telegram] User added/updated');
}

/** Handle /users command. */
export async function handleUsers(chatId, userId) {
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '⛔ Только админ может видеть список пользователей.');
    return;
  }

  let msg = '👥 *Авторизованные пользователи:*\n\n';
  const roleEmoji = { admin: '👑', partner: '🤝', viewer: '👁' };

  for (const [id, info] of userRegistry) {
    const emoji = roleEmoji[info.role] || '▪️';
    const isRoot = id === ROOT_ADMIN_ID ? ' _(root)_' : '';
    msg += `${emoji} *${info.name}*${isRoot}\n`;
    msg += `   ID: \`${id}\` | Role: ${info.role}`;
    if (info.crm_user_id) msg += ` | CRM: #${info.crm_user_id}`;
    msg += '\n\n';
  }

  msg += `Всего: ${userRegistry.size}\n`;
  msg += '`/adduser <id> <name> <role>` — добавить\n';
  msg += '`/removeuser <id>` — удалить';

  await sendMessage(chatId, msg);
}

/** Handle /removeuser command. */
export async function handleRemoveUser(chatId, userId, text) {
  if (!isAdmin(userId)) {
    await sendMessage(chatId, '⛔ Только админ может удалять пользователей.');
    return;
  }

  const currentUserName = getUserDisplayName(userId);
  const parts = text.split(/\s+/);
  if (parts.length < 2) {
    await sendMessage(chatId, '*Использование:* `/removeuser <telegram_id>`');
    return;
  }

  const targetId = parts[1];

  if (targetId === ROOT_ADMIN_ID) {
    await sendMessage(chatId, '❌ Нельзя удалить root-админа.');
    return;
  }

  if (!userRegistry.has(targetId)) {
    await sendMessage(chatId, `❌ Пользователь \`${targetId}\` не найден.`);
    return;
  }

  const removedUser = userRegistry.get(targetId);
  userRegistry.delete(targetId);
  crmUserIdCache.delete(targetId);
  saveUserRegistry();

  // Clear their session
  activeSessions.delete(targetId);

  await sendMessage(chatId,
    `✅ Пользователь *${removedUser.name}* (\`${targetId}\`) удалён.`
  );

  apiLogger.info({ targetId, removedName: removedUser.name, removedBy: currentUserName }, '[Telegram] User removed');
}

/** Handle /start command. */
export async function handleStart(chatId, userId) {
  const currentUserInfo = getUserInfo(userId);
  const currentUserName = getUserDisplayName(userId);
  const greeting = `Привет, *${currentUserName}*! (${currentUserInfo?.role || 'user'})`;
  let msg = `🤖 *GOD CRM Bot*\n${greeting}\n\n` +
    '*Life Pipeline:*\n' +
    '`/sprint` — Текущие задачи спринта\n' +
    '`/today` — Брифинг на сегодня\n' +
    '`/done <id>` — Завершить задачу\n' +
    '`/weight <кг>` — Записать вес\n' +
    '`/mood <1-10>` — Записать настроение\n' +
    '`/week` — Итоги недели\n' +
    '`/fortuna` — 🎡 Колесо Фортуны (перерыв) ✅+15 очков\n\n' +
    '*Chat Commands:*\n' +
    '`/newchat` — Start new chat (with Orchestrator)\n' +
    '`/newchat developer` — Start chat with specific agent\n' +
    '`/chats` — List recent chats\n' +
    '`/chat_72` — Switch to chat #72\n' +
    '`/endchat` — Close current chat\n\n' +
    '*After /newchat, just type your messages — no / needed!*\n' +
    '*Sessions persist across restarts — your chat is always there.*\n\n' +
    '*System:*\n' +
    '`/status` — System health\n' +
    '`/myid` — Your Telegram ID\n' +
    '`/help` — This message';

  if (isAdmin(userId)) {
    msg += '\n\n*Admin:*\n' +
      '`/users` — Список пользователей\n' +
      '`/adduser <id> <name> <role>` — Добавить\n' +
      '`/removeuser <id>` — Удалить';
  }

  await sendMessage(chatId, msg);
}

/** Handle /status command. */
export async function handleStatus(chatId, userId) {
  const currentUserInfo = getUserInfo(userId);
  const currentUserName = getUserDisplayName(userId);
  const mem = process.memoryUsage();
  const uptime = Math.floor(process.uptime());
  let session = activeSessions.get(chatId);
  // Try to restore from DB if not in memory
  if (!session) {
    session = await restoreSessionFromDb(chatId);
  }
  const sessionInfo = session
    ? `*Active chat:* #${session.conversationId} with ${session.agentName} (\`/chat_${session.conversationId}\`)`
    : '*Active chat:* None (use `/chats` to see recent)';

  await sendMessage(chatId,
    '📊 *System Status*\n\n' +
    `*User:* ${currentUserName} (${currentUserInfo?.role || '?'})\n` +
    `*Uptime:* ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n` +
    `*Memory:* ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB\n` +
    `*Registered users:* ${userRegistry.size}\n` +
    `${sessionInfo}\n` +
    `*Time:* ${new Date().toISOString()}`
  );
}

/** Handle /help command. */
export async function handleHelp(chatId, userId) {
  let msg = '🤖 *GOD CRM Bot — Help*\n\n' +
    '*🎯 Life Pipeline:*\n' +
    '`/sprint` — Текущие задачи спринта (по приоритету)\n' +
    '`/today` — Утренний брифинг (календарь + задачи + здоровье)\n' +
    '`/done <id>` — Завершить задачу по ID\n' +
    '`/weight <кг>` — Записать вес (напр. `/weight 75.5`)\n' +
    '`/mood <1-10>` — Записать настроение (напр. `/mood 7`)\n' +
    '`/week` — Итоги недели (прогресс + статистика)\n' +
    '`/fortune` (`/wheel`) — 🎡 Колесо Фортуны — случайная активность для перерыва\n\n' +
    '*💬 Chat Mode (recommended):*\n' +
    '`/newchat` — Start chat with Orchestrator\n' +
    '`/newchat developer` — Start chat with Developer Ralph\n' +
    '`/newchat frontend` — Start chat with Frontend Dev\n' +
    '`/newchat architect` — Start chat with Architect\n' +
    'After `/newchat`, just type normally — all messages go to the agent.\n\n' +
    '*📋 Session Management:*\n' +
    '`/chats` — List your recent chats\n' +
    '`/chat_72` — Switch to chat #72 (any ID)\n' +
    '`/endchat` — Close current chat\n' +
    'Sessions survive server restarts — your active chat is remembered.\n\n' +
    '*⚙️ System:*\n' +
    '`/status` — Health + active chat\n' +
    '`/myid` — Your Telegram ID\n' +
    '`/help` — This message';

  if (isAdmin(userId)) {
    msg += '\n\n*👑 Admin Commands:*\n' +
      '`/users` — Список авторизованных пользователей\n' +
      '`/adduser <id> <name> <role>` — Добавить пользователя\n' +
      '`/adduser <id> <name> <role> <crm_id>` — С привязкой к CRM\n' +
      '`/removeuser <id>` — Удалить пользователя\n' +
      '*Роли:* admin, partner, viewer';
  }

  await sendMessage(chatId, msg);
}

/** Handle /newchat command. */
export async function handleNewChat(chatId, userId, text) {
  const currentUserName = getUserDisplayName(userId);
  const parts = text.split(/\s+/);
  const agentSlug = parts[1] || 'orchestrator'; // default agent

  // Resolve agent
  const agent = await resolveAgent(agentSlug);
  if (!agent) {
    await sendMessage(chatId,
      `❌ Agent *${agentSlug}* not found.\n\n` +
      'Available: orchestrator, developer, frontend, architect, test-runner, frontend-qa'
    );
    return;
  }

  // Close existing session if any
  const existingSession = activeSessions.get(chatId);
  if (existingSession) {
    await sendMessage(chatId,
      `📋 Previous chat #${existingSession.conversationId} closed.`
    );
  }

  // Create CRM conversation (linked to this Telegram chatId for session restore)
  const crmUserId = await getCrmUserIdForTelegramUser(userId);
  const title = `Telegram: ${currentUserName} → ${agent.name} — ${new Date().toLocaleDateString('ru-RU')}`;
  const conversationId = await createCrmConversation(title, crmUserId, agent, chatId);

  // Store session
  activeSessions.set(chatId, {
    conversationId,
    agentUserId: agent.userId,
    agentName: agent.name,
    agentRowId: agent.rowId,
    lastPolledMessageId: 0,
    createdAt: new Date().toISOString(),
  });

  await sendMessage(chatId,
    `✅ *Chat started* with *${agent.name}*\n\n` +
    `Chat #${conversationId} (\`/chat_${conversationId}\`)\n` +
    `CRM: https://devcrm.hltrn.cc/chat/${conversationId}\n\n` +
    'Now just type your messages — no `/` needed.\n' +
    'Use `/endchat` to pause, `/chat_' + conversationId + '` to return later.'
  );

  apiLogger.info({ chatId, conversationId, agent: agent.name }, '[Telegram] New chat session created');
}

/** Handle /endchat command. */
export async function handleEndChat(chatId) {
  const session = activeSessions.get(chatId);
  if (!session) {
    await sendMessage(chatId, 'ℹ️ No active chat. Use `/newchat` to start one.');
    return;
  }

  const closedConvId = session.conversationId;
  const closedAgent = session.agentName;
  activeSessions.delete(chatId);
  await sendMessage(chatId,
    `✅ Chat #${closedConvId} with *${closedAgent}* closed.\n\n` +
    `Return anytime: \`/chat_${closedConvId}\`\n` +
    'Or `/newchat` to start a new chat, `/chats` to see all.'
  );
}

/** Handle /chats command. */
export async function handleChats(chatId) {
  const chats = await listRecentTelegramChats(10);
  const session = activeSessions.get(chatId);

  if (chats.length === 0) {
    await sendMessage(chatId, 'ℹ️ No chats yet. Use `/newchat` to start one.');
    return;
  }

  let msg = '📋 *Recent Chats:*\n\n';
  for (const chat of chats) {
    const isActive = session && session.conversationId === chat.id;
    const marker = isActive ? ' ← *active*' : '';
    const agent = chat.agent_name || 'Unknown';
    const preview = chat.last_message_preview
      ? chat.last_message_preview.substring(0, 50).replace(/\n/g, ' ')
      : '(empty)';
    msg += `${isActive ? '▶️' : '💬'} \`/chat_${chat.id}\` — *${agent}* (${chat.message_count} msgs)${marker}\n`;
    msg += `   _${preview}_\n\n`;
  }
  msg += 'Tap a `/chat_ID` to switch.';

  await sendMessage(chatId, msg);
}

/** Handle /chat_ID command (switch to existing conversation). */
export async function handleChatSwitch(chatId, targetConvId) {
  const session = await loadConversationSession(chatId, targetConvId);
  if (!session) {
    await sendMessage(chatId,
      `❌ Chat #${targetConvId} not found.\n\nUse \`/chats\` to see available chats.`
    );
    return;
  }

  await sendMessage(chatId,
    `✅ *Switched to Chat #${session.conversationId}*\n\n` +
    `*Agent:* ${session.agentName}\n` +
    `CRM: https://devcrm.hltrn.cc/chat/${session.conversationId}\n\n` +
    'Now just type your messages — they go to this chat.'
  );
}
