import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex from 'knex';
import knexConfig from '../../../knexfile.js';
import { down, up } from '../111_telegram_ramzi_onboarding.js';
import { up as modesKcalUp } from '../112_telegram_ramzi_modes_kcal.js';
import { up as mediaUp } from '../113_telegram_ramzi_media.js';
import { up as guestsUp } from '../114_telegram_ramzi_guests.js';

let db;

beforeAll(async () => {
  db = knex(knexConfig.getConfig('test'));
  const { rows: [actual] } = await db.raw('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
  await up(db);
});

afterAll(async () => {
  await up(db);
  await modesKcalUp(db);
  await mediaUp(db);
  await guestsUp(db);
  await db.destroy();
});

describe('migration 111 — Ramzi onboarding profile', () => {
  it('rolls down and back up with persistent answers and onboarding state', async () => {
    await down(db);
    expect(await db.schema.hasTable('telegram_ramzi_profiles')).toBe(false);

    await up(db);
    expect(await db.schema.hasTable('telegram_ramzi_profiles')).toBe(true);
    const columns = await db('information_schema.columns')
      .select('column_name', 'is_nullable', 'column_default')
      .where({ table_name: 'telegram_ramzi_profiles' });
    expect(columns.map((column) => column.column_name)).toEqual(expect.arrayContaining([
      'user_id', 'step', 'equipment', 'disliked_foods', 'allergies', 'created_at', 'updated_at',
    ]));
    expect(columns.find((column) => column.column_name === 'step')).toMatchObject({
      is_nullable: 'NO', column_default: "'equipment'::text",
    });
    for (const name of ['equipment', 'disliked_foods', 'allergies']) {
      expect(columns.find((column) => column.column_name === name).is_nullable).toBe('YES');
    }

    const constraints = await db('pg_constraint')
      .select('conname')
      .whereRaw("conrelid = 'telegram_ramzi_profiles'::regclass AND contype = 'c'");
    expect(constraints.map((constraint) => constraint.conname)).toContain('telegram_ramzi_profiles_step_check');
  });
});
