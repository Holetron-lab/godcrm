import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex from 'knex';
import knexConfig from '../../../knexfile.js';
import { down, up } from '../110_telegram_ramzi_private_bot.js';

let db;
let isTestDb = false;

beforeAll(async () => {
  db = knex(knexConfig.getConfig('test'));
  const { rows: [actual] } = await db.raw('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  isTestDb = actual.db === 'godcrm_test' && [null, '127.0.0.1', '::1'].includes(actual.host);
  expect(isTestDb).toBe(true);
  await up(db);
});

afterAll(async () => {
  if (isTestDb) await up(db);
  await db.destroy();
});

describe('migration 110 — private Ramzi Telegram bot', () => {
  it('rolls down and back up with dedup, binding and conversation uniqueness', async () => {
    await down(db);
    expect(await db.schema.hasTable('telegram_ramzi_updates')).toBe(false);
    expect(await db.schema.hasTable('telegram_ramzi_bindings')).toBe(false);

    await up(db);
    expect(await db.schema.hasTable('telegram_ramzi_updates')).toBe(true);
    expect(await db.schema.hasTable('telegram_ramzi_bindings')).toBe(true);

    const bindingColumns = await db('information_schema.columns')
      .select('column_name')
      .where({ table_name: 'telegram_ramzi_bindings' });
    expect(bindingColumns.map((column) => column.column_name)).toEqual(expect.arrayContaining([
      'id', 'user_id', 'code_hash', 'expires_at', 'created_at',
    ]));

    const index = await db('pg_indexes')
      .select('indexname')
      .where({ indexname: 'conversations_telegram_ramzi_chat_unique' })
      .first();
    expect(index).toBeDefined();
  });
});
