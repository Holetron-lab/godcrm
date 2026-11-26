import crypto from 'node:crypto';
import { apiLogger } from '../../../utils/logger.js';
import { dbAll, dbGet, dbRun, withTransactionAsync } from '../../../database/connection.js';
import secretsVault from '../../../services/secrets/SecretsVault.js';
import { splitTelegramText } from '../../../services/TelegramService.js';
import { triggerAgentViaHttp } from '../telegram/agentBridge.js';
import { extractRecipeDish, searchRecipeImage, searchRecipeVideos } from './media.js';
import {
  consumeRamziGuestDailyLimit,
  consumeRamziInvite,
  ensureRamziOwnerParticipant,
  forgetRamziGuest,
  getRamziParticipant,
} from './participants.js';
import {
  PROFILE_STEPS,
  answerRamziProfile,
  formatNutritionResult,
  formatRamziProfile,
  getRamziProfile,
  promptWithRamziProfile,
  updateRamziProfile,
} from './profile.js';

export const RAMZI_OWNER_CRM_USER_ID = Number(process.env.RAMZI_OWNER_CRM_USER_ID || 17);
export const RAMZI_AGENT_ROW_ID = Number(process.env.RAMZI_AGENT_ROW_ID || 261935);
const RAMZI_SECRET_SPACE_ID = Number(process.env.RAMZI_SECRET_SPACE_ID || 7830);
const RAMZI_SECRET_KEY = process.env.RAMZI_SECRET_KEY || 'povarenok_ramzy';
const RATE_LIMIT_COUNT = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RAMZI_REPLY_KEYBOARD = {
  keyboard: [[{ text: 'Моя анкета' }, { text: 'Приступаем к работе' }]],
  resize_keyboard: true,
  is_persistent: true,
};
const RAMZI_MODE_KEYBOARD = {
  keyboard: [
    [{ text: 'Рецепт по настроению' }, { text: 'Из того, что есть дома' }],
    [{ text: 'Моя анкета' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const RAMZI_ACTIVE_KEYBOARD = {
  keyboard: [
    [{ text: 'Моя анкета' }, { text: 'Приступаем к работе' }],
    [{ text: 'Сменить режим' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const RAMZI_PROFILE_EDIT_BUTTONS = [
  [
    { text: 'Изменить технику', callback_data: 'ramzi:edit:equipment' },
    { text: 'Изменить продукты', callback_data: 'ramzi:edit:dislikes' },
  ],
  [
    { text: 'Изменить аллергии', callback_data: 'ramzi:edit:allergies' },
    { text: 'Пересчитать норму', callback_data: 'ramzi:edit:nutrition' },
  ],
];
const RAMZI_VIDEO_INLINE_KEYBOARD = {
  inline_keyboard: [[{ text: '▶ Видео', callback_data: 'ramzi:video' }]],
};
const RAMZI_CALLBACK_ACTIONS = {
  'ramzi:edit:equipment': 'Изменить технику',
  'ramzi:edit:dislikes': 'Изменить продукты',
  'ramzi:edit:allergies': 'Изменить аллергии',
  'ramzi:edit:nutrition': 'Пересчитать норму',
  'ramzi:photo:toggle': 'Фото: переключить',
  'ramzi:video': '▶ Видео',
};

function ramziProfileInlineKeyboard(photoOptIn) {
  return {
    inline_keyboard: [
      ...RAMZI_PROFILE_EDIT_BUTTONS,
      [{ text: photoOptIn === false ? 'Фото: включить' : 'Фото: выключить', callback_data: 'ramzi:photo:toggle' }],
    ],
  };
}

let cachedBotToken = null;

export async function getRamziBotToken(refresh = false) {
  if (!refresh && cachedBotToken) return cachedBotToken;
  const token = (await secretsVault.getSecret(RAMZI_SECRET_KEY, { spaceId: RAMZI_SECRET_SPACE_ID }))
    || process.env.POVARENOK_RAMZY_BOT_TOKEN
    || '';
  cachedBotToken = token || null;
  return token;
}

export async function getRamziWebhookSecret() {
  const token = await getRamziBotToken();
  if (!token) return null;
  return crypto.createHmac('sha256', token).update('godcrm-ramzi-webhook-v1').digest('hex');
}

export function secretsEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function codeHash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

export async function issueBindingCode() {
  const code = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await dbRun(`
    INSERT INTO telegram_ramzi_bindings (user_id, code_hash, expires_at, created_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, created_at = NOW()
  `, [RAMZI_OWNER_CRM_USER_ID, codeHash(code), expiresAt]);
  return { code, expiresAt };
}

async function consumeBindingCode(code, telegramUserId) {
  return withTransactionAsync(async (trx) => {
    const binding = await trx.get(
      'SELECT code_hash, expires_at FROM telegram_ramzi_bindings WHERE user_id = $1 FOR UPDATE',
      [RAMZI_OWNER_CRM_USER_ID]
    );
    if (!binding || Date.parse(binding.expires_at) <= Date.now()) return false;

    const expected = Buffer.from(binding.code_hash, 'hex');
    const actual = Buffer.from(codeHash(code), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;

    const conflict = await trx.get(
      'SELECT id FROM users WHERE telegram_user_id = $1 AND id <> $2 LIMIT 1',
      [telegramUserId, RAMZI_OWNER_CRM_USER_ID]
    );
    if (conflict) return false;

    const owner = await trx.get(
      'SELECT id, telegram_user_id FROM users WHERE id = $1 FOR UPDATE',
      [RAMZI_OWNER_CRM_USER_ID]
    );
    if (owner?.telegram_user_id !== null && String(owner.telegram_user_id) !== String(telegramUserId)) return false;

    await trx.run('UPDATE users SET telegram_user_id = $1 WHERE id = $2', [
      telegramUserId,
      RAMZI_OWNER_CRM_USER_ID,
    ]);
    await trx.run('DELETE FROM telegram_ramzi_bindings WHERE user_id = $1', [RAMZI_OWNER_CRM_USER_ID]);
    return true;
  });
}

export async function claimTelegramUpdate(updateId) {
  const result = await dbRun(
    'INSERT INTO telegram_ramzi_updates (update_id, created_at) VALUES ($1, NOW()) ON CONFLICT (update_id) DO NOTHING',
    [updateId]
  );
  if (updateId % 100 === 0) {
    await dbRun("DELETE FROM telegram_ramzi_updates WHERE created_at < NOW() - INTERVAL '7 days'");
  }
  return result.changes === 1;
}

export async function sendRamziMessage(chatId, text, replyMarkup = RAMZI_REPLY_KEYBOARD, lastReplyMarkup = null) {
  const token = await getRamziBotToken();
  if (!token) {
    apiLogger.error('[RamziBot] Bot token is not configured');
    return { success: false };
  }

  let lastMessageId = null;
  const parts = splitTelegramText(text);
  for (const [index, part] of parts.entries()) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(chatId),
          text: part,
          reply_markup: index === parts.length - 1 && lastReplyMarkup ? lastReplyMarkup : replyMarkup,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        apiLogger.error({ chatId: String(chatId), errorCode: data.error_code, description: data.description }, '[RamziBot] sendMessage failed');
        return { success: false };
      }
      lastMessageId = data.result?.message_id ?? lastMessageId;
    } catch (err) {
      apiLogger.error({ chatId: String(chatId), error: err.message }, '[RamziBot] sendMessage exception');
      return { success: false };
    }
  }
  return { success: true, messageId: lastMessageId };
}

async function sendRamziPhoto(chatId, photo) {
  try {
    const token = await getRamziBotToken();
    if (!token) return;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId), photo,
        caption: 'Фото из интернета, может отличаться от вашего рецепта',
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      apiLogger.error({ chatId: String(chatId), errorCode: data.error_code, description: data.description }, '[RamziBot] sendPhoto failed');
    }
  } catch (err) {
    apiLogger.error({ chatId: String(chatId), error: err.message }, '[RamziBot] sendPhoto exception');
  }
}

async function answerRamziCallbackQuery(callbackQueryId) {
  const token = await getRamziBotToken();
  if (!token) {
    apiLogger.error('[RamziBot] Bot token is not configured');
    return;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      apiLogger.error({ errorCode: data.error_code, description: data.description }, '[RamziBot] answerCallbackQuery failed');
    }
  } catch (err) {
    apiLogger.error({ error: err.message }, '[RamziBot] answerCallbackQuery exception');
  }
}

async function sendRamziProfile(chatId, text, profile) {
  const menu = await sendRamziMessage(chatId, 'Основное меню:', RAMZI_REPLY_KEYBOARD);
  if (!menu.success) return menu;
  return sendRamziMessage(chatId, text, ramziProfileInlineKeyboard(profile.photo_opt_in));
}

async function getOwner() {
  return dbGet('SELECT id, name, telegram_user_id FROM users WHERE id = $1', [RAMZI_OWNER_CRM_USER_ID]);
}

async function resolveRamziAgent() {
  const rows = await dbAll(`
    SELECT u.id AS user_id, u.name, u.managed_by_agent_row_id AS row_id
    FROM users u
    WHERE u.user_type = 'agent' AND u.managed_by_agent_row_id = $1
    ORDER BY u.id ASC LIMIT 2
  `, [RAMZI_AGENT_ROW_ID]);
  if (rows.length !== 1) throw new Error(`Expected one Ramzi agent-user, found ${rows.length}`);
  return rows[0];
}

async function createSession(chatId, agent, participant) {
  const settings = JSON.stringify({
    telegram_ramzi_chat_id: String(chatId),
    telegram_ramzi_participant: String(participant.telegram_user_id),
    telegram_ramzi_role: participant.role,
  });
  const label = String(participant.label || 'Участник').replace(/\s+/g, ' ').trim();
  const title = `Telegram Ramzi: ${label} — ${new Date().toISOString().slice(0, 10)}`;
  return withTransactionAsync(async (trx) => {
    const inserted = await trx.run(`
      INSERT INTO conversations (title, type, created_by, settings, sub_agents, created_at, updated_at)
      VALUES ($1, 'chat', $2, $3::jsonb, '[]'::jsonb, NOW(), NOW())
      RETURNING id
    `, [title, RAMZI_OWNER_CRM_USER_ID, settings]);
    const conversationId = inserted.lastInsertRowid;
    if (!conversationId) throw new Error('Failed to create Ramzi conversation');

    await trx.run(`
      INSERT INTO conversation_participants (conversation_id, user_id, user_type, role, joined_at)
      VALUES ($1, $2, $3, 'admin', NOW())
      ON CONFLICT (conversation_id, user_id) DO NOTHING
    `, [conversationId, RAMZI_OWNER_CRM_USER_ID, 'human']);
    await trx.run(`
      INSERT INTO conversation_participants
        (conversation_id, user_id, user_type, role, agent_response_mode, joined_at)
      VALUES ($1, $2, $3, 'member', 'always', NOW())
      ON CONFLICT (conversation_id, user_id) DO NOTHING
    `, [conversationId, agent.user_id, 'agent']);

    return {
      conversationId,
      agentUserId: agent.user_id,
      agentName: agent.name,
      telegramUserId: String(participant.telegram_user_id),
      participantLabel: participant.label,
      participantRole: participant.role,
      lastPolledMessageId: 0,
    };
  });
}

async function restoreSession(chatId, agent, participant) {
  const conversation = await dbGet(`
    SELECT c.id, c.created_by, c.created_at,
      (c.settings::jsonb)->>'telegram_ramzi_participant' AS telegram_user_id,
      (c.settings::jsonb)->>'telegram_ramzi_role' AS participant_role,
      (SELECT cp.user_id FROM conversation_participants cp
       WHERE cp.conversation_id = c.id AND cp.user_type = 'agent' LIMIT 1) AS agent_user_id
    FROM conversations c
    WHERE (c.settings::jsonb)->>'telegram_ramzi_chat_id' = $1
    ORDER BY c.updated_at DESC LIMIT 1
  `, [String(chatId)]);
  if (!conversation) return null;
  const wrongParticipant = conversation.telegram_user_id
    ? String(conversation.telegram_user_id) !== String(participant.telegram_user_id)
    : participant.role !== 'owner';
  if (conversation.created_by !== RAMZI_OWNER_CRM_USER_ID || conversation.agent_user_id !== agent.user_id || wrongParticipant) {
    throw new Error('Ramzi conversation ownership check failed');
  }

  const lastMessage = await dbGet(
    'SELECT id FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 1',
    [conversation.id]
  );
  return {
    conversationId: conversation.id,
    agentUserId: agent.user_id,
    agentName: agent.name,
    telegramUserId: String(participant.telegram_user_id),
    participantLabel: participant.label,
    participantRole: participant.role,
    lastPolledMessageId: lastMessage?.id || 0,
  };
}

async function forwardNewMessages(chatId, session, replyMarkup) {
  const messages = await dbAll(`
    SELECT id, content
    FROM messages
    WHERE conversation_id = $1 AND id > $2 AND sender_id = $3
      AND role = 'assistant' AND content_type = 'text'
    ORDER BY id ASC
  `, [session.conversationId, session.lastPolledMessageId, session.agentUserId]);
  if (messages.length === 0) return false;

  const seen = new Set();
  for (const message of messages) {
    const text = String(message.content || '').trim();
    if (text && !seen.has(text)) {
      const dish = extractRecipeDish(text);
      const sent = await sendRamziMessage(
        chatId, text, replyMarkup, dish ? RAMZI_VIDEO_INLINE_KEYBOARD : null
      );
      if (!sent.success) throw new Error('Failed to forward Ramzi response');
      if (dish) {
        const telegramUserId = session.telegramUserId;
        const profile = await updateRamziProfile(
          telegramUserId,
          await getRamziProfile(telegramUserId, true),
          { last_dish: dish }
        );
        if (profile.photo_opt_in !== false) {
          const photo = await searchRecipeImage(dish);
          if (photo) await sendRamziPhoto(chatId, photo);
        }
      }
      seen.add(text);
    }
    session.lastPolledMessageId = message.id;
    try {
      await dbRun(`
        DELETE FROM messages
        WHERE conversation_id = $1 AND sender_id = $2 AND role = 'assistant'
          AND content_type = 'thinking' AND id < $3 AND content = $4
      `, [session.conversationId, session.agentUserId, message.id, message.content]);
    } catch (err) {
      apiLogger.error({ conversationId: session.conversationId, messageId: message.id, error: err.message }, '[RamziBot] Duplicate thinking cleanup failed');
    }
  }
  return true;
}

function createPoller({ sleep, pollAttempts, delayedPollAttempts }) {
  async function poll(chatId, session, attempts, replyMarkup, delayed = false) {
    let processingWentFalse = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await sleep(delayed ? 10_000 : attempt < 15 ? 2_000 : 5_000);
      try {
        if (await forwardNewMessages(chatId, session, replyMarkup)) return true;
        const conversation = await dbGet(
          'SELECT is_processing FROM conversations WHERE id = $1',
          [session.conversationId]
        );
        if (!conversation?.is_processing) {
          if (processingWentFalse || delayed) return false;
          processingWentFalse = true;
        }
      } catch (err) {
        apiLogger.error({ conversationId: session.conversationId, attempt, error: err.message }, '[RamziBot] Response polling failed');
      }
    }
    return false;
  }

  return async (chatId, session, replyMarkup = RAMZI_REPLY_KEYBOARD) => {
    if (await poll(chatId, session, pollAttempts, replyMarkup)) return;
    await sendRamziMessage(chatId, 'Рамзи ещё готовит ответ. Он придёт отдельным сообщением.', replyMarkup);
    await poll(chatId, session, delayedPollAttempts, replyMarkup, true);
  };
}

export function createTelegramRamziService(options = {}) {
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollAndForward = createPoller({
    sleep,
    pollAttempts: options.pollAttempts ?? 90,
    delayedPollAttempts: options.delayedPollAttempts ?? 60,
  });
  const sessions = new Map();
  const rateLimits = new Map();
  const queues = new Map();
  const forgetConfirmations = new Map();

  function allowMessage(userId) {
    const now = Date.now();
    const current = rateLimits.get(userId);
    if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
      rateLimits.set(userId, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    if (rateLimits.size > 1000) {
      for (const [key, value] of rateLimits) {
        if (now - value.startedAt >= RATE_LIMIT_WINDOW_MS) rateLimits.delete(key);
      }
    }
    return current.count <= RATE_LIMIT_COUNT;
  }

  async function ensureSession(chatId, participant) {
    const key = String(chatId);
    if (sessions.has(key)) {
      const cached = sessions.get(key);
      if (cached.telegramUserId !== String(participant.telegram_user_id)) {
        throw new Error('Ramzi session participant mismatch');
      }
      return cached;
    }
    const agent = await resolveRamziAgent();
    const session = await restoreSession(key, agent, participant) || await createSession(key, agent, participant);
    sessions.set(key, session);
    return session;
  }

  async function processUpdate(update) {
    const callbackQuery = update.callback_query;
    const message = callbackQuery?.message || update.message;
    if (!message) return;
    const chatId = String(message.chat.id);
    const userId = String((callbackQuery?.from || message.from).id);
    const text = callbackQuery
      ? RAMZI_CALLBACK_ACTIONS[callbackQuery.data] || ''
      : String(message.text || '').trim();

    if (callbackQuery) {
      await answerRamziCallbackQuery(callbackQuery.id);
      if (!text) return;
    }
    if (message.chat.type !== 'private') {
      await sendRamziMessage(chatId, 'Этот бот работает только в личных сообщениях.');
      return;
    }
    if (!allowMessage(userId)) {
      await sendRamziMessage(chatId, 'Слишком много сообщений. Попробуйте через минуту.');
      return;
    }

    const owner = await getOwner();
    if (!owner) throw new Error('Ramzi owner is missing');
    const startMatch = text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?$/);
    let participant = await getRamziParticipant(userId);

    if (participant?.status === 'revoked') {
      await sendRamziMessage(chatId, 'Доступ отозван.');
      return;
    }
    if (!participant || participant.status !== 'active') {
      if (owner.telegram_user_id !== null && String(owner.telegram_user_id) === userId) {
        participant = await ensureRamziOwnerParticipant(owner);
      } else if (startMatch?.[1]) {
        if (owner.telegram_user_id === null && await consumeBindingCode(startMatch[1], userId)) {
          participant = await ensureRamziOwnerParticipant({ ...owner, telegram_user_id: userId });
        }
        if (!participant) participant = await consumeRamziInvite(startMatch[1], userId, RAMZI_OWNER_CRM_USER_ID);
        if (!participant) {
          const instructions = owner.telegram_user_id === null
            ? 'Код привязки недействителен или истёк. Получите новый код в CRM.'
            : 'Этот бот приватный.';
          await sendRamziMessage(chatId, instructions);
          return;
        }
      } else {
        const instructions = owner.telegram_user_id === null && startMatch
          ? 'Доступ не настроен. Получите одноразовый код в CRM и отправьте: /start КОД'
          : 'Этот бот приватный.';
        await sendRamziMessage(chatId, instructions);
        return;
      }
    }
    if (text === '/forget' || text === '/forget confirm') {
      if (participant.role !== 'guest') {
        await sendRamziMessage(chatId, 'Команда /forget доступна только гостям.');
        return;
      }
      if (text === '/forget') {
        forgetConfirmations.set(userId, Date.now() + 10 * 60_000);
        await sendRamziMessage(chatId, 'Это удалит вашу анкету и отзовёт доступ к боту. Беседа в CRM сохранится. Для подтверждения отправьте /forget confirm в течение 10 минут.');
        return;
      }
      const confirmation = forgetConfirmations.get(userId);
      if (!confirmation || confirmation < Date.now()) {
        await sendRamziMessage(chatId, 'Сначала отправьте /forget и подтвердите удаление в течение 10 минут.');
        return;
      }
      await forgetRamziGuest(userId);
      forgetConfirmations.delete(userId);
      sessions.delete(chatId);
      await sendRamziMessage(chatId, 'Ваши данные анкеты удалены, доступ к боту отозван. Беседа в CRM сохранена.');
      return;
    }
    if (participant.role === 'guest' && !await consumeRamziGuestDailyLimit(userId, {
      guestLimit: options.guestDailyLimit,
      totalLimit: options.totalDailyLimit,
    })) {
      await sendRamziMessage(chatId, 'Дневной лимит исчерпан, продолжим завтра.');
      return;
    }

    if (startMatch) {
      await ensureSession(chatId, participant);
      const profile = await getRamziProfile(userId, true);
      if (profile.step === 'complete') {
        await sendRamziProfile(chatId, `Ваша анкета уже заполнена.\n\n${formatRamziProfile(profile)}`, profile);
      } else {
        const editStep = profile.step.replace(/^edit_/, '');
        const question = PROFILE_STEPS[editStep]?.question || PROFILE_STEPS[profile.step].question;
        const greeting = profile.step === 'equipment'
          ? 'На связи! Я Рамзи. Сначала заполним короткую анкету — так я смогу подбирать рецепты под ваши условия. История этого чата сохранится.\n\n'
          : '';
        await sendRamziMessage(chatId, `${greeting}${question}`);
      }
      return;
    }
    if (!text) {
      await sendRamziMessage(chatId, 'Пока я принимаю только текстовые сообщения.');
      return;
    }
    if (text.startsWith('/')) {
      await sendRamziMessage(chatId, 'Напишите запрос обычным текстом или используйте /start.');
      return;
    }

    let profile = await getRamziProfile(userId);
    if (text === '▶ Видео' && profile?.step === 'complete') {
      if (!profile.last_dish) {
        await sendRamziMessage(chatId, 'Сначала попросите рецепт — тогда я смогу найти видео по названию блюда.');
        return;
      }
      const videos = await searchRecipeVideos(profile.last_dish);
      const videoText = videos.length
        ? [`Видео: как приготовить ${profile.last_dish}`, '', ...videos.flatMap((video) => [video.title, video.url, ''])].join('\n').trim()
        : 'Видео не нашлось, попробуйте уточнить название блюда.';
      await sendRamziMessage(chatId, videoText, profile.last_mode ? RAMZI_ACTIVE_KEYBOARD : RAMZI_REPLY_KEYBOARD);
      return;
    }
    if (text === 'Фото: переключить' && profile?.step === 'complete') {
      profile = await updateRamziProfile(userId, profile, { photo_opt_in: profile.photo_opt_in === false });
      await sendRamziProfile(chatId, `Настройка сохранена.\n\n${formatRamziProfile(profile)}`, profile);
      return;
    }
    if (text === 'Моя анкета') {
      profile = profile || await getRamziProfile(userId, true);
      const nextQuestion = profile.step === 'complete' ? '' : `\n\n${PROFILE_STEPS[profile.step.replace(/^edit_/, '')]?.question || PROFILE_STEPS[profile.step].question}`;
      const profileText = `${formatRamziProfile(profile)}${nextQuestion}`;
      if (profile.step === 'complete') {
        await sendRamziProfile(chatId, profileText, profile);
      } else {
        await sendRamziMessage(chatId, profileText);
      }
      return;
    }
    if (text === 'Приступаем к работе' || text === 'Сменить режим') {
      profile = profile || await getRamziProfile(userId, true);
      if (profile.step !== 'complete') {
        await sendRamziMessage(chatId, `Сначала закончим короткую анкету.\n\n${PROFILE_STEPS[profile.step.replace(/^edit_/, '')]?.question || PROFILE_STEPS[profile.step].question}`);
        return;
      }
      if (text === 'Сменить режим') profile = await updateRamziProfile(userId, profile, { last_mode: null });
      await sendRamziMessage(
        chatId,
        'Выберите режим: «Рецепт по настроению» — я предложу блюдо и список покупок; «Из того, что есть дома» — вы перечислите продукты, а я предложу варианты из них.',
        RAMZI_MODE_KEYBOARD
      );
      return;
    }
    if (text === 'Рецепт по настроению' && profile?.step === 'complete') {
      profile = await updateRamziProfile(userId, profile, { last_mode: 'mood' });
      await sendRamziMessage(chatId, 'На что настроение: завтрак, обед, ужин, перекус или «удиви меня»?', RAMZI_ACTIVE_KEYBOARD);
      return;
    }
    if (text === 'Из того, что есть дома' && profile?.step === 'complete') {
      profile = await updateRamziProfile(userId, profile, { last_mode: 'pantry', pantry_text: null });
      await sendRamziMessage(chatId, 'Перечислите продукты, которые есть дома, простым списком.', RAMZI_ACTIVE_KEYBOARD);
      return;
    }

    const editButtons = {
      'Изменить технику': 'edit_equipment',
      'Изменить продукты': 'edit_dislikes',
      'Изменить аллергии': 'edit_allergies',
    };
    const canEditProfile = profile?.step === 'complete' || profile?.step.startsWith('edit_');
    if (editButtons[text] && canEditProfile) {
      profile = await updateRamziProfile(userId, profile, { step: editButtons[text] });
      const baseStep = editButtons[text].replace(/^edit_/, '');
      await sendRamziMessage(chatId, `Введите новое значение; остальные ответы сохранятся.\n\n${PROFILE_STEPS[baseStep].question}`);
      return;
    }
    if (text === 'Пересчитать норму' && canEditProfile) {
      profile = await updateRamziProfile(userId, profile, { kcal_opt_in: true, step: 'sex' });
      await sendRamziMessage(chatId, PROFILE_STEPS.sex.question);
      return;
    }
    if (profile && profile.step !== 'complete') {
      const editing = profile.step.startsWith('edit_');
      const answered = await answerRamziProfile(userId, profile, text);
      if (answered.error) {
        await sendRamziMessage(chatId, answered.error);
        return;
      }
      profile = answered.profile;
      if (profile.step === 'complete') {
        const nutrition = profile.kcal_opt_in === true ? `\n\n${formatNutritionResult(profile)}` : '';
        const response = editing
          ? `Изменение сохранено; остальные ответы не изменились.\n\n${formatRamziProfile(profile)}`
          : `Анкета сохранена. Нажмите «Приступаем к работе» или сразу напишите, что приготовить.${nutrition}`;
        if (editing) {
          await sendRamziProfile(chatId, response, profile);
        } else {
          await sendRamziMessage(chatId, response);
        }
      } else {
        await sendRamziMessage(chatId, PROFILE_STEPS[profile.step].question);
      }
      return;
    }
    if (profile?.step === 'complete' && profile.last_mode === 'pantry' && !profile.pantry_text) {
      profile = await updateRamziProfile(userId, profile, { pantry_text: text });
    }

    const session = await ensureSession(chatId, participant);
    const lastMessage = await dbGet(
      'SELECT id FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 1',
      [session.conversationId]
    );
    session.lastPolledMessageId = lastMessage?.id || session.lastPolledMessageId;

    const triggered = await triggerAgentViaHttp(
      session.conversationId,
      promptWithRamziProfile(userId, profile, text, participant.label),
      RAMZI_OWNER_CRM_USER_ID,
      []
    );
    if (!triggered) {
      await sendRamziMessage(chatId, 'Не удалось запустить Рамзи. Сообщение сохранено в CRM; попробуйте ещё раз позже.');
      return;
    }
    await pollAndForward(chatId, session, profile?.last_mode ? RAMZI_ACTIVE_KEYBOARD : RAMZI_REPLY_KEYBOARD);
  }

  return {
    async handleUpdate(update) {
      const chatId = String(update.message?.chat?.id || update.callback_query?.message?.chat?.id || 'unknown');
      const previous = queues.get(chatId) || Promise.resolve();
      const current = previous.catch(() => {}).then(() => processUpdate(update));
      queues.set(chatId, current);
      try {
        await current;
      } finally {
        if (queues.get(chatId) === current) queues.delete(chatId);
      }
    },
  };
}
