// backend/routes/v3/telegramNikitron/commands.js
// Command handlers: system and fun commands

import { BOT_NAME, JOKES, activeSessions } from './config.js';
import { sendMessage } from './shared.js';
import { restoreSessionFromDb } from './crmHelpers.js';

// ===== SYSTEM COMMANDS =====

export async function handleStart(chatId, userName) {
  await sendMessage(chatId,
    `*${BOT_NAME}*\n\n` +
    `Привет, ${userName}!\n\n` +
    '*Life Pipeline:*\n' +
    '`/sprint` — Задачи спринта\n' +
    '`/today` — Брифинг на сегодня\n' +
    '`/done <id>` — Завершить задачу\n' +
    '`/weight <кг>` — Записать вес\n' +
    '`/mood <1-10>` — Записать настроение\n' +
    '`/week` — Итоги недели\n\n' +
    '*Chat:*\n' +
    '`/newchat` — Чат с Orchestrator\n' +
    '`/newchat developer` — Чат с агентом\n' +
    '`/chats` — Список чатов\n' +
    '`/endchat` — Закрыть чат\n\n' +
    '*Fun:*\n' +
    '`/dice` — Кубик\n' +
    '`/joke` — Шутка\n' +
    '`/time` — Время\n' +
    '`/whoami` — Инфа о тебе\n\n' +
    '_После /newchat просто пиши сообщения — без /!_'
  );
}

export async function handleHelp(chatId) {
  await sendMessage(chatId,
    `*${BOT_NAME} — Справка*\n\n` +
    '*Life Pipeline:*\n' +
    '`/sprint` — Текущие задачи (по приоритету)\n' +
    '`/today` — Утренний брифинг\n' +
    '`/done <id>` — Завершить задачу по ID\n' +
    '`/weight <кг>` — Записать вес\n' +
    '`/mood <1-10>` — Записать настроение\n' +
    '`/week` — Итоги недели\n\n' +
    '*Chat:*\n' +
    '`/newchat` — Чат с Orchestrator\n' +
    '`/newchat developer` — с Developer Ralph\n' +
    '`/newchat frontend` — с Frontend Dev\n' +
    '`/newchat architect` — с Architect\n' +
    'После /newchat просто пиши — все сообщения идут агенту.\n\n' +
    '*Управление чатами:*\n' +
    '`/chats` — Список чатов\n' +
    '`/chat_72` — Перейти в чат #72\n' +
    '`/endchat` — Закрыть чат\n\n' +
    '*Fun:*\n' +
    '`/dice` — Бросить кубик\n' +
    '`/joke` — Шутка\n' +
    '`/time` — Текущее время\n' +
    '`/whoami` — Информация о тебе\n' +
    '`/echo <текст>` — Эхо\n\n' +
    '*Система:*\n' +
    '`/status` — Статус бота'
  );
}

export async function handleStatus(chatId) {
  const mem = process.memoryUsage();
  const uptime = Math.floor(process.uptime());
  let session = activeSessions.get(chatId) || await restoreSessionFromDb(chatId);
  const sessionInfo = session
    ? `*Активный чат:* #${session.conversationId} с ${session.agentName}`
    : '*Активный чат:* Нет (используй `/newchat`)';

  await sendMessage(chatId,
    `*${BOT_NAME} — Статус*\n\n` +
    `*Uptime:* ${Math.floor(uptime / 3600)}ч ${Math.floor((uptime % 3600) / 60)}м\n` +
    `*Memory:* ${Math.round(mem.heapUsed / 1024 / 1024)}MB\n` +
    `${sessionInfo}\n` +
    `*Time:* ${new Date().toISOString()}`
  );
}

// ===== FUN COMMANDS =====

export async function handleDice(chatId) {
  const result = Math.floor(Math.random() * 6) + 1;
  await sendMessage(chatId, `Кубик: *${result}*`);
}

export async function handleJoke(chatId) {
  const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
  await sendMessage(chatId, joke);
}

export async function handleTime(chatId) {
  const now = new Date();
  const timeStr = now.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow', weekday: 'long', year: 'numeric',
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  await sendMessage(chatId, `${timeStr} (МСК)`);
}

export async function handleWhoami(chatId, message) {
  const user = message.from;
  await sendMessage(chatId,
    `*О тебе:*\n\n` +
    `ID: \`${user.id}\`\n` +
    `Имя: ${user.first_name || '-'}\n` +
    `Фамилия: ${user.last_name || '-'}\n` +
    `Username: ${user.username ? '@' + user.username : '-'}\n` +
    `Язык: ${user.language_code || '-'}\n` +
    `Chat ID: \`${chatId}\``
  );
}

export async function handleEcho(chatId, text) {
  const echoText = text.replace(/^\/echo\s*/, '').trim();
  if (!echoText) {
    await sendMessage(chatId, 'Напиши `/echo текст`');
  } else {
    await sendMessage(chatId, echoText);
  }
}
