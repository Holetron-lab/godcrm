// @vitest-environment node
import express from 'express';
import request from 'supertest';
import knex from 'knex';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexConfig from '../../../../database/knexfile.js';
import { up } from '../../../../database/migrations/knex/110_telegram_ramzi_private_bot.js';
import { up as onboardingUp } from '../../../../database/migrations/knex/111_telegram_ramzi_onboarding.js';
import { up as modesKcalUp } from '../../../../database/migrations/knex/112_telegram_ramzi_modes_kcal.js';
import { up as mediaUp } from '../../../../database/migrations/knex/113_telegram_ramzi_media.js';
import { up as guestsUp } from '../../../../database/migrations/knex/114_telegram_ramzi_guests.js';

const mocks = vi.hoisted(() => ({ getSecret: vi.fn(), triggerAgent: vi.fn() }));
const waitFor = (callback, options = {}) => vi.waitFor(callback, { timeout: 5000, ...options });

vi.mock('../../../../services/secrets/SecretsVault.js', () => ({
  default: { getSecret: mocks.getSecret },
}));
vi.mock('../../telegram/agentBridge.js', () => ({ triggerAgentViaHttp: mocks.triggerAgent }));
vi.mock('../../auth/authShared.js', () => ({
  requireAuth: (req, res, next) => {
    const id = Number(req.headers['x-test-user-id']);
    if (!id) return res.status(401).json({ success: false });
    req.user = { id };
    next();
  },
}));
vi.mock('../../../../utils/logger.js', () => {
  const apiLogger = {
    info: vi.fn(), warn: vi.fn(), debug: vi.fn(),
    error: vi.fn((...args) => { process.stderr.write(`${JSON.stringify(args)}\n`); }),
    child: () => apiLogger,
  };
  return { apiLogger };
});

const { createTelegramRamziRouter } = await import('../index.js');
const { dbAll, dbGet, dbRun, closeDatabase } = await import('../../../../database/connection.js');
const { getRamziWebhookSecret } = await import('../service.js');

const OWNER_ID = 17;
const AGENT_USER_ID = 8989;
const CHAT_IDS = [
  '900000000001', '900000000002', '900000000003', '900000000004',
  '900000000099', '-1009000000000',
];
const UPDATE_IDS = Array.from({ length: 32 }, (_, index) => 2100000001 + index);
let originalTelegramId;
let webhookSecret;

function buildApp(options = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v3/telegram/ramzi', createTelegramRamziRouter({
    sleep: async () => {}, pollAttempts: 2, delayedPollAttempts: 0,
    guestDailyLimit: 1000, totalDailyLimit: 100000,
    ...options,
  }));
  return app;
}

function update(updateId, text, { chatId = CHAT_IDS[0], userId = CHAT_IDS[0], type = 'private' } = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: Number(userId), first_name: 'Integration' },
      chat: { id: Number(chatId), type },
      text,
    },
  };
}

function callback(updateId, data) {
  return {
    update_id: updateId,
    callback_query: {
      id: `integration-callback-${updateId}`,
      from: { id: Number(CHAT_IDS[0]), first_name: 'Integration' },
      message: {
        message_id: updateId,
        from: { id: AGENT_USER_ID, first_name: 'Ramzi' },
        chat: { id: Number(CHAT_IDS[0]), type: 'private' },
      },
      data,
    },
  };
}

async function post(app, value) {
  return request(app)
    .post('/api/v3/telegram/ramzi/webhook')
    .set('x-telegram-bot-api-secret-token', webhookSecret)
    .send(value);
}

async function cleanup() {
  const conversations = await dbAll(
    "SELECT id FROM conversations WHERE ((settings::jsonb)->>'telegram_ramzi_chat_id') = ANY($1::text[])",
    [CHAT_IDS]
  );
  const ids = conversations.map((row) => row.id);
  if (ids.length) {
    await dbRun('DELETE FROM messages WHERE conversation_id = ANY($1::int[])', [ids]);
    await dbRun('DELETE FROM conversation_participants WHERE conversation_id = ANY($1::int[])', [ids]);
    await dbRun('DELETE FROM conversations WHERE id = ANY($1::int[])', [ids]);
  }
  await dbRun('DELETE FROM telegram_ramzi_profiles WHERE telegram_user_id = ANY($1::bigint[])', [CHAT_IDS]);
  await dbRun('DELETE FROM telegram_ramzi_invites WHERE created_by = $1', [OWNER_ID]);
  await dbRun('DELETE FROM telegram_ramzi_participants WHERE telegram_user_id = ANY($1::bigint[])', [CHAT_IDS]);
  await dbRun('DELETE FROM telegram_ramzi_updates WHERE update_id = ANY($1::bigint[])', [UPDATE_IDS]);
  await dbRun('DELETE FROM telegram_ramzi_bindings WHERE user_id = $1', [OWNER_ID]);
  await dbRun('UPDATE users SET telegram_user_id = $1 WHERE id = $2', [originalTelegramId, OWNER_ID]);
}

beforeAll(async () => {
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);

  const migrationDb = knex(knexConfig.getConfig('test'));
  await up(migrationDb);
  await onboardingUp(migrationDb);
  await modesKcalUp(migrationDb);
  await mediaUp(migrationDb);
  await guestsUp(migrationDb);
  await migrationDb.destroy();

  const owner = await dbGet('SELECT telegram_user_id FROM users WHERE id = $1', [OWNER_ID]);
  originalTelegramId = owner.telegram_user_id;
  const agent = await dbGet(
    "SELECT id FROM users WHERE id = $1 AND user_type = 'agent' AND managed_by_agent_row_id = $2",
    [AGENT_USER_ID, 261935]
  );
  if (!agent) {
    await dbRun(`
      INSERT INTO users
        (id, email, password_hash, name, encryption_key_encrypted, user_type,
         managed_by_agent_table_id, managed_by_agent_row_id, created_at, updated_at)
      VALUES ($1, 'ramzi-integration@agents.godcrm.local', 'not-used', 'Povarenok_Ramzy',
              'not-used', 'agent', 1784, 261935, NOW(), NOW())
    `, [AGENT_USER_ID]);
  }

  mocks.getSecret.mockResolvedValue('INTEGRATIONTOKEN');
  webhookSecret = await getRamziWebhookSecret();
});

beforeEach(async () => {
  await cleanup();
  await dbRun('UPDATE users SET telegram_user_id = NULL WHERE id = $1', [OWNER_ID]);
  mocks.triggerAgent.mockReset();
  mocks.triggerAgent.mockImplementation(async (conversationId, content) => {
    try {
      await dbRun(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, metadata, created_at, updated_at)
        VALUES ($1, $2, 'human', 'user', $3, 'text', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW(), NOW())
      `, [conversationId, OWNER_ID, content]);
      await dbRun(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, metadata, created_at, updated_at)
        VALUES ($1, $2, 'agent', 'assistant', $3, 'thinking', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW(), NOW())
      `, [conversationId, AGENT_USER_ID, `Рамзи: ${content}`]);
      await dbRun(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, metadata, created_at, updated_at)
        VALUES ($1, $2, 'agent', 'assistant', $3, 'text', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW(), NOW())
      `, [conversationId, AGENT_USER_ID, `Рамзи: ${content}`]);
      return true;
    } catch (err) {
      throw new Error(`conversationId=${conversationId}: ${err.message}`);
    }
  });
  mocks.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, result: { message_id: 1, username: 'ramzi_integration_bot' } }),
  }));
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await cleanup();
  await dbRun("DELETE FROM users WHERE id = $1 AND email = 'ramzi-integration@agents.godcrm.local'", [AGENT_USER_ID]);
  closeDatabase();
});

describe.sequential('Ramzi router with real godcrm_test SQL', () => {
  it('binds with a one-time code and consumes it atomically', async () => {
    const app = buildApp();
    const issued = await request(app)
      .post('/api/v3/telegram/ramzi/binding-code')
      .set('x-test-user-id', String(OWNER_ID));
    expect(issued.status).toBe(200);

    expect((await post(app, update(UPDATE_IDS[0], `/start ${issued.body.data.code}`))).status).toBe(200);
    await waitFor(async () => {
      const owner = await dbGet('SELECT telegram_user_id FROM users WHERE id = $1', [OWNER_ID]);
      expect(String(owner.telegram_user_id)).toBe(CHAT_IDS[0]);
    });
    expect(await dbGet('SELECT id FROM telegram_ramzi_bindings WHERE user_id = $1', [OWNER_ID])).toBeNull();
    expect(await dbGet("SELECT id FROM conversations WHERE (settings::jsonb)->>'telegram_ramzi_chat_id' = $1", [CHAT_IDS[0]])).toBeDefined();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  });

  it('persists and restores history, isolates chats and deduplicates real updates', async () => {
    await dbRun('UPDATE users SET telegram_user_id = $1 WHERE id = $2', [CHAT_IDS[0], OWNER_ID]);
    const firstApp = buildApp();

    const firstResponse = await post(firstApp, update(UPDATE_IDS[0], 'Рецепт'));
    expect(firstResponse.status).toBe(200);
    await waitFor(() => expect(mocks.triggerAgent, JSON.stringify(firstResponse.body)).toHaveBeenCalledTimes(1), { timeout: 5000 });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1), { timeout: 5000 });
    const conversationId = mocks.triggerAgent.mock.calls[0][0];

    const restoredApp = buildApp();
    await post(restoredApp, update(UPDATE_IDS[1], 'Уточнение'));
    await waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(mocks.triggerAgent.mock.calls[1][0]).toBe(conversationId);

    await post(restoredApp, update(UPDATE_IDS[2], 'Другой чат', { chatId: CHAT_IDS[1] }));
    await waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(3), { timeout: 5000 });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3), { timeout: 5000 });
    expect(mocks.triggerAgent.mock.calls[2][0]).not.toBe(conversationId);

    const repeated = update(UPDATE_IDS[3], 'Повтор');
    await post(restoredApp, repeated);
    await waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(4));
    await post(buildApp(), repeated);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.triggerAgent).toHaveBeenCalledTimes(4);

    await post(restoredApp, update(UPDATE_IDS[4], 'Чужой', { userId: '900000000099', chatId: '900000000099' }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(5));
    await post(restoredApp, update(UPDATE_IDS[5], 'Группа', { chatId: '-1009000000000', type: 'group' }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(6));
    expect(mocks.triggerAgent).toHaveBeenCalledTimes(4);

    const stored = await dbAll(
      'SELECT id, content FROM messages WHERE conversation_id = $1 AND role = $2 ORDER BY id',
      [conversationId, 'user']
    );
    expect(stored.map((row) => row.content)).toEqual(['Рецепт', 'Уточнение', 'Повтор']);
    expect(mocks.fetch.mock.calls.every(([url]) => !url.includes('godcrmbot'))).toBe(true);
  });

  it('runs onboarding and restores the saved profile after a fresh router', async () => {
    await dbRun('UPDATE users SET telegram_user_id = $1 WHERE id = $2', [CHAT_IDS[0], OWNER_ID]);
    const app = buildApp();

    await post(app, update(UPDATE_IDS[0], '/start'));
    await waitFor(async () => {
      expect(await dbGet('SELECT step FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]])).toMatchObject({ step: 'equipment' });
    });
    const keyboard = JSON.parse(mocks.fetch.mock.calls.at(-1)[1].body).reply_markup;
    expect(keyboard.is_persistent).toBe(true);
    expect(keyboard.keyboard[0].map((button) => button.text)).toEqual(['Моя анкета', 'Приступаем к работе']);

    await post(app, update(UPDATE_IDS[1], 'Духовка Bosch HBG 633'));
    await waitFor(async () => {
      expect(await dbGet('SELECT step FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]])).toMatchObject({ step: 'dislikes' });
    });

    const restoredApp = buildApp();
    const restoredResponse = await post(restoredApp, update(UPDATE_IDS[2], '/start'));
    await waitFor(() => expect(mocks.fetch, JSON.stringify(restoredResponse.body)).toHaveBeenCalledTimes(3), { timeout: 5000 });
    expect(await dbGet('SELECT equipment, step FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]]))
      .toMatchObject({ equipment: 'Духовка Bosch HBG 633', step: 'dislikes' });

    await post(restoredApp, update(UPDATE_IDS[3], 'Кинза'));
    await waitFor(async () => {
      expect(await dbGet('SELECT step FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]])).toMatchObject({ step: 'allergies' });
    });
    await post(restoredApp, update(UPDATE_IDS[4], 'нет'));
    await waitFor(async () => {
      expect(await dbGet('SELECT step FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]])).toMatchObject({ step: 'kcal_opt_in' });
    });
    await post(restoredApp, update(UPDATE_IDS[5], 'пропустить'));
    await waitFor(async () => {
      expect(await dbGet('SELECT step, kcal_opt_in FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]]))
        .toMatchObject({ step: 'complete', kcal_opt_in: false });
    });

    await post(restoredApp, update(UPDATE_IDS[6], 'Моя анкета'));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(8));
    expect(JSON.parse(mocks.fetch.mock.calls.at(-1)[1].body).text).toContain('Аллергии и непереносимость: нет');
    await post(restoredApp, update(UPDATE_IDS[7], 'Приступаем к работе'));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(9));
    expect(JSON.parse(mocks.fetch.mock.calls.at(-1)[1].body).text).toContain('Рецепт по настроению');
    expect(mocks.triggerAgent).not.toHaveBeenCalled();

    await post(restoredApp, update(UPDATE_IDS[8], 'Дай рецепт курицы'));
    await waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(mocks.triggerAgent.mock.calls[0][1]).toContain('Техника: Духовка Bosch HBG 633');
    expect(mocks.triggerAgent.mock.calls[0][1]).toContain('Нелюбимые продукты: Кинза');
    expect(mocks.triggerAgent.mock.calls[0][1]).toContain('Аллергии и непереносимость: нет');
    await waitFor(async () => {
      const duplicate = await dbGet(`
        SELECT COUNT(*)::int AS count FROM messages
        WHERE conversation_id = $1 AND sender_id = $2 AND content_type = 'thinking' AND content LIKE 'Рамзи:%'
      `, [mocks.triggerAgent.mock.calls[0][0], AGENT_USER_ID]);
      expect(duplicate.count).toBe(0);
    });

    await post(restoredApp, update(UPDATE_IDS[9], 'Рецепт по настроению'));
    await waitFor(async () => {
      expect(await dbGet('SELECT last_mode FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]]))
        .toMatchObject({ last_mode: 'mood' });
    });
    await post(restoredApp, update(UPDATE_IDS[10], 'ужин'));
    await waitFor(() => expect(mocks.triggerAgent).toHaveBeenCalledTimes(2));
    expect(mocks.triggerAgent.mock.calls[1][1]).toContain('Список покупок');

    await post(restoredApp, update(UPDATE_IDS[11], '/start'));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(14));
    expect(await dbGet('SELECT equipment, disliked_foods, allergies, step FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]]))
      .toMatchObject({ equipment: 'Духовка Bosch HBG 633', disliked_foods: 'Кинза', allergies: 'нет', step: 'complete' });
    expect(mocks.triggerAgent).toHaveBeenCalledTimes(2);
  });

  it('persists the recipe dish, suppresses photos and reuses the dish for video with real SQL', async () => {
    await dbRun('UPDATE users SET telegram_user_id = $1 WHERE id = $2', [CHAT_IDS[0], OWNER_ID]);
    await dbRun(`
      INSERT INTO telegram_ramzi_participants (telegram_user_id, label, role, status, invited_by)
      VALUES ($1, 'Integration Owner', 'owner', 'active', $2)
      ON CONFLICT (telegram_user_id) DO UPDATE SET status = 'active', revoked_at = NULL
      RETURNING telegram_user_id AS id
    `, [CHAT_IDS[0], OWNER_ID]);
    await dbRun(`
      INSERT INTO telegram_ramzi_profiles
        (telegram_user_id, step, equipment, disliked_foods, allergies, kcal_opt_in, photo_opt_in)
      VALUES ($1, 'complete', 'Духовка', 'Кинза', 'нет', false, false)
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        step = 'complete', equipment = 'Духовка', disliked_foods = 'Кинза',
        allergies = 'нет', kcal_opt_in = false, photo_opt_in = false
      RETURNING telegram_user_id AS id
    `, [CHAT_IDS[0]]);
    mocks.triggerAgent.mockImplementation(async (conversationId, content) => {
      await dbRun(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, metadata, created_at, updated_at)
        VALUES ($1, $2, 'human', 'user', $3, 'text', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW(), NOW())
      `, [conversationId, OWNER_ID, content]);
      await dbRun(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, metadata, created_at, updated_at)
        VALUES ($1, $2, 'agent', 'assistant', '🍽 Блюдо: Курица терияки\n\nРецепт', 'text', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW(), NOW())
      `, [conversationId, AGENT_USER_ID]);
      return true;
    });
    mocks.fetch.mockImplementation(async (url) => {
      if (url.includes('/search?')) {
        expect(new URL(url, 'http://searxng.test').searchParams.get('categories')).toBe('videos');
        return {
          ok: true, status: 200,
          json: async () => ({ results: [
            { title: 'Курица терияки', url: 'https://youtube.com/watch?v=integration-best' },
            { title: 'Соус терияки', url: 'https://youtube.com/watch?v=integration-other' },
          ] }),
        };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, result: { message_id: 88, username: 'ramzi_integration_bot' } }),
      };
    });
    const app = buildApp();

    await post(app, update(UPDATE_IDS[12], 'ужин'));
    await waitFor(async () => {
      expect(await dbGet('SELECT last_dish, photo_opt_in FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]]))
        .toMatchObject({ last_dish: 'Курица терияки', photo_opt_in: false });
    });
    expect(mocks.fetch.mock.calls.some(([url]) => url.endsWith('/sendPhoto'))).toBe(false);

    await post(app, callback(UPDATE_IDS[13], 'ramzi:video'));
    await waitFor(() => {
      expect(mocks.fetch.mock.calls.some(([url, options]) => (
        url.endsWith('/sendMessage') && JSON.parse(options.body).text.includes('https://youtube.com/watch?v=integration-best')
      )), JSON.stringify(mocks.fetch.mock.calls.map(([url]) => url))).toBe(true);
    });

    await post(app, callback(UPDATE_IDS[14], 'ramzi:photo:toggle'));
    await waitFor(async () => {
      expect(await dbGet('SELECT photo_opt_in, equipment, last_dish FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]]))
        .toMatchObject({ photo_opt_in: true, equipment: 'Духовка', last_dish: 'Курица терияки' });
    });
  });

  it('admits one invited guest with isolated SQL data and forgets only the guest profile', async () => {
    await dbRun('UPDATE users SET telegram_user_id = $1 WHERE id = $2', [CHAT_IDS[0], OWNER_ID]);
    const app = buildApp();
    await post(app, update(UPDATE_IDS[0], '/start'));
    await waitFor(async () => {
      expect(await dbGet('SELECT step FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]])).toBeDefined();
    });

    const issued = await request(app).post('/api/v3/telegram/ramzi/invites').set('x-test-user-id', String(OWNER_ID)).send({ label: 'Миша' });
    expect(issued.status).toBe(200);
    await post(app, update(UPDATE_IDS[1], `/start ${issued.body.data.code}`, { chatId: CHAT_IDS[1], userId: CHAT_IDS[1] }));
    await waitFor(async () => {
      expect(await dbGet('SELECT step FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[1]])).toMatchObject({ step: 'equipment' });
    });
    await post(app, update(UPDATE_IDS[2], 'Аэрогриль гостя', { chatId: CHAT_IDS[1], userId: CHAT_IDS[1] }));
    await waitFor(async () => {
      expect(await dbGet('SELECT step, equipment FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[1]]))
        .toMatchObject({ step: 'dislikes', equipment: 'Аэрогриль гостя' });
    });
    expect(await dbGet('SELECT step, equipment FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]]))
      .toMatchObject({ step: 'equipment', equipment: null });
    const conversation = await dbGet(`
      SELECT id, title, (settings::jsonb)->>'telegram_ramzi_participant' AS participant
      FROM conversations WHERE (settings::jsonb)->>'telegram_ramzi_chat_id' = $1
    `, [CHAT_IDS[1]]);
    expect(conversation).toMatchObject({ participant: CHAT_IDS[1] });
    expect(conversation.title).toContain('Миша');

    const beforeReuse = mocks.fetch.mock.calls.length;
    await post(app, update(UPDATE_IDS[3], `/start ${issued.body.data.code}`, { chatId: CHAT_IDS[2], userId: CHAT_IDS[2] }));
    await waitFor(() => expect(mocks.fetch.mock.calls.length).toBeGreaterThan(beforeReuse));
    expect(await dbGet('SELECT telegram_user_id FROM telegram_ramzi_participants WHERE telegram_user_id = $1', [CHAT_IDS[2]])).toBeNull();

    await post(app, update(UPDATE_IDS[4], '/forget', { chatId: CHAT_IDS[1], userId: CHAT_IDS[1] }));
    await post(app, update(UPDATE_IDS[5], '/forget confirm', { chatId: CHAT_IDS[1], userId: CHAT_IDS[1] }));
    await waitFor(async () => {
      expect(await dbGet('SELECT telegram_user_id FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[1]])).toBeNull();
    });
    expect(await dbGet('SELECT status FROM telegram_ramzi_participants WHERE telegram_user_id = $1', [CHAT_IDS[1]]))
      .toMatchObject({ status: 'revoked' });
    expect(await dbGet('SELECT telegram_user_id FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [CHAT_IDS[0]])).toBeDefined();
    expect(await dbGet('SELECT id FROM conversations WHERE id = $1', [conversation.id])).toBeDefined();
    expect(mocks.triggerAgent).not.toHaveBeenCalled();
  }, 15000);
});
