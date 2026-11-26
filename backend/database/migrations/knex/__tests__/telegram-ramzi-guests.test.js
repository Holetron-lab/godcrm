import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import knex from 'knex';
import knexConfig from '../../../knexfile.js';
import { down, up } from '../114_telegram_ramzi_guests.js';

const OWNER_ID = 17;
const OWNER_TELEGRAM_ID = '900000000117';
const GUEST_TELEGRAM_ID = '900000000118';
let db;
let trx;

beforeAll(async () => {
  db = knex(knexConfig.getConfig('test'));
  const { rows: [actual] } = await db.raw('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

beforeEach(async () => {
  trx = await db.transaction();
  await trx('users').where({ id: OWNER_ID }).update({ telegram_user_id: OWNER_TELEGRAM_ID });
  const profileKey = await trx('information_schema.columns')
    .select('column_name')
    .where({ table_name: 'telegram_ramzi_profiles', column_name: 'user_id' })
    .first();
  if (profileKey) await up(trx);
});

afterEach(async () => {
  await trx.rollback();
});

afterAll(async () => {
  await db.destroy();
});

describe('migration 114 — Ramzi guest participants', () => {
  it('migrates the owner profile both ways and removes guest data on rollback', async () => {
    await down(trx);
    await trx('telegram_ramzi_profiles').insert({
      user_id: OWNER_ID,
      step: 'complete',
      equipment: 'Духовка Bosch',
      disliked_foods: 'Кинза',
      allergies: 'Арахис',
      photo_opt_in: false,
      last_dish: 'Курица терияки',
    }).onConflict('user_id').merge({
      step: 'complete',
      equipment: 'Духовка Bosch',
      disliked_foods: 'Кинза',
      allergies: 'Арахис',
      photo_opt_in: false,
      last_dish: 'Курица терияки',
    });

    await up(trx);
    await up(trx);
    expect(await trx('telegram_ramzi_participants').where({ telegram_user_id: OWNER_TELEGRAM_ID }).first())
      .toMatchObject({ role: 'owner', status: 'active', invited_by: OWNER_ID });
    expect(await trx('telegram_ramzi_profiles').where({ telegram_user_id: OWNER_TELEGRAM_ID }).first())
      .toMatchObject({
        step: 'complete', equipment: 'Духовка Bosch', disliked_foods: 'Кинза',
        allergies: 'Арахис', photo_opt_in: false, last_dish: 'Курица терияки',
      });

    await trx('telegram_ramzi_participants').insert({
      telegram_user_id: GUEST_TELEGRAM_ID, label: 'Гость', role: 'guest', status: 'active', invited_by: OWNER_ID,
    });
    await trx('telegram_ramzi_profiles').insert({ telegram_user_id: GUEST_TELEGRAM_ID, step: 'complete' });

    await down(trx);
    expect(await trx('telegram_ramzi_profiles').where({ user_id: OWNER_ID }).first())
      .toMatchObject({ equipment: 'Духовка Bosch', last_dish: 'Курица терияки' });
    expect(await trx('telegram_ramzi_profiles').count('* as count').first()).toMatchObject({ count: '1' });
    expect(await trx('information_schema.tables').where({ table_name: 'telegram_ramzi_participants' }).first()).toBeUndefined();

    await up(trx);
    expect(await trx('telegram_ramzi_profiles').where({ telegram_user_id: OWNER_TELEGRAM_ID }).first())
      .toMatchObject({ equipment: 'Духовка Bosch', last_dish: 'Курица терияки' });
  });
});
