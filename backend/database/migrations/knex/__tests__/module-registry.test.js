import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knex from 'knex';
import knexConfig from '../../../knexfile.js';
import { getDefaultModuleBlueprints } from '../../../../services/module-blueprint/defaultBlueprints.js';
import { validateBlueprint, blueprintSha256 } from '../../../../services/ModuleInstaller.js';
import { up, down } from '../109_adr_0207_w41_module_registry.js';
import { up as refreshKanbanBlueprints } from '../118_adr_0209_kanban_blueprints.js';

let db;

beforeAll(async () => {
  db = knex(knexConfig.getConfig('test'));
  const { rows: [actual] } = await db.raw('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

afterAll(async () => {
  await up(db);
  await db.destroy();
});

describe('ADR-207 W4.1 migration 109 — module_registry', () => {
  it('rolls down and seeds every default blueprint exactly once across repeated runs', async () => {
    await down(db);
    await up(db);
    await up(db);

    expect(await db.schema.hasTable('module_registry')).toBe(true);
    const rows = await db('module_registry').where({ origin: 'default' }).orderBy('key');
    const blueprints = getDefaultModuleBlueprints();
    expect(blueprints).toHaveLength(28);
    expect(rows).toHaveLength(28);
    expect(rows.map((row) => row.key)).toEqual(blueprints.map((blueprint) => blueprint.key).sort());
    for (const row of rows) {
      expect(row.version).toBe('2.0.0');
      expect(row.status).toBe('published');
      expect(row.publisher_space_id).toBeNull();
      expect(row.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(row.blueprint.schema).toBe(2);
      expect(row.category).toBe('general');
    }

    const columns = await db('information_schema.columns')
      .select('column_name')
      .where({ table_name: 'module_registry' });
    expect(columns.map((column) => column.column_name)).toEqual(expect.arrayContaining([
      'id', 'key', 'origin', 'version', 'blueprint', 'publisher_space_id',
      'status', 'checksum', 'category', 'created_at', 'updated_at',
    ]));
  });

  it('refreshes both Kanban registry rows without touching other modules', async () => {
    const before = await db('module_registry').where({ origin: 'default' });
    for (const key of ['kanban_pack', 'preset_kanban_board']) {
      const row = before.find((candidate) => candidate.key === key);
      await db('module_registry').where({ id: row.id }).update({
        blueprint: { ...row.blueprint, title: 'Stale blueprint' },
        checksum: '0'.repeat(64),
      });
    }

    await refreshKanbanBlueprints(db);
    await refreshKanbanBlueprints(db);

    const after = await db('module_registry').where({ origin: 'default' });
    expect(after).toHaveLength(before.length);
    for (const raw of getDefaultModuleBlueprints().filter((blueprint) => ['kanban_pack', 'preset_kanban_board'].includes(blueprint.key))) {
      const blueprint = validateBlueprint(raw);
      const row = after.find((candidate) => candidate.key === blueprint.key);
      expect(row.blueprint).toEqual(blueprint);
      expect(row.checksum).toBe(blueprintSha256(blueprint));
      expect(row.status).toBe('published');
    }
    expect(after.find((row) => row.key === 'ai_agents_pack')).toEqual(before.find((row) => row.key === 'ai_agents_pack'));
  });
});
