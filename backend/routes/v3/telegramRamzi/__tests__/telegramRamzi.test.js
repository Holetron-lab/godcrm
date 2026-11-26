// @vitest-environment node
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbGet: vi.fn(),
  dbAll: vi.fn(),
  dbRun: vi.fn(),
  withTransaction: vi.fn(),
  getSecret: vi.fn(),
  triggerAgent: vi.fn(),
}));

vi.mock('../../../../database/connection.js', () => ({
  dbGet: mocks.dbGet,
  dbAll: mocks.dbAll,
  dbRun: mocks.dbRun,
  withTransactionAsync: mocks.withTransaction,
}));

vi.mock('../../../../services/secrets/SecretsVault.js', () => ({
  default: { getSecret: mocks.getSecret },
}));

vi.mock('../../../../services/TelegramService.js', async (importOriginal) => ({
  ...(await importOriginal()),
}));

vi.mock('../../../../utils/logger.js', () => {
  const apiLogger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: () => apiLogger,
  };
  return { apiLogger };
});

vi.mock('../../telegram/agentBridge.js', () => ({
  triggerAgentViaHttp: mocks.triggerAgent,
}));

vi.mock('../../auth/authShared.js', () => ({
  requireAuth: (req, res, next) => {
    const id = Number(req.headers['x-test-user-id']);
    if (!id) return res.status(401).json({ success: false, error: 'AUTH_REQUIRED' });
    req.user = { id };
    next();
  },
}));

const { createTelegramRamziRouter } = await import('../index.js');

const OWNER_ID = 17;
const AGENT_USER_ID = 8989;
const AGENT_ROW_ID = 261935;
const BOT_TOKEN = 'TESTTOKEN';
const WEBHOOK_SECRET = createHmac('sha256', BOT_TOKEN)
  .update('godcrm-ramzi-webhook-v1')
  .digest('hex');

function createDbHarness() {
  const state = {
    users: new Map([[OWNER_ID, { id: OWNER_ID, name: 'Joel Ocean', user_type: 'human', telegram_user_id: null }]]),
    conversations: [],
    participants: [],
    ramziParticipants: new Map(),
    messages: [],
    bindings: new Map(),
    invites: new Map(),
    profiles: new Map(),
    updates: new Set(),
    nextConversationId: 1000,
    nextMessageId: 1,
    nextInviteId: 1,
    nextResponse: null,
  };

  const get = async (sql, params = []) => {
    if (/FROM users WHERE telegram_user_id/.test(sql)) {
      return [...state.users.values()].find((u) => String(u.telegram_user_id) === String(params[0]) && u.id !== params[1]) || null;
    }
    if (/FROM users WHERE id = \$1/.test(sql)) return state.users.get(params[0]) || null;
    if (/FROM telegram_ramzi_bindings/.test(sql)) return state.bindings.get(params[0]) || null;
    if (/SUM\(messages_today\)/.test(sql)) {
      return { count: [...state.ramziParticipants.values()]
        .filter((participant) => participant.role === 'guest' && participant.status === 'active')
        .reduce((sum, participant) => sum + participant.messages_today, 0) };
    }
    if (/FROM telegram_ramzi_participants/.test(sql)) return state.ramziParticipants.get(String(params[0])) || null;
    if (/FROM telegram_ramzi_invites WHERE code_hash/.test(sql)) {
      return [...state.invites.values()].find((invite) => invite.code_hash === params[0]) || null;
    }
    if (/FROM telegram_ramzi_invites WHERE id/.test(sql)) return state.invites.get(params[0]) || null;
    if (/FROM telegram_ramzi_profiles/.test(sql)) return state.profiles.get(String(params[0])) || null;
    if (/COUNT\(\*\)::int AS count FROM telegram_ramzi_updates/.test(sql)) return { count: state.updates.size };
    if (/pg_advisory_xact_lock/.test(sql)) return {};
    if (/SELECT is_processing FROM conversations/.test(sql)) return { is_processing: false };
    if (/FROM conversations c/.test(sql) && /telegram_ramzi_chat_id/.test(sql)) {
      const conv = [...state.conversations]
        .filter((c) => c.settings.telegram_ramzi_chat_id === String(params[0]))
        .sort((a, b) => b.id - a.id)[0];
      return conv ? {
        ...conv,
        agent_user_id: AGENT_USER_ID,
        telegram_user_id: conv.settings.telegram_ramzi_participant || null,
        participant_role: conv.settings.telegram_ramzi_role || null,
      } : null;
    }
    if (/SELECT id FROM messages WHERE conversation_id/.test(sql)) {
      const message = state.messages.filter((m) => m.conversation_id === params[0]).at(-1);
      return message ? { id: message.id } : null;
    }
    throw new Error(`Unexpected dbGet SQL: ${sql}`);
  };

  const all = async (sql, params = []) => {
    if (/FROM users u/.test(sql) && /managed_by_agent_row_id/.test(sql)) {
      return params[0] === AGENT_ROW_ID
        ? [{ user_id: AGENT_USER_ID, row_id: AGENT_ROW_ID, name: 'Povarenok_Ramzy' }]
        : [];
    }
    if (/FROM telegram_ramzi_invites/.test(sql)) {
      return [...state.invites.values()].map(({ code_hash: _codeHash, ...invite }) => invite);
    }
    if (/FROM telegram_ramzi_participants/.test(sql)) return [...state.ramziParticipants.values()];
    if (/FROM messages/.test(sql) && /role = 'assistant'/.test(sql)) {
      return state.messages
        .filter((m) => m.conversation_id === params[0] && m.id > params[1] && m.sender_id === params[2] && m.role === 'assistant')
        .sort((a, b) => a.id - b.id);
    }
    throw new Error(`Unexpected dbAll SQL: ${sql}`);
  };

  const run = async (sql, params = []) => {
    if (/INSERT INTO telegram_ramzi_updates/.test(sql)) {
      if (state.updates.has(params[0])) return { changes: 0, lastInsertRowid: 0 };
      state.updates.add(params[0]);
      return { changes: 1, lastInsertRowid: params[0] };
    }
    if (/DELETE FROM telegram_ramzi_updates/.test(sql)) return { changes: 0, lastInsertRowid: 0 };
    if (/INSERT INTO telegram_ramzi_bindings/.test(sql)) {
      state.bindings.set(params[0], { code_hash: params[1], expires_at: params[2] });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/DELETE FROM telegram_ramzi_bindings/.test(sql)) {
      state.bindings.delete(params[0]);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/UPDATE telegram_ramzi_profiles/.test(sql)) {
      const profile = state.profiles.get(String(params.at(-1)));
      const assignments = sql.match(/SET\s+([\s\S]+?)\s+WHERE/)[1].split(',');
      for (const assignment of assignments) {
        const match = assignment.trim().match(/^(\w+) = \$(\d+)/);
        if (match && match[1] !== 'updated_at') profile[match[1]] = params[Number(match[2]) - 1];
      }
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/INSERT INTO telegram_ramzi_profiles \(telegram_user_id\)/.test(sql)) {
      const key = String(params[0]);
      if (!state.profiles.has(key)) {
        state.profiles.set(key, {
          telegram_user_id: key, step: 'equipment', equipment: null,
          disliked_foods: null, allergies: null, kcal_opt_in: null,
          sex: null, age: null, height_cm: null, weight_kg: null,
          activity_level: null, goal: null, daily_kcal: null, macros_json: null,
          last_mode: null, pantry_text: null, photo_opt_in: true, last_dish: null,
        });
      }
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/DELETE FROM telegram_ramzi_profiles/.test(sql)) {
      const deleted = state.profiles.delete(String(params[0]));
      return { changes: deleted ? 1 : 0, lastInsertRowid: 0 };
    }
    if (/INSERT INTO telegram_ramzi_participants/.test(sql)) {
      const key = String(params[0]);
      const role = sql.includes("'owner'") ? 'owner' : 'guest';
      const previous = state.ramziParticipants.get(key);
      state.ramziParticipants.set(key, {
        ...previous, telegram_user_id: key, label: params[1], role, status: 'active',
        invited_by: params[2], messages_day: null, messages_today: 0, created_at: new Date().toISOString(), revoked_at: null,
      });
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/UPDATE telegram_ramzi_participants[\s\S]*role = 'owner' AND telegram_user_id <>/.test(sql)) {
      for (const participant of state.ramziParticipants.values()) {
        if (participant.role === 'owner' && participant.telegram_user_id !== String(params[0])) participant.status = 'revoked';
      }
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/UPDATE telegram_ramzi_participants SET messages_day = CURRENT_DATE, messages_today = 0/.test(sql)) {
      const participant = state.ramziParticipants.get(String(params[0]));
      if (participant && !participant.messages_day) {
        participant.messages_day = new Date().toISOString();
        participant.messages_today = 0;
      }
      return { changes: participant ? 1 : 0, lastInsertRowid: 0 };
    }
    if (/UPDATE telegram_ramzi_participants[\s\S]*messages_today = messages_today \+ 1/.test(sql)) {
      const participant = state.ramziParticipants.get(String(params[0]));
      if (!participant || participant.messages_today >= params[1]) return { changes: 0, lastInsertRowid: 0 };
      participant.messages_today += 1;
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/UPDATE telegram_ramzi_participants SET status = 'revoked'/.test(sql)) {
      const participant = state.ramziParticipants.get(String(params[0]));
      if (participant) participant.status = 'revoked';
      return { changes: participant ? 1 : 0, lastInsertRowid: 0 };
    }
    if (/INSERT INTO telegram_ramzi_invites/.test(sql)) {
      const id = state.nextInviteId++;
      state.invites.set(id, {
        id, code_hash: params[0], label: params[1], created_by: params[2], expires_at: params[3],
        used_by: null, used_at: null, revoked_at: null,
      });
      return { changes: 1, lastInsertRowid: id };
    }
    if (/UPDATE telegram_ramzi_invites SET used_by/.test(sql)) {
      const invite = state.invites.get(params[1]);
      invite.used_by = String(params[0]);
      invite.used_at = new Date().toISOString();
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/UPDATE telegram_ramzi_invites SET revoked_at/.test(sql)) {
      state.invites.get(params[0]).revoked_at = new Date().toISOString();
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/DELETE FROM messages/.test(sql) && /content_type = 'thinking'/.test(sql)) {
      const [conversationId, senderId, messageId, content] = params;
      state.messages = state.messages.filter((message) => !(
        message.conversation_id === conversationId && message.sender_id === senderId
        && message.content_type === 'thinking' && message.id < messageId && message.content === content
      ));
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/UPDATE users\s+SET telegram_user_id/.test(sql)) {
      const user = state.users.get(params[1]);
      user.telegram_user_id = String(params[0]);
      return { changes: 1, lastInsertRowid: 0 };
    }
    if (/INSERT INTO conversations/.test(sql)) {
      const id = ++state.nextConversationId;
      state.conversations.push({
        id,
        title: params[0],
        created_by: params[1],
        settings: JSON.parse(params[2]),
        created_at: new Date().toISOString(),
      });
      return { changes: 1, lastInsertRowid: id };
    }
    if (/INSERT INTO conversation_participants/.test(sql)) {
      state.participants.push({ conversation_id: params[0], user_id: params[1], user_type: params[2] });
      return { changes: 1, lastInsertRowid: 0 };
    }
    throw new Error(`Unexpected dbRun SQL: ${sql}`);
  };

  mocks.dbGet.mockImplementation(get);
  mocks.dbAll.mockImplementation(all);
  mocks.dbRun.mockImplementation(run);
  mocks.withTransaction.mockImplementation((callback) => callback({ get, all, run }));
  mocks.triggerAgent.mockImplementation(async (conversationId, content) => {
    state.messages.push({
      id: state.nextMessageId++, conversation_id: conversationId, sender_id: OWNER_ID,
      role: 'user', content_type: 'text', content,
    });
    const response = state.nextResponse || `Рамзи: ${content}`;
    state.messages.push({
      id: state.nextMessageId++, conversation_id: conversationId, sender_id: AGENT_USER_ID,
      role: 'assistant', content_type: 'thinking', content: response,
    });
    state.messages.push({
      id: state.nextMessageId++, conversation_id: conversationId, sender_id: AGENT_USER_ID,
      role: 'assistant', content_type: 'text', content: response,
    });
    return true;
  });
  return state;
}

function buildApp(options = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v3/telegram/ramzi', createTelegramRamziRouter({
    sleep: async () => {},
    pollAttempts: 2,
    delayedPollAttempts: 0,
    ...options,
  }));
  return app;
}

let updateId = 100;
function textUpdate(text, { chatId = 555, userId = 555, chatType = 'private' } = {}) {
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      from: { id: userId, first_name: 'Joel' },
      chat: { id: chatId, type: chatType },
      text,
    },
  };
}

function callbackUpdate(data, { chatId = 555, userId = 555, chatType = 'private' } = {}) {
  return {
    update_id: ++updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: { id: userId, first_name: 'Joel' },
      message: {
        message_id: updateId,
        from: { id: 9999, first_name: 'Ramzi' },
        chat: { id: chatId, type: chatType },
      },
      data,
    },
  };
}

async function postUpdate(app, update, secret = WEBHOOK_SECRET) {
  return request(app)
    .post('/api/v3/telegram/ramzi/webhook')
    .set('x-telegram-bot-api-secret-token', secret)
    .send(update);
}

function sentTexts() {
  return mocks.fetch.mock.calls
    .filter(([url]) => url.endsWith('/sendMessage'))
    .map(([, options]) => JSON.parse(options.body).text);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mocks.getSecret.mockImplementation(async (key, { spaceId }) => (
    key === 'povarenok_ramzy' && spaceId === 7830 ? BOT_TOKEN : null
  ));
  mocks.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, result: { message_id: 1, username: 'ramzi_test_bot' } }),
  }));
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('private Ramzi Telegram bot', () => {
  it('rejects a webhook without the derived secret before claiming the update', async () => {
    const state = createDbHarness();
    const res = await postUpdate(buildApp(), textUpdate('recipe'), 'wrong-secret');
    expect(res.status).toBe(401);
    expect(state.updates.size).toBe(0);
    expect(mocks.triggerAgent).not.toHaveBeenCalled();
  });

  it('does not bind the first writer and binds only with an owner-issued one-time code', async () => {
    const state = createDbHarness();
    const app = buildApp();

    expect((await postUpdate(app, textUpdate('/start', { userId: 999, chatId: 999 }))).status).toBe(200);
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/одноразов/i));
    expect(state.users.get(OWNER_ID).telegram_user_id).toBeNull();

    const forbidden = await request(app).post('/api/v3/telegram/ramzi/binding-code').set('x-test-user-id', '999');
    expect(forbidden.status).toBe(403);

    const issued = await request(app).post('/api/v3/telegram/ramzi/binding-code').set('x-test-user-id', '17');
    expect(issued.status).toBe(200);
    expect(issued.body.data.code).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    await postUpdate(app, textUpdate(`/start ${issued.body.data.code}`));
    await vi.waitFor(() => expect(state.users.get(OWNER_ID).telegram_user_id).toBe('555'));
    expect(state.bindings.has(OWNER_ID)).toBe(false);
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Рамзи/));
  });

  it('persists the full onboarding, menu and profile context across routers and /start', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp();

    await postUpdate(app, textUpdate('/start'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/техника/i));
    expect(state.conversations).toHaveLength(1);
    expect(state.profiles.get('555').step).toBe('equipment');
    const startBody = JSON.parse(mocks.fetch.mock.calls.at(-1)[1].body);
    expect(startBody.reply_markup).toEqual({
      keyboard: [[{ text: 'Моя анкета' }, { text: 'Приступаем к работе' }]],
      resize_keyboard: true,
      is_persistent: true,
    });

    await postUpdate(app, textUpdate('Духовка Bosch HBG 633, плита'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/нелюбимые продукты/i));
    expect(state.profiles.get('555').step).toBe('dislikes');

    const restoredApp = buildApp();
    await postUpdate(restoredApp, textUpdate('/start'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/нелюбимые продукты/i));
    expect(state.profiles.get('555').equipment).toBe('Духовка Bosch HBG 633, плита');

    await postUpdate(restoredApp, textUpdate('Кинза, грибы'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/аллергии/i));
    await postUpdate(restoredApp, textUpdate('пропустить'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/дневную норму калорий/i));
    await postUpdate(restoredApp, textUpdate('пропустить'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/анкета сохранена/i));
    expect(state.profiles.get('555')).toMatchObject({
      step: 'complete', disliked_foods: 'Кинза, грибы', allergies: 'Пропущено', kcal_opt_in: false,
    });

    await postUpdate(restoredApp, textUpdate('Моя анкета'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Bosch HBG 633/));
    expect(sentTexts().at(-1)).toMatch(/Кинза, грибы/);
    expect(sentTexts().at(-1)).toMatch(/Пропущено/);
    const profileKeyboard = JSON.parse(mocks.fetch.mock.calls.at(-1)[1].body).reply_markup;
    expect(profileKeyboard.keyboard).toBeUndefined();
    expect(profileKeyboard.inline_keyboard).toEqual([
      [
        { text: 'Изменить технику', callback_data: 'ramzi:edit:equipment' },
        { text: 'Изменить продукты', callback_data: 'ramzi:edit:dislikes' },
      ],
      [
        { text: 'Изменить аллергии', callback_data: 'ramzi:edit:allergies' },
        { text: 'Пересчитать норму', callback_data: 'ramzi:edit:nutrition' },
      ],
      [{ text: 'Фото: выключить', callback_data: 'ramzi:photo:toggle' }],
    ]);
    const mainMenuBody = JSON.parse(mocks.fetch.mock.calls.at(-2)[1].body);
    expect(mainMenuBody.text).toBe('Основное меню:');
    expect(mainMenuBody.reply_markup.keyboard.flat().map((button) => button.text)).toEqual([
      'Моя анкета', 'Приступаем к работе',
    ]);

    await postUpdate(restoredApp, textUpdate('Приступаем к работе'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Выберите режим/i));
    expect(sentTexts().at(-1)).toMatch(/Рецепт по настроению/);
    expect(sentTexts().at(-1)).toMatch(/Из того, что есть дома/);
    expect(mocks.triggerAgent).not.toHaveBeenCalled();

    await postUpdate(restoredApp, textUpdate('Дай рецепт курицы'));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(1));
    const recipePrompt = mocks.triggerAgent.mock.calls[0][1];
    expect(recipePrompt).toMatch(/Духовка Bosch HBG 633, плита/);
    expect(recipePrompt).toMatch(/Кинза, грибы/);
    expect(recipePrompt).toMatch(/Аллергии и непереносимость: Пропущено/);
    expect(recipePrompt).toMatch(/Дай рецепт курицы/);
    await postUpdate(restoredApp, textUpdate('А если грудка?'));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(2));
    expect(state.messages.filter((message) => (
      message.role === 'assistant' && message.content_type === 'thinking'
    ))).toHaveLength(0);

    await postUpdate(restoredApp, textUpdate('/start'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/анкета уже заполнена/i));
    expect(state.profiles.get('555').equipment).toBe('Духовка Bosch HBG 633, плита');
    expect(state.conversations).toHaveLength(1);
    expect(mocks.triggerAgent.mock.calls.map((call) => call[0])).toEqual([1001, 1001]);
    expect(state.participants).toEqual(expect.arrayContaining([
      { conversation_id: 1001, user_id: OWNER_ID, user_type: 'human' },
      { conversation_id: 1001, user_id: AGENT_USER_ID, user_type: 'agent' },
    ]));
  });

  it('calculates calories, edits one field and supports mood and pantry modes', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    let app = buildApp();
    const answer = async (text, step) => {
      await postUpdate(app, textUpdate(text));
      await vi.waitFor(() => expect(state.profiles.get('555').step).toBe(step));
    };

    await answer('/start', 'equipment');
    await answer('Духовка Bosch', 'dislikes');
    await answer('Кинза', 'allergies');
    await answer('Арахис', 'kcal_opt_in');
    await answer('да', 'sex');
    await answer('мужской', 'age');
    await postUpdate(app, textUpdate('много'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/возраст/i));
    expect(state.profiles.get('555').step).toBe('age');
    await answer('30', 'height');
    await answer('180', 'weight');
    await answer('80', 'activity');
    app = buildApp();
    await answer('3', 'goal');
    await answer('похудение', 'complete');

    expect(state.profiles.get('555')).toMatchObject({
      kcal_opt_in: true, sex: 'male', age: 30, height_cm: 180,
      activity_level: 'moderate', goal: 'loss', daily_kcal: 2345,
    });
    expect(JSON.parse(state.profiles.get('555').macros_json)).toEqual({
      protein_g: 176, fat_g: 78, carbs_g: 235,
    });

    await postUpdate(app, textUpdate('Моя анкета'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/2345 ккал/));
    expect(sentTexts().at(-1)).toMatch(/176\/78\/235/);
    expect(sentTexts().at(-1)).toMatch(/не медицинская рекомендация/i);

    await postUpdate(app, callbackUpdate('ramzi:edit:equipment'));
    await vi.waitFor(() => expect(state.profiles.get('555').step).toBe('edit_equipment'));
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/answerCallbackQuery'))).toHaveLength(1);
    await answer('Духовка Bosch, аэрогриль', 'complete');
    expect(state.profiles.get('555')).toMatchObject({
      equipment: 'Духовка Bosch, аэрогриль', disliked_foods: 'Кинза', allergies: 'Арахис', daily_kcal: 2345,
    });

    await postUpdate(app, textUpdate('Приступаем к работе'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Выберите режим/i));
    await postUpdate(app, textUpdate('Рецепт по настроению'));
    await vi.waitFor(() => expect(state.profiles.get('555').last_mode).toBe('mood'));
    await postUpdate(app, textUpdate('ужин'));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(1));
    const moodPrompt = mocks.triggerAgent.mock.calls[0][1];
    expect(moodPrompt).toMatch(/Список покупок/);
    expect(moodPrompt).toMatch(/по отделам магазина/);
    expect(moodPrompt).toMatch(/проверьте дома/);
    expect(moodPrompt).toMatch(/2345 ккал/);
    expect(moodPrompt).toMatch(/похудение/);
    expect(moodPrompt).toMatch(/ккал на порцию/);
    expect(moodPrompt).not.toMatch(/Возраст:|Рост:|Вес:|Уровень активности:/);

    await postUpdate(app, textUpdate('Сменить режим'));
    await vi.waitFor(() => expect(state.profiles.get('555').last_mode).toBeNull());
    await postUpdate(app, textUpdate('Из того, что есть дома'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Перечислите продукты/i));
    app = buildApp();
    await postUpdate(app, textUpdate('курица, рис, морковь'));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(2));
    expect(state.profiles.get('555').pantry_text).toBe('курица, рис, морковь');
    expect(mocks.triggerAgent.mock.calls[1][1]).toMatch(/2–3 варианта/);
    expect(mocks.triggerAgent.mock.calls[1][1]).toMatch(/строго из перечисленного/);
    expect(mocks.triggerAgent.mock.calls[1][1]).toMatch(/если докупить/);

    await postUpdate(app, textUpdate('а ещё что-то из этого?'));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(3));
    expect(state.profiles.get('555').pantry_text).toBe('курица, рис, морковь');
    expect(mocks.triggerAgent.mock.calls[2][1]).toMatch(/курица, рис, морковь/);
  });

  it('sends recipe text with video actions and an accessible photo using the saved dish', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp();
    await postUpdate(app, textUpdate('/start'));
    await vi.waitFor(() => expect(state.profiles.get('555')).toBeDefined());
    Object.assign(state.profiles.get('555'), {
      step: 'complete', equipment: 'Духовка', disliked_foods: 'Кинза', allergies: 'нет', kcal_opt_in: false,
    });
    state.nextResponse = '🍽 Блюдо: Курица терияки\n\nРецепт\n\nСписок покупок';
    mocks.fetch.mockClear();
    mocks.fetch.mockImplementation(async (url) => {
      if (url.startsWith('http://127.0.0.1:8890/search')) {
        const category = new URL(url).searchParams.get('categories');
        return {
          ok: true, status: 200,
          json: async () => ({ results: category === 'images'
            ? [{ img_src: 'https://img.test/recipe.jpg' }]
            : [
              { title: 'Ужин за 20 минут', url: 'https://youtube.com/watch?v=other' },
              { title: 'Курица терияки', url: 'https://youtube.com/watch?v=best' },
              { title: 'Соус терияки', url: 'https://youtube.com/watch?v=third' },
            ] }),
        };
      }
      if (url === 'https://img.test/recipe.jpg') {
        return {
          ok: true, status: 200,
          headers: { get: (name) => ({ 'content-type': 'image/jpeg', 'content-length': '1024' })[name] },
        };
      }
      if (url.endsWith('/editMessageReplyMarkup')) {
        return {
          ok: false, status: 400,
          json: async () => ({ ok: false, error_code: 400, description: "Bad Request: message can't be edited" }),
        };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, result: { message_id: 77, username: 'ramzi_test_bot' } }),
      };
    });

    await postUpdate(app, textUpdate('ужин'));
    await vi.waitFor(() => {
      expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/sendPhoto'))).toBe(true);
    });
    const endpoints = mocks.fetch.mock.calls.map(([url]) => url.split('/').at(-1)).filter((endpoint) => (
      ['sendMessage', 'sendPhoto', 'editMessageReplyMarkup'].includes(endpoint)
    ));
    expect(endpoints).toEqual(['sendMessage', 'sendPhoto']);
    const recipeCall = mocks.fetch.mock.calls.find(([url]) => url.endsWith('/sendMessage'));
    expect(JSON.parse(recipeCall[1].body)).toMatchObject({
      chat_id: '555', text: state.nextResponse,
      reply_markup: { inline_keyboard: [[{ text: '▶ Видео', callback_data: 'ramzi:video' }]] },
    });
    const photoCall = mocks.fetch.mock.calls.find(([url]) => url.endsWith('/sendPhoto'));
    expect(JSON.parse(photoCall[1].body)).toMatchObject({
      chat_id: '555', photo: 'https://img.test/recipe.jpg', caption: 'Фото из интернета, может отличаться от вашего рецепта',
    });
    expect(state.profiles.get('555').last_dish).toBe('Курица терияки');

    await postUpdate(app, callbackUpdate('ramzi:video'));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Видео: как приготовить Курица терияки/));
    expect(sentTexts().at(-1)).toContain('https://youtube.com/watch?v=best');
    expect(sentTexts().at(-1)).toContain('https://youtube.com/watch?v=third');
    expect(sentTexts().at(-1)).toContain('https://youtube.com/watch?v=other');
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/answerCallbackQuery'))).toBe(true);
  });

  it('suppresses photos by profile preference and toggles only that setting', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp();
    await postUpdate(app, textUpdate('/start'));
    await vi.waitFor(() => expect(state.profiles.get('555')).toBeDefined());
    Object.assign(state.profiles.get('555'), {
      step: 'complete', equipment: 'Духовка', disliked_foods: 'Кинза', allergies: 'Арахис', photo_opt_in: false,
    });
    state.nextResponse = '🍽 Блюдо: Суп\n\nРецепт супа';

    await postUpdate(app, textUpdate('суп'));
    await vi.waitFor(() => expect(state.profiles.get('555').last_dish).toBe('Суп'));
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/sendPhoto'))).toBe(false);
    expect(mocks.fetch.mock.calls.some(([url]) => url.includes('/search?'))).toBe(false);
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/editMessageReplyMarkup'))).toBe(false);
    const recipeCall = mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/sendMessage')).at(-1);
    expect(JSON.parse(recipeCall[1].body).reply_markup).toEqual({
      inline_keyboard: [[{ text: '▶ Видео', callback_data: 'ramzi:video' }]],
    });

    await postUpdate(app, callbackUpdate('ramzi:photo:toggle'));
    await vi.waitFor(() => expect(state.profiles.get('555').photo_opt_in).toBe(true));
    expect(sentTexts().at(-1)).toMatch(/Фото к рецептам: да/);
    expect(state.profiles.get('555')).toMatchObject({
      equipment: 'Духовка', disliked_foods: 'Кинза', allergies: 'Арахис', last_dish: 'Суп',
    });
    const enabledKeyboard = JSON.parse(mocks.fetch.mock.calls.at(-1)[1].body).reply_markup;
    expect(enabledKeyboard.inline_keyboard.at(-1)).toEqual([
      { text: 'Фото: выключить', callback_data: 'ramzi:photo:toggle' },
    ]);

    await postUpdate(app, callbackUpdate('ramzi:photo:toggle'));
    await vi.waitFor(() => expect(state.profiles.get('555').photo_opt_in).toBe(false));
    expect(sentTexts().at(-1)).toMatch(/Фото к рецептам: нет/);
    const disabledKeyboard = JSON.parse(mocks.fetch.mock.calls.at(-1)[1].body).reply_markup;
    expect(disabledKeyboard.inline_keyboard.at(-1)).toEqual([
      { text: 'Фото: включить', callback_data: 'ramzi:photo:toggle' },
    ]);
  });

  it('treats profile edit buttons as commands while editing another field', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp();
    await postUpdate(app, textUpdate('/start'));
    await vi.waitFor(() => expect(state.profiles.get('555')).toBeDefined());
    Object.assign(state.profiles.get('555'), {
      step: 'complete', equipment: 'Духовка', disliked_foods: 'Кинза', allergies: 'Арахис',
    });

    await postUpdate(app, callbackUpdate('ramzi:edit:equipment'));
    await vi.waitFor(() => expect(state.profiles.get('555').step).toBe('edit_equipment'));
    await postUpdate(app, callbackUpdate('ramzi:edit:dislikes'));
    await vi.waitFor(() => expect(state.profiles.get('555').step).toBe('edit_dislikes'));
    expect(state.profiles.get('555').equipment).toBe('Духовка');
    expect(state.profiles.get('555').disliked_foods).toBe('Кинза');
    expect(sentTexts().at(-1)).toMatch(/нелюбимые продукты/i);

    await postUpdate(app, textUpdate('Грибы'));
    await vi.waitFor(() => expect(state.profiles.get('555').step).toBe('complete'));
    expect(state.profiles.get('555')).toMatchObject({
      equipment: 'Духовка', disliked_foods: 'Грибы', allergies: 'Арахис',
    });
  });

  it('keeps no and skip as distinct allergy answers', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp();

    await postUpdate(app, textUpdate('/start'));
    await vi.waitFor(() => expect(state.profiles.get('555')).toBeDefined());
    await postUpdate(app, textUpdate('Плита'));
    await vi.waitFor(() => expect(state.profiles.get('555').step).toBe('dislikes'));
    await postUpdate(app, textUpdate('нет'));
    await vi.waitFor(() => expect(state.profiles.get('555').step).toBe('allergies'));
    await postUpdate(app, textUpdate('нет'));
    await vi.waitFor(() => expect(state.profiles.get('555').step).toBe('kcal_opt_in'));
    await postUpdate(app, textUpdate('пропустить'));
    await vi.waitFor(() => expect(state.profiles.get('555').step).toBe('complete'));

    expect(state.profiles.get('555').allergies).toBe('нет');
    expect(state.profiles.get('555').allergies).not.toBe('Пропущено');
    await postUpdate(app, textUpdate('Рецепт супа'));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(1));
    expect(mocks.triggerAgent.mock.calls[0][1]).toMatch(/Аллергии и непереносимость: нет/);
  });

  it('restores the same conversation with a fresh router and isolates another chat', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const firstApp = buildApp();
    await postUpdate(firstApp, textUpdate('Первый чат', { chatId: 555 }));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(1));

    const secondApp = buildApp();
    await postUpdate(secondApp, textUpdate('После рестарта', { chatId: 555 }));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(2));
    await postUpdate(secondApp, textUpdate('Другой чат', { chatId: 556 }));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(3));

    expect(mocks.triggerAgent.mock.calls.map((call) => call[0])).toEqual([1001, 1001, 1002]);
    expect(state.conversations).toHaveLength(2);
  });

  it('rejects other users and groups without invoking Ramzi', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp();

    await postUpdate(app, textUpdate('Посторонний', { userId: 999, chatId: 999 }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/приват/i));
    await postUpdate(app, textUpdate('Группа', { chatId: -100, chatType: 'group' }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/личных/i));
    await postUpdate(app, callbackUpdate('ramzi:edit:equipment', { userId: 999, chatId: 999 }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/приват/i));

    expect(mocks.triggerAgent).not.toHaveBeenCalled();
    expect(state.conversations).toHaveLength(0);
    expect(state.profiles.has(OWNER_ID)).toBe(false);
  });

  it('claims update_id once across repeated delivery and separate routers', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const update = textUpdate('Только один раз');

    expect((await postUpdate(buildApp(), update)).status).toBe(200);
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(1));
    const sends = sentTexts().length;
    expect((await postUpdate(buildApp(), update)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mocks.triggerAgent).toHaveBeenCalledTimes(1);
    expect(sentTexts()).toHaveLength(sends);
    expect(state.updates.has(update.update_id)).toBe(true);
  });

  it('splits a long recipe without truncation and puts video actions only on its last part', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp();
    await postUpdate(app, textUpdate('/start'));
    await vi.waitFor(() => expect(state.profiles.get('555')).toBeDefined());
    Object.assign(state.profiles.get('555'), { step: 'complete', photo_opt_in: false });
    state.nextResponse = `🍽 Блюдо: Длинный рецепт\n${'я'.repeat(9000)}END`;
    mocks.fetch.mockClear();

    await postUpdate(app, textUpdate('Длинный рецепт'));
    await vi.waitFor(() => expect(sentTexts().length).toBeGreaterThanOrEqual(3));
    const bodies = mocks.fetch.mock.calls
      .filter(([url]) => url.endsWith('/sendMessage'))
      .map(([, options]) => JSON.parse(options.body));

    expect(bodies.every((body) => body.text.length <= 4096)).toBe(true);
    expect(bodies.map((body) => body.text).join('')).toBe(state.nextResponse.replace('\n', ''));
    expect(bodies.every((body) => body.parse_mode === undefined)).toBe(true);
    expect(bodies.slice(0, -1).every((body) => body.reply_markup.inline_keyboard === undefined)).toBe(true);
    expect(bodies.at(-1).reply_markup).toEqual({
      inline_keyboard: [[{ text: '▶ Видео', callback_data: 'ramzi:video' }]],
    });
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/editMessageReplyMarkup'))).toBe(false);
  });

  it('rate-limits bursts instead of starting unlimited agent runs', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp();

    for (let i = 0; i < 11; i += 1) await postUpdate(app, textUpdate(`Сообщение ${i}`));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Слишком много/i));
    expect(mocks.triggerAgent).toHaveBeenCalledTimes(10);
  });

  it('refreshes an empty token cache during setup without a restart', async () => {
    createDbHarness();
    const app = buildApp();
    mocks.getSecret.mockResolvedValue(null);
    const missing = await request(app).post('/api/v3/telegram/ramzi/setup').set('x-test-user-id', '17');
    expect(missing.status).toBe(503);

    mocks.getSecret.mockResolvedValue(BOT_TOKEN);
    const configured = await request(app).post('/api/v3/telegram/ramzi/setup').set('x-test-user-id', '17');
    expect(configured.status).toBe(200);
    expect(configured.body.data.bot).toBe('ramzi_test_bot');
  });

  it('sets only the Ramzi webhook with the same derived secret', async () => {
    createDbHarness();
    const app = buildApp();
    const res = await request(app).post('/api/v3/telegram/ramzi/setup').set('x-test-user-id', '17');
    expect(res.status).toBe(200);

    const call = mocks.fetch.mock.calls.find(([url]) => url.endsWith('/setWebhook'));
    const body = JSON.parse(call[1].body);
    expect(body.url).toBe('https://app.godcrm.ai/api/v3/telegram/ramzi/webhook');
    expect(body.secret_token).toBe(WEBHOOK_SECRET);
    expect(body.allowed_updates).toEqual(['message', 'callback_query']);
    expect(JSON.stringify(res.body)).not.toContain(BOT_TOKEN);
  });

  it('issues invites and isolates guest profiles, dishes and conversations from the owner', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp();
    await postUpdate(app, textUpdate('/start'));
    await vi.waitFor(() => expect(state.profiles.get('555')).toBeDefined());
    Object.assign(state.profiles.get('555'), {
      step: 'complete', equipment: 'Духовка владельца', disliked_foods: 'Кинза', allergies: 'Арахис',
      pantry_text: 'Сыр владельца', last_dish: 'Блюдо владельца', daily_kcal: 2000, photo_opt_in: false,
      last_mode: 'pantry', kcal_opt_in: true, goal: 'maintain',
    });

    const forbidden = await request(app).post('/api/v3/telegram/ramzi/invites').set('x-test-user-id', '999').send({ label: 'Миша' });
    expect(forbidden.status).toBe(403);
    const issued = await request(app).post('/api/v3/telegram/ramzi/invites').set('x-test-user-id', '17').send({ label: 'Миша' });
    expect(issued.status).toBe(200);
    expect(issued.body.data.code).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(JSON.stringify(issued.body)).not.toContain('code_hash');

    await postUpdate(app, textUpdate(`/start ${issued.body.data.code}`, { userId: 556, chatId: 556 }));
    await vi.waitFor(() => expect(state.profiles.get('556')).toBeDefined());
    expect(state.ramziParticipants.get('556')).toMatchObject({ label: 'Миша', role: 'guest', status: 'active' });
    Object.assign(state.profiles.get('556'), {
      step: 'complete', equipment: 'Аэрогриль гостя', disliked_foods: 'Грибы', allergies: 'Молоко',
      pantry_text: 'Рис гостя', last_dish: 'Блюдо гостя', daily_kcal: 1600, photo_opt_in: false,
      last_mode: 'pantry', kcal_opt_in: true, goal: 'maintain',
    });

    await postUpdate(app, textUpdate('Запрос владельца'));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(1));
    await postUpdate(app, textUpdate('Запрос гостя', { userId: 556, chatId: 556 }));
    await vi.waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(2));
    const [ownerConversation, ownerPrompt] = mocks.triggerAgent.mock.calls[0];
    const [guestConversation, guestPrompt] = mocks.triggerAgent.mock.calls[1];
    expect(guestConversation).not.toBe(ownerConversation);
    expect(ownerPrompt).toContain('Духовка владельца');
    expect(ownerPrompt).not.toContain('Аэрогриль гостя');
    expect(guestPrompt).toContain('Аэрогриль гостя');
    expect(guestPrompt).toContain('Рис гостя');
    expect(guestPrompt).toContain('1600 ккал');
    expect(guestPrompt).toContain('Имя участника: Миша');
    expect(guestPrompt).not.toContain('Духовка владельца');
    expect(guestPrompt).not.toContain('2000 ккал');
    expect(state.conversations.find((conversation) => conversation.id === guestConversation).title).toContain('Миша');

    state.nextResponse = '🍽 Блюдо: Новое блюдо гостя\n\nРецепт';
    await postUpdate(app, textUpdate('Ещё рецепт', { userId: 556, chatId: 556 }));
    await vi.waitFor(() => expect(state.profiles.get('556').last_dish).toBe('Новое блюдо гостя'));
    expect(state.profiles.get('555').last_dish).toBe('Блюдо владельца');

    await postUpdate(app, textUpdate(`/start ${issued.body.data.code}`, { userId: 557, chatId: 557 }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/приват/i));
    expect(state.ramziParticipants.has('557')).toBe(false);

    const participants = await request(app).get('/api/v3/telegram/ramzi/participants').set('x-test-user-id', '17');
    expect(participants.status).toBe(200);
    expect(participants.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ telegram_user_id: '555', role: 'owner' }),
      expect.objectContaining({ telegram_user_id: '556', role: 'guest', label: 'Миша' }),
    ]));
    expect((await request(app).post('/api/v3/telegram/ramzi/participants/555/revoke').set('x-test-user-id', '17')).status).toBe(400);
    expect((await request(app).post('/api/v3/telegram/ramzi/participants/999/revoke').set('x-test-user-id', '17')).status).toBe(404);
    expect((await request(app).post('/api/v3/telegram/ramzi/participants/556/revoke').set('x-test-user-id', '17')).status).toBe(200);
    await postUpdate(app, textUpdate('Ещё запрос', { userId: 556, chatId: 556 }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Доступ отозван/i));
    expect(mocks.triggerAgent).toHaveBeenCalledTimes(3);

    const invites = await request(app).get('/api/v3/telegram/ramzi/invites').set('x-test-user-id', '17');
    expect(invites.status).toBe(200);
    expect(JSON.stringify(invites.body)).not.toContain('code_hash');
    expect(JSON.stringify(invites.body)).not.toContain(issued.body.data.code);
  });

  it('revokes unused invites and lets a guest erase only their own profile with /forget', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp({ guestDailyLimit: 2 });
    const issue = (label) => request(app).post('/api/v3/telegram/ramzi/invites').set('x-test-user-id', '17').send({ label });

    const revoked = await issue('Отозванный');
    expect((await request(app).delete(`/api/v3/telegram/ramzi/invites/${revoked.body.data.id}`).set('x-test-user-id', '17')).status).toBe(200);
    await postUpdate(app, textUpdate(`/start ${revoked.body.data.code}`, { userId: 556, chatId: 556 }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/приват/i));
    expect(state.ramziParticipants.has('556')).toBe(false);

    const invited = await issue('Гость');
    await postUpdate(app, textUpdate(`/start ${invited.body.data.code}`, { userId: 557, chatId: 557 }));
    await vi.waitFor(() => expect(state.profiles.get('557')).toBeDefined());
    await postUpdate(app, textUpdate('/forget', { userId: 557, chatId: 557 }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/подтвержд/i));
    expect(state.profiles.get('557')).toBeDefined();
    await postUpdate(app, textUpdate('/forget confirm', { userId: 557, chatId: 557 }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/удалены/i));
    expect(state.profiles.has('557')).toBe(false);
    expect(state.ramziParticipants.get('557').status).toBe('revoked');
    expect(state.conversations.filter((conversation) => conversation.settings.telegram_ramzi_participant === '557')).toHaveLength(1);
  });

  it('enforces guest and total daily limits while leaving the owner unlimited', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp({ guestDailyLimit: 2, totalDailyLimit: 100 });
    const issued = await request(app).post('/api/v3/telegram/ramzi/invites').set('x-test-user-id', '17').send({ label: 'Миша' });
    await postUpdate(app, textUpdate(`/start ${issued.body.data.code}`, { userId: 556, chatId: 556 }));
    await vi.waitFor(() => expect(state.profiles.get('556')).toBeDefined());
    await postUpdate(app, textUpdate('Плита', { userId: 556, chatId: 556 }));
    await vi.waitFor(() => expect(state.profiles.get('556').step).toBe('dislikes'));
    await postUpdate(app, textUpdate('Кинза', { userId: 556, chatId: 556 }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Дневной лимит/i));
    expect(state.profiles.get('556').step).toBe('dislikes');

    const totalState = createDbHarness();
    totalState.users.get(OWNER_ID).telegram_user_id = '555';
    const totalApp = buildApp({ guestDailyLimit: 10, totalDailyLimit: 2 });
    for (const [label, userId] of [['Первый', 556], ['Второй', 557]]) {
      const invite = await request(totalApp).post('/api/v3/telegram/ramzi/invites').set('x-test-user-id', '17').send({ label });
      await postUpdate(totalApp, textUpdate(`/start ${invite.body.data.code}`, { userId, chatId: userId }));
      await vi.waitFor(() => expect(totalState.ramziParticipants.get(String(userId))).toBeDefined());
    }
    await postUpdate(totalApp, textUpdate('Сверх общего лимита', { userId: 557, chatId: 557 }));
    await vi.waitFor(() => expect(sentTexts().at(-1)).toMatch(/Дневной лимит/i));
    await postUpdate(totalApp, textUpdate('/start'));
    await vi.waitFor(() => expect(totalState.profiles.get('555')).toBeDefined());
  });

  it('does not let rejected strangers exhaust the guests total daily limit', async () => {
    const state = createDbHarness();
    state.users.get(OWNER_ID).telegram_user_id = '555';
    const app = buildApp({ guestDailyLimit: 10, totalDailyLimit: 2 });
    for (const userId of [901, 902, 903]) {
      await postUpdate(app, textUpdate('Посторонний', { userId, chatId: userId }));
    }
    await vi.waitFor(() => expect(sentTexts()).toHaveLength(3));

    const invite = await request(app).post('/api/v3/telegram/ramzi/invites').set('x-test-user-id', '17').send({ label: 'Гость' });
    await postUpdate(app, textUpdate(`/start ${invite.body.data.code}`, { userId: 556, chatId: 556 }));
    await vi.waitFor(() => expect(state.profiles.get('556')).toBeDefined());
    expect(state.ramziParticipants.get('556').messages_today).toBe(1);
  });
});
