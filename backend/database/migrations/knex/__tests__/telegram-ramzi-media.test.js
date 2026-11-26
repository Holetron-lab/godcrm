import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex from 'knex';
import knexConfig from '../../../knexfile.js';
import { up as modesKcalUp } from '../112_telegram_ramzi_modes_kcal.js';
import { down, up } from '../113_telegram_ramzi_media.js';
import { up as guestsUp } from '../114_telegram_ramzi_guests.js';

const TEST_TELEGRAM_ID = '900000000218';
let db;

beforeAll(async () => {
  db = knex(knexConfig.getConfig('test'));
  const { rows: [actual] } = await db.raw('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
  await modesKcalUp(db);
  await up(db);
  await guestsUp(db);
  await db('telegram_ramzi_participants').insert({ telegram_user_id: TEST_TELEGRAM_ID, role: 'guest' })
    .onConflict('telegram_user_id').merge({ status: 'active', revoked_at: null });
});

afterAll(async () => {
  await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).delete();
  await db('telegram_ramzi_participants').where({ telegram_user_id: TEST_TELEGRAM_ID }).delete();
  await modesKcalUp(db);
  await up(db);
  await guestsUp(db);
  await db.destroy();
});

describe('migration 113 — Ramzi recipe media', () => {
  it('rolls down to schema 112 and back up with photo preference and last dish', async () => {
    await db('telegram_ramzi_profiles').insert({ telegram_user_id: TEST_TELEGRAM_ID, step: 'complete' })
      .onConflict('telegram_user_id').merge({ step: 'complete', photo_opt_in: false, last_dish: 'Курица терияки' });

    await down(db);
    const oldColumns = await db('information_schema.columns')
      .select('column_name')
      .where({ table_name: 'telegram_ramzi_profiles' });
    expect(oldColumns.map((column) => column.column_name)).not.toContain('photo_opt_in');
    expect(oldColumns.map((column) => column.column_name)).not.toContain('last_dish');

    await up(db);
    const columns = await db('information_schema.columns')
      .select('column_name', 'is_nullable', 'column_default')
      .where({ table_name: 'telegram_ramzi_profiles' });
    expect(columns.find((column) => column.column_name === 'photo_opt_in')).toMatchObject({
      is_nullable: 'NO', column_default: 'true',
    });
    expect(columns.find((column) => column.column_name === 'last_dish').is_nullable).toBe('YES');
    expect(await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).first()).toMatchObject({
      photo_opt_in: true, last_dish: null,
    });

    await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).update({
      photo_opt_in: false, last_dish: 'Курица терияки',
    });
    expect(await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).first()).toMatchObject({
      photo_opt_in: false, last_dish: 'Курица терияки',
    });
    await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).delete();
  });
});
