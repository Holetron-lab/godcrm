import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knex from 'knex';
import knexConfig from '../../../knexfile.js';
import { up, down } from '../108_adr_0207_w15_module_installs.js';

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

describe('ADR-207 W1.5 migration 108 — module_installs', () => {
  it('rolls down and back up with the complete journal contract', async () => {
    await down(db);
    expect(await db.schema.hasTable('module_installs')).toBe(false);

    await up(db);
    expect(await db.schema.hasTable('module_installs')).toBe(true);
    const columns = await db('information_schema.columns')
      .select('column_name')
      .where({ table_name: 'module_installs' });
    expect(columns.map((column) => column.column_name)).toEqual(expect.arrayContaining([
      'id', 'module_key', 'version', 'space_id', 'installed_by',
      'access_level', 'bindings', 'installed_at',
    ]));
  });
});
