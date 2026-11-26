import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter, safeJsonParse } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import router from '../module-install.js';

let ws;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: ws?.userId }; next(); });
app.use('/modules', router);

const projects = () => [{ key: 'main', title: 'Main' }];
const blueprint = (key, extra = {}) => ({
  key, version: '2.0.0', schema: 2, projects: projects(), ...extra,
});

async function createTable(name, columns = [{ column_name: 'name', type: 'text' }]) {
  const result = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, name]);
  const tableId = result.lastInsertRowid;
  for (const [index, column] of columns.entries()) {
    await dbRun(
      'INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config) VALUES (?, ?, ?, ?, ?, 1, ?)',
      [tableId, column.column_name, column.column_name, column.type, index + 1, column.config ? JSON.stringify(column.config) : null],
    );
  }
  return tableId;
}

async function install(body, { dryRun = false, bindings = null } = {}) {
  return request(app).post('/modules/install').send({
    space_id: ws.spaceId,
    project_id: ws.projectId,
    blueprint: body,
    dry_run: dryRun,
    bindings,
  });
}

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'module-relation-seed', table: false });
});

afterEach(async () => {
  if (!ws) return;
  await dbRun('DELETE FROM module_installs WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM module_installations WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM modules WHERE space_id = ?', [ws.spaceId]);
  await dbRun("DELETE FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [ws.spaceId]);
  await dbRun(`DELETE FROM widgets WHERE dashboard_id IN (
    SELECT d.id FROM dashboards d LEFT JOIN projects p ON p.id = d.project_id
    WHERE d.space_id = ? OR p.space_id = ?
  )`, [ws.spaceId, ws.spaceId]);
  await dbRun('DELETE FROM dashboards WHERE space_id = ? OR project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId, ws.spaceId]);
  await dbRun('DELETE FROM table_rows WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE p.space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM table_columns WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE p.space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM projects WHERE space_id = ? AND id <> ?', [ws.spaceId, ws.projectId]);
  await ws.cleanup();
});

afterAll(destroyAdapter);

describe('ADR-207 W2.3 relations through requires', () => {
  it('adds a required-table relation with the resolved target table id', async () => {
    const ticketsId = await createTable('required_tickets');
    const linksId = await createTable('required_links');
    const body = blueprint('required-relation', {
      requires: { tables: [
        { key: 'tickets', columns: [{ column_name: 'name', type: 'text', required: true }] },
        { key: 'links', columns: [
          { column_name: 'name', type: 'text', required: true },
          { column_name: 'ticket', type: 'relation', target: 'tickets' },
        ] },
      ] },
    });
    const bindings = { tables: {
      tickets: { action: 'connect', table_id: ticketsId },
      links: { action: 'connect', table_id: linksId },
    } };

    const dry = await install(body, { dryRun: true, bindings });
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.conflicts).toEqual([]);

    const applied = await install(body, { bindings });
    expect(applied.status).toBe(200);
    const relation = await dbGet("SELECT config FROM table_columns WHERE table_id = ? AND column_name = 'ticket'", [linksId]);
    expect(safeJsonParse(relation.config).relation.tableId).toBe(ticketsId);
  });

  it('reports a requires target mismatch and reads legacy relation target fields', async () => {
    const ticketsId = await createTable('expected_tickets');
    const otherId = await createTable('other_tickets');
    const itemsId = await createTable('existing_relation_items', [
      { column_name: 'name', type: 'text' },
      { column_name: 'ticket', type: 'relation', config: { relation: { table_id: otherId, relatedTableId: otherId } } },
    ]);
    const body = blueprint('mismatched-required-relation', {
      requires: { tables: [{ key: 'tickets', columns: [{ column_name: 'name', type: 'text' }] }] },
      tables: [{ key: 'items', name: 'existing_relation_items', columns: [
        { column_name: 'name', type: 'text' },
        { column_name: 'ticket', type: 'relation', target: 'tickets' },
      ] }],
    });
    const bindings = { tables: {
      tickets: { action: 'connect', table_id: ticketsId },
      items: { action: 'connect', table_id: itemsId },
    } };

    const dry = await install(body, { dryRun: true, bindings });
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'relation_target', table: 'items', column: 'ticket',
        expected_table_id: ticketsId, actual_table_id: otherId, blocking: true,
      }),
    ]));
  });
});

describe('ADR-207 W2.3 relation seed', () => {
  it('resolves natural keys in any seed order and deduplicates a repeated install', async () => {
    const body = blueprint('ordered-relation-seed', {
      tables: [
        { key: 'authors', name: 'seed_authors', columns: [
          { column_name: 'slug', type: 'text' }, { column_name: 'name', type: 'text' },
        ] },
        { key: 'books', name: 'seed_books', columns: [
          { column_name: 'slug', type: 'text' },
          { column_name: 'author', type: 'relation', target: 'authors' },
        ] },
      ],
      seed: [
        { table: 'books', key: ['slug'], rows: [{ slug: 'book-1', author: 'author-1' }] },
        { table: 'authors', key: ['slug'], rows: [{ slug: 'author-1', name: 'Author One' }] },
      ],
    });

    const applied = await install(body);
    expect(applied.status).toBe(200);
    const author = await dbGet('SELECT id FROM table_rows WHERE table_id = ?', [applied.body.data.mapping.authors.table_id]);
    const book = await dbGet('SELECT id, data FROM table_rows WHERE table_id = ?', [applied.body.data.mapping.books.table_id]);
    expect(safeJsonParse(book.data)).toMatchObject({ slug: 'book-1', author: author.id });

    const repeated = await install(body);
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.status).toBe('unchanged');
    expect(await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [applied.body.data.mapping.authors.table_id])).toHaveLength(1);
    expect(await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [applied.body.data.mapping.books.table_id])).toHaveLength(1);
    expect(await dbGet('SELECT id, data FROM table_rows WHERE id = ?', [book.id])).toEqual(book);
  });

  it('uses the mapped natural key of a connected target table', async () => {
    const authorsId = await createTable('connected_authors', [{ column_name: 'code', type: 'text' }]);
    const body = blueprint('connected-relation-seed', {
      requires: { tables: [{ key: 'authors', columns: [{ column_name: 'slug', type: 'text', required: true }] }] },
      tables: [{ key: 'books', name: 'connected_seed_books', columns: [
        { column_name: 'slug', type: 'text' },
        { column_name: 'author', type: 'relation', target: 'authors' },
      ] }],
      seed: [
        { table: 'books', key: ['slug'], rows: [{ slug: 'book-1', author: 'author-1' }] },
        { table: 'authors', key: ['slug'], rows: [{ slug: 'author-1' }] },
      ],
    });
    const bindings = { tables: { authors: {
      action: 'connect', table_id: authorsId,
      columns: [{ module_column: 'slug', target: 'code' }],
    } } };

    const applied = await install(body, { bindings });
    expect(applied.status).toBe(200);
    const author = await dbGet('SELECT id, data FROM table_rows WHERE table_id = ?', [authorsId]);
    expect(safeJsonParse(author.data)).toMatchObject({ code: 'author-1' });
    const book = await dbGet('SELECT data FROM table_rows WHERE table_id = ?', [applied.body.data.mapping.books.table_id]);
    expect(safeJsonParse(book.data)).toMatchObject({ author: author.id });
  });

  it('drops an unconnected relation value from the planned seed with a warning', async () => {
    const body = blueprint('external-relation-seed', {
      requires: { tables: [{ key: 'external', columns: [{ column_name: 'slug', type: 'text' }] }] },
      tables: [{ key: 'items', name: 'external_seed_items', columns: [
        { column_name: 'slug', type: 'text' },
        { column_name: 'external', type: 'relation', target: 'external' },
      ] }],
      seed: [{ table: 'items', key: ['slug'], rows: [{ slug: 'item-1', external: 'external-1' }] }],
    });

    const dry = await install(body, { dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.seed[0]).toMatchObject({ relations_dropped: 1 });
    expect(dry.body.data.plan.seed[0].warning).toContain('external');
  });
});

describe('ADR-207 W2.3 agent service tools', () => {
  const services = [
    { key: 'mail', type_slug: 'remote_mcp', url: 'https://example.com/mcp', allowed_tools: ['send', 'read'] },
    { key: 'crm', type_slug: 'remote_mcp', url: 'https://example.org/mcp', allowed_tools: ['write'] },
  ];

  it('accepts the union of service allowed_tools and blocks extras by name', async () => {
    await createTable('AI Agents');
    const body = blueprint('service-tool-invariant', {
      services,
      agents: [{ key: 'helper', tools: ['send', 'write'], config: {} }],
    });

    const valid = await install(body, { dryRun: true });
    expect(valid.status).toBe(200);
    expect(valid.body.data.plan.conflicts).toEqual([]);

    body.agents[0].tools.push('delete');
    const invalid = await install(body, { dryRun: true });
    expect(invalid.status).toBe(200);
    expect(invalid.body.data.plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'AGENT_TOOLS_NOT_ALLOWED', agent: 'helper', tools: ['delete'], blocking: true }),
    ]));

    const applied = await install(body);
    expect(applied.status).toBe(409);
    expect(applied.body.error.code).toBe('INSTALL_BINDINGS_CONFLICT');
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);
  });
});
