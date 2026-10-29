// @vitest-environment node
import '../../test/setup.js';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import { randomUUID } from 'node:crypto';
const mock = vi.hoisted(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn(), transaction: vi.fn() }));
vi.mock('../../database/connection.js', () => ({ dbGet: mock.get, dbAll: mock.all, dbRun: mock.run,
  withTransactionAsync: mock.transaction, toBool: (v) => v ? 1 : 0 }));
vi.mock('../../services/audit/writeAudit.js', () => ({ writeAudit: vi.fn() }));
import { createWidget } from '../../services/WidgetService.js';
import { createMailMessagesSystemTable, ensureMailSystemTableForSpace } from '../../services/SystemTablesCreator.js';
import { up as backfill } from '../../database/migrations/knex/103_mail_module_project_tables.js';

let db, tx, handle;
beforeAll(async () => {
  db = knexFactory({ client: 'pg', connection: { host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT), database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD }, pool: { min: 0, max: 1 } });
  expect((await db.raw('SELECT current_database() AS name')).rows[0].name).toBe('godcrm_test');
  tx = await db.transaction();
  const schema = `mail_project_${randomUUID().replaceAll('-', '')}`;
  await tx.raw('CREATE SCHEMA ??', [schema]);
  await tx.raw('SET LOCAL search_path TO ??', [schema]);
  await tx.raw(`CREATE TABLE spaces (id INTEGER PRIMARY KEY);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, space_id INTEGER REFERENCES spaces(id), name TEXT, type TEXT);
    CREATE TABLE dashboards (id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id));
    CREATE TABLE universal_tables (id SERIAL PRIMARY KEY, project_id INTEGER REFERENCES projects(id),
      name TEXT, description TEXT, icon TEXT, is_system INTEGER, sync_target TEXT);
    CREATE TABLE table_columns (id SERIAL PRIMARY KEY, table_id INTEGER REFERENCES universal_tables(id),
      column_name TEXT, display_name TEXT, type TEXT, config TEXT, order_index INTEGER, is_required INTEGER, is_system INTEGER);
    CREATE TABLE space_connectors (id INTEGER PRIMARY KEY, space_id INTEGER, type_slug TEXT);
    CREATE TABLE widgets (id SERIAL PRIMARY KEY, dashboard_id INTEGER REFERENCES dashboards(id),
      owner_kind TEXT, owner_id INTEGER, source_widget_id INTEGER, widget_type TEXT, preset_name TEXT,
      code TEXT, title TEXT, description TEXT, icon TEXT, config TEXT, position TEXT,
      is_visible INTEGER, order_index INTEGER, created_by INTEGER, is_module INTEGER);
    CREATE TABLE modules (id SERIAL PRIMARY KEY, widget_id INTEGER, sidebar_order INTEGER,
      sidebar_icon TEXT, access_level TEXT, is_pinned BOOLEAN);
    INSERT INTO spaces VALUES (11), (12);
    INSERT INTO projects VALUES (1,11,'System Data','system_data'), (2,11,'Communication','business'),
      (3,11,'Sales','business'), (4,12,'Other space','business');
    INSERT INTO dashboards VALUES (2,2), (3,3), (4,4);
    INSERT INTO space_connectors VALUES (1,11,'imap');`);
  mock.get.mockImplementation(async (sql, params = []) => (await tx.raw(sql, params)).rows[0] || null);
  mock.all.mockImplementation(async (sql, params = []) => (await tx.raw(sql, params)).rows);
  mock.run.mockImplementation(async (sql, params = []) => {
    const q = /^\s*INSERT/i.test(sql) && !/RETURNING/i.test(sql) ? `${sql} RETURNING id` : sql;
    const result = await tx.raw(q, params);
    return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
  });
  handle = { get: mock.get, all: mock.all, run: mock.run };
  mock.transaction.mockImplementation((fn) => fn(handle));
});
afterAll(async () => { if (tx) await tx.rollback(); if (db) await db.destroy(); });
beforeEach(async () => { await tx.raw('SAVEPOINT mail_case'); });
afterEach(async () => { await tx.raw('ROLLBACK TO SAVEPOINT mail_case'); });

it('registers Mail in the widget project before a connector exists, once per project', async () => {
  const data = { dashboard_id: 4, widget_type: 'preset', preset_name: 'mail', title: 'Mail' };
  await createWidget(data);
  await createWidget(data);
  const tables = await tx('universal_tables').where({ project_id: 4, sync_target: 'mail_messages' });
  expect(tables).toHaveLength(1);
  expect(await tx('table_columns').where({ table_id: tables[0].id })).toHaveLength(12);
});

it('keeps the existing table id and columns when adopting System Data mail into the module project', async () => {
  const legacy = await createMailMessagesSystemTable(1);
  await createWidget({ dashboard_id: 2, widget_type: 'preset', preset_name: 'mail', title: 'Mail' });
  expect(await tx('universal_tables').where({ id: legacy }).first()).toMatchObject({ project_id: 2 });
  expect(await tx('table_columns').where({ table_id: legacy })).toHaveLength(12);
  expect(await ensureMailSystemTableForSpace(11)).toBe(legacy);
  expect(await tx('universal_tables').where({ project_id: 1, sync_target: 'mail_messages' })).toHaveLength(0);
});

it('creates a second projection without moving the first module table or crossing spaces', async () => {
  await createWidget({ dashboard_id: 2, widget_type: 'preset', preset_name: 'mail', title: 'Mail' });
  await createWidget({ dashboard_id: 4, widget_type: 'preset', preset_name: 'mail', title: 'Mail' });
  const before = await tx('universal_tables').where({ project_id: 2 }).first();
  await createWidget({ dashboard_id: 3, widget_type: 'preset', preset_name: 'mail', title: 'Mail' });
  expect(await tx('universal_tables').where({ id: before.id }).first()).toMatchObject({ project_id: 2 });
  expect(await tx('universal_tables').where({ sync_target: 'mail_messages' })).toHaveLength(3);
});

it('does not register mail for other widget presets', async () => {
  const before = await tx('universal_tables').select('id');
  await createWidget({ dashboard_id: 2, widget_type: 'preset', preset_name: 'table_view', title: 'Table' });
  expect(await tx('universal_tables').select('id')).toEqual(before);
});

it('backfills existing placements idempotently, preserves references, and creates missing columns', async () => {
  const legacy = await createMailMessagesSystemTable(1);
  await tx('widgets').insert([2, 3, 4].map(dashboard_id => ({ dashboard_id, preset_name: 'mail' })));
  await backfill(tx);
  await backfill(tx);
  expect(await tx('universal_tables').where({ id: legacy }).first()).toMatchObject({ project_id: 2 });
  const tables = await tx('universal_tables').orderBy('project_id');
  expect(tables.map(t => t.project_id)).toEqual([2, 3, 4]);
  for (const table of tables) expect(await tx('table_columns').where({ table_id: table.id })).toHaveLength(12);
});
