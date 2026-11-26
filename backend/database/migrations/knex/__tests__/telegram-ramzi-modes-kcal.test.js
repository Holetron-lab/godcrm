import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex from 'knex';
import knexConfig from '../../../knexfile.js';
import { up as onboardingUp } from '../111_telegram_ramzi_onboarding.js';
import { down, up } from '../112_telegram_ramzi_modes_kcal.js';
import { up as mediaUp } from '../113_telegram_ramzi_media.js';
import { up as guestsUp } from '../114_telegram_ramzi_guests.js';

const TEST_TELEGRAM_ID = '900000000217';
let db;

beforeAll(async () => {
  db = knex(knexConfig.getConfig('test'));
  const { rows: [actual] } = await db.raw('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
  await onboardingUp(db);
  await up(db);
  await mediaUp(db);
  await guestsUp(db);
  await db('telegram_ramzi_participants').insert({ telegram_user_id: TEST_TELEGRAM_ID, role: 'guest' })
    .onConflict('telegram_user_id').merge({ status: 'active', revoked_at: null });
});

afterAll(async () => {
  await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).delete();
  await db('telegram_ramzi_participants').where({ telegram_user_id: TEST_TELEGRAM_ID }).delete();
  await onboardingUp(db);
  await up(db);
  await mediaUp(db);
  await guestsUp(db);
  await db.destroy();
});

describe('migration 112 — Ramzi modes and calorie profile', () => {
  it('rolls down to schema 111 and back up with extended steps and nutrition fields', async () => {
    await db('telegram_ramzi_profiles').insert({ telegram_user_id: TEST_TELEGRAM_ID, step: 'equipment' })
      .onConflict('telegram_user_id').merge({ step: 'equipment' });
    await down(db);

    const oldColumns = await db('information_schema.columns')
      .select('column_name')
      .where({ table_name: 'telegram_ramzi_profiles' });
    expect(oldColumns.map((column) => column.column_name)).not.toContain('daily_kcal');
    expect(oldColumns.map((column) => column.column_name)).not.toContain('last_mode');
    await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).update({ step: 'allergies' });

    await up(db);
    const columns = await db('information_schema.columns')
      .select('column_name', 'is_nullable')
      .where({ table_name: 'telegram_ramzi_profiles' });
    expect(columns.map((column) => column.column_name)).toEqual(expect.arrayContaining([
      'kcal_opt_in', 'sex', 'age', 'height_cm', 'weight_kg', 'activity_level',
      'goal', 'daily_kcal', 'macros_json', 'last_mode', 'pantry_text',
    ]));
    for (const name of ['kcal_opt_in', 'sex', 'age', 'height_cm', 'weight_kg', 'activity_level', 'goal', 'daily_kcal', 'macros_json', 'last_mode', 'pantry_text']) {
      expect(columns.find((column) => column.column_name === name).is_nullable).toBe('YES');
    }

    await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).update({
      step: 'goal', kcal_opt_in: true, sex: 'male', age: 30, height_cm: 180,
      weight_kg: 80, activity_level: 'moderate', last_mode: 'pantry', pantry_text: 'курица, рис',
    });
    expect(await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).first()).toMatchObject({
      step: 'goal', age: 30, height_cm: 180, activity_level: 'moderate',
      last_mode: 'pantry', pantry_text: 'курица, рис',
    });

    await down(db);
    expect(await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).first()).toMatchObject({ step: 'complete' });
    await up(db);
    await db('telegram_ramzi_profiles').where({ telegram_user_id: TEST_TELEGRAM_ID }).delete();
  });
});
