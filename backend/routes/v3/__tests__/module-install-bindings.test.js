import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbGet, dbAll, dbRun, resetAdapter, destroyAdapter, safeJsonParse } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { createWidget } from '../../../services/WidgetService.js';
import router from '../module-install.js';

const blueprint = {
  key: 'rest-bindings',
  version: '1.0.0',
  title: 'REST bindings',
  tables: [{
    key: 'items',
    name: 'rest_binding_items',
    columns: [{ column_name: 'name', type: 'text' }, { column_name: 'notes', type: 'text' }],
  }],
  seed: [{ table: 'items', key: ['name'], rows: [{ name: 'one', notes: 'seeded' }] }],
};

const withSurface = {
  ...blueprint,
  widgets: [{
    key: 'board',
    preset_name: 'table_view',
    config: { table_id: { $table: 'items' } },
  }],
};

let ws;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: ws?.userId }; next(); });
app.use('/modules', router);

const post = (body) => request(app).post('/modules/install').send(body);
const baseBody = () => ({ space_id: ws.spaceId, project_id: ws.projectId, blueprint });

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'module-bindings-rest', table: false });
});

afterEach(async () => {
  if (!ws) return;
  await dbRun('DELETE FROM module_installs WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM module_installations WHERE space_id = ?', [ws.spaceId]);
  await dbRun(`DELETE FROM widgets WHERE dashboard_id IN (
    SELECT d.id FROM dashboards d LEFT JOIN projects p ON p.id = d.project_id
    WHERE d.space_id = ? OR p.space_id = ?
  )`, [ws.spaceId, ws.spaceId]);
  await dbRun('DELETE FROM dashboards WHERE space_id = ? OR project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId, ws.spaceId]);
  await dbRun('DELETE FROM table_rows WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE p.space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM table_columns WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE p.space_id = ?)', [ws.spaceId]);
  await dbRun('DELETE FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ? AND id <> ?)', [ws.spaceId, ws.projectId]);
  await dbRun('DELETE FROM projects WHERE space_id = ? AND id <> ?', [ws.spaceId, ws.projectId]);
  await ws.cleanup();
});

afterAll(destroyAdapter);

describe('ADR-207 W1.1 REST bindings', () => {
  it('repeats create dry-run without writes, then applies to the resolved new project', async () => {
    const body = {
      ...baseBody(),
      dry_run: true,
      bindings: {
        projects: { main: { action: 'create' } },
        tables: { items: { action: 'create' } },
      },
    };
    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.plan).toEqual(second.body.data.plan);
    expect(first.body.data.plan.projects).toEqual([{ key: 'main', action: 'create', project_id: null }]);
    expect(await dbAll('SELECT id FROM projects WHERE space_id = ?', [ws.spaceId])).toHaveLength(1);
    expect(await dbAll('SELECT t.id FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE p.space_id = ?', [ws.spaceId])).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);

    const applied = await post({ ...body, dry_run: false });
    expect(applied.status).toBe(200);
    const projectId = applied.body.data.installation.project_id;
    expect(projectId).not.toBe(ws.projectId);
    expect(await dbGet('SELECT id, space_id FROM projects WHERE id = ?', [projectId])).toMatchObject({ id: projectId, space_id: ws.spaceId });
    expect(await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [applied.body.data.mapping.items.table_id])).toMatchObject({ project_id: projectId });
  });

  it('keeps the legacy schema 1 response and apply path when bindings are absent', async () => {
    const dry = await post({ ...baseBody(), dry_run: true });
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan).not.toHaveProperty('projects');
    expect(dry.body.data.plan.tables[0]).toMatchObject({ action: 'create', table_id: null });

    const applied = await post(baseBody());
    expect(applied.status).toBe(200);
    expect(applied.body.data.status).toBe('installed');
    expect(applied.body.data.installation.project_id).toBe(ws.projectId);
    expect(applied.body.data.plan).not.toHaveProperty('projects');
  });

  it('passes bindings and existingWidgets through install and binds the adopted widget to the connected table', async () => {
    const table = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'existing_items']);
    const tableId = table.lastInsertRowid;
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'name', 'Name', 'text', 1, 1)", [tableId]);
    const widget = await createWidget({
      dashboard_id: ws.dashboardId,
      widget_type: 'preset',
      preset_name: 'table_view',
      title: 'Existing board',
      config: {},
      created_by: ws.userId,
    });
    const body = {
      ...baseBody(),
      blueprint: withSurface,
      bindings: { tables: { items: { action: 'connect', table_id: tableId } } },
      existingWidgets: { board: widget.id },
    };

    const dry = await post({ ...body, dry_run: true });
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.tables[0]).toMatchObject({ action: 'connect', table_id: tableId });
    expect(dry.body.data.plan.widgets[0]).toMatchObject({ action: 'adopt', widget_id: widget.id });

    const applied = await post(body);
    expect(applied.status).toBe(200);
    expect(applied.body.data.mapping.items.table_id).toBe(tableId);
    const saved = await dbGet('SELECT config FROM widgets WHERE id = ?', [widget.id]);
    expect(safeJsonParse(saved.config).table_id).toBe(tableId);
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [ws.projectId])).toHaveLength(1);
  });

  it('returns a structured conflict for invalid ids without a partial install', async () => {
    const response = await post({
      ...baseBody(),
      bindings: { tables: { items: { action: 'connect', table_id: 2147483647 } } },
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSTALL_BINDINGS_CONFLICT');
    expect(response.body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'TABLE_NOT_FOUND', table: 'items', blocking: true }),
    ]));
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [ws.projectId])).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);
  });

  it('rejects skip of a required seed/widget dependency without creating a surface', async () => {
    const response = await post({
      ...baseBody(),
      blueprint: withSurface,
      bindings: { tables: { items: { action: 'skip' } } },
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSTALL_BINDINGS_CONFLICT');
    expect(response.body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'TABLE_SKIP_DEPENDENCY', table: 'items' }),
    ]));
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [ws.projectId])).toEqual([]);
    expect(await dbAll('SELECT id FROM widgets WHERE dashboard_id = ?', [ws.dashboardId])).toEqual([]);
  });
});

describe('ADR-207 W1.3 REST relation targets', () => {
  const relationBlueprint = {
    key: 'rest-relation-targets',
    version: '1.0.0',
    tables: [
      { key: 'companies', name: 'rest_relation_companies', columns: [{ column_name: 'name', type: 'text' }] },
      { key: 'departments', name: 'rest_relation_departments', columns: [
        { column_name: 'name', type: 'text' },
        { column_name: 'company_id', type: 'relation', target: 'companies', config: {
          relation: { tableId: 999, table_id: 999, labelColumn: 'name' }, relatedTableId: 999,
        } },
      ] },
    ],
  };

  it('keeps create dry-run read-only and persists the resolved relation id on apply', async () => {
    const body = { space_id: ws.spaceId, project_id: ws.projectId, blueprint: relationBlueprint, dry_run: true };
    const first = await post(body);
    const second = await post(body);

    expect(first.status).toBe(200);
    expect(second.body.data.plan).toEqual(first.body.data.plan);
    expect(first.body.data.plan.conflicts).toEqual([]);
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ?', [ws.projectId])).toEqual([]);

    const applied = await post({ ...body, dry_run: false });
    expect(applied.status).toBe(200);
    const companiesId = applied.body.data.mapping.companies.table_id;
    const company = await dbGet("SELECT config FROM table_columns WHERE table_id = ? AND column_name = 'company_id'", [applied.body.data.mapping.departments.table_id]);
    expect(safeJsonParse(company.config)).toEqual({
      relation: { tableId: companiesId, table_id: companiesId, labelColumn: 'name' }, relatedTableId: companiesId,
    });
  });

  it('returns relation_target with both ids and leaves existing rows unchanged', async () => {
    const target = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'rest_target_companies']);
    const other = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'rest_other_companies']);
    const tickets = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'rest_relation_tickets']);
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config) VALUES (?, 'company', 'Company', 'relation', 1, 1, ?)", [tickets.lastInsertRowid, JSON.stringify({ relation: { tableId: other.lastInsertRowid } })]);
    await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [tickets.lastInsertRowid, 'KEEPREL1', JSON.stringify({ company: 12345 })]);
    const blueprint = {
      key: 'rest-relation-conflict', version: '1.0.0',
      tables: [
        relationBlueprint.tables[0],
        { key: 'tickets', name: 'rest_module_tickets', columns: [
          { column_name: 'company_id', type: 'relation', target: 'companies', config: { relation: { tableId: 999 } } },
        ] },
      ],
    };
    const response = await post({
      space_id: ws.spaceId, project_id: ws.projectId, blueprint,
      bindings: { tables: {
        companies: { action: 'connect', table_id: target.lastInsertRowid },
        tickets: { action: 'connect', table_id: tickets.lastInsertRowid, columns: [{ module_column: 'company_id', target: 'company' }] },
      } },
    });

    expect(response.status).toBe(409);
    expect(response.body.error.details).toEqual([
      expect.objectContaining({
        kind: 'relation_target', expected_table_id: target.lastInsertRowid,
        actual_table_id: other.lastInsertRowid, blocking: true,
      }),
    ]);
    expect(safeJsonParse((await dbGet('SELECT data FROM table_rows WHERE table_id = ?', [tickets.lastInsertRowid])).data)).toEqual({ company: 12345 });
    expect(await dbAll('SELECT id FROM table_columns WHERE table_id = ?', [tickets.lastInsertRowid])).toHaveLength(1);
  });
});

describe('ADR-207 W1.2 REST column mapping', () => {
  const mappedBlueprint = {
    key: 'rest-column-mapping',
    version: '1.0.0',
    tables: [{
      key: 'items',
      name: 'module_items',
      columns: [
        { column_name: 'name', display_name: 'Name', type: 'text', required: true },
        { column_name: 'status', type: 'text' },
        { column_name: 'amount', type: 'number' },
      ],
    }],
    seed: [{ table: 'items', key: ['name'], rows: [
      { name: 'One', status: 'Open', amount: '1,5' },
      { name: 'Two', status: 'New', amount: '2,5' },
    ] }],
  };

  it('repeats a connected dry-run without writes, then applies mapping, options and deduped seed', async () => {
    const table = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'existing_mapped_items']);
    const tableId = table.lastInsertRowid;
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'title', 'Name', 'text', 1, 1)", [tableId]);
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config) VALUES (?, 'state', 'State', 'select', 2, 1, ?)", [tableId, JSON.stringify({ options: ['Open'] })]);
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'total', 'Total', 'number', 3, 1)", [tableId]);
    await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [tableId, 'EXISTING1', JSON.stringify({ title: 'One', state: 'Open', total: 1.5 })]);
    const body = {
      space_id: ws.spaceId,
      project_id: ws.projectId,
      blueprint: mappedBlueprint,
      dry_run: true,
      bindings: { tables: { items: {
        action: 'connect', table_id: tableId,
        columns: [{ module_column: 'status', target: 'state' }, { module_column: 'amount', target: 'total' }],
      } } },
    };

    const first = await post(body);
    const second = await post(body);
    expect(first.status).toBe(200);
    expect(second.body.data.plan).toEqual(first.body.data.plan);
    expect(first.body.data.plan.tables[0].columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ module_column: 'name', target: 'title', match: 'display_name' }),
      expect.objectContaining({ module_column: 'status', target: 'state', options_added: 1 }),
    ]));
    expect(first.body.data.plan.seed[0]).toMatchObject({ insert: 1, existing: 1 });
    expect(await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [tableId])).toHaveLength(1);
    expect(await dbAll('SELECT id FROM table_columns WHERE table_id = ?', [tableId])).toHaveLength(3);

    const applied = await post({ ...body, dry_run: false });
    expect(applied.status).toBe(200);
    expect(applied.body.data.seeded.items).toEqual({ seeded: 1, reused: 1 });
    const rows = await dbAll('SELECT data FROM table_rows WHERE table_id = ? ORDER BY id', [tableId]);
    expect(rows).toHaveLength(2);
    expect(safeJsonParse(rows[1].data)).toEqual({ title: 'Two', state: 'New', total: 2.5 });
    const state = await dbGet("SELECT config, type FROM table_columns WHERE table_id = ? AND column_name = 'state'", [tableId]);
    expect(state.type).toBe('select');
    expect(safeJsonParse(state.config).options).toEqual(['Open', 'New']);
  });

  it('returns a blocking column conflict on apply without changing schema or rows', async () => {
    const table = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'conflicting_items']);
    const tableId = table.lastInsertRowid;
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'title', 'Name', 'text', 1, 1)", [tableId]);
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'state', 'State', 'select', 2, 1)", [tableId]);
    const response = await post({
      space_id: ws.spaceId,
      project_id: ws.projectId,
      blueprint: mappedBlueprint,
      bindings: { tables: { items: {
        action: 'connect', table_id: tableId,
        columns: [
          { module_column: 'name', target: null },
          { module_column: 'status', target: null },
          { module_column: 'amount', target: 'state' },
        ],
      } } },
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSTALL_BINDINGS_CONFLICT');
    expect(response.body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'REQUIRED_COLUMN_UNMAPPED', column: 'name', blocking: true }),
      expect.objectContaining({ kind: 'column_type', column: 'amount', blocking: true }),
    ]));
    expect(await dbAll('SELECT id FROM table_columns WHERE table_id = ?', [tableId])).toHaveLength(2);
    expect(await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [tableId])).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);
  });
});

describe('ADR-207 W1.5 REST install journal', () => {
  it('reuses saved mappings on upgrade and preserves data and __new columns on uninstall', async () => {
    const table = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'rest_journaled_items']);
    const tableId = table.lastInsertRowid;
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'title', 'Name', 'text', 1, 1)", [tableId]);
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'state', 'State', 'text', 2, 1)", [tableId]);
    const v1 = {
      key: 'rest-upgrade-journal', version: '1.0.0',
      tables: [{ key: 'items', name: 'rest_module_journaled_items', columns: [
        { column_name: 'name', display_name: 'Name', type: 'text', required: true },
        { column_name: 'status', type: 'text' },
        { column_name: 'notes', type: 'text' },
      ] }],
      seed: [{ table: 'items', key: ['name'], rows: [{ name: 'One', status: 'Open', notes: 'first' }] }],
    };
    const installBody = {
      space_id: ws.spaceId, project_id: ws.projectId, blueprint: v1,
      bindings: { tables: { items: {
        action: 'connect', table_id: tableId,
        columns: [{ module_column: 'status', target: 'state' }, { module_column: 'notes', target: '__new' }],
      } } },
    };

    const dryInstall = await post({ ...installBody, dry_run: true });
    expect(dryInstall.status).toBe(200);
    expect(await dbAll('SELECT id FROM module_installs WHERE space_id = ?', [ws.spaceId])).toEqual([]);
    const installed = await post(installBody);
    expect(installed.status).toBe(200);
    const initial = await dbGet('SELECT version, access_level, bindings FROM module_installs WHERE module_key = ? AND space_id = ?', [v1.key, ws.spaceId]);
    expect(initial).toMatchObject({ version: '1.0.0', access_level: 'member' });
    expect(safeJsonParse(initial.bindings).tables.items.columns).toEqual([
      { module_column: 'name', target: 'title' },
      { module_column: 'status', target: 'state' },
      { module_column: 'notes', target: 'notes' },
    ]);

    await dbRun("UPDATE table_columns SET display_name = 'Renamed live title' WHERE table_id = ? AND column_name = 'title'", [tableId]);
    await dbRun("INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'level', 'Priority', 'text', 4, 1)", [tableId]);
    const v2 = structuredClone(v1);
    v2.version = '1.1.0';
    v2.tables[0].columns.push({ column_name: 'priority', display_name: 'Priority', type: 'text' });
    v2.seed[0].rows.push({ name: 'Two', status: 'New', notes: 'second', priority: 'High' });

    const dryUpgrade = await request(app).post(`/modules/${v1.key}/upgrade`).send({ space_id: ws.spaceId, blueprint: v2, dry_run: true });
    expect(dryUpgrade.status).toBe(200);
    expect(dryUpgrade.body.data.plan.tables[0].columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ module_column: 'name', target: 'title', match: 'manual' }),
      expect.objectContaining({ module_column: 'priority', target: 'level', match: 'display_name' }),
    ]));
    expect((await dbGet('SELECT version FROM module_installs WHERE module_key = ? AND space_id = ?', [v1.key, ws.spaceId])).version).toBe('1.0.0');

    const upgraded = await request(app).post(`/modules/${v1.key}/upgrade`).send({ space_id: ws.spaceId, blueprint: v2 });
    expect(upgraded.status).toBe(200);
    expect(upgraded.body.data.plan.seed[0]).toMatchObject({ insert: 1, existing: 1 });
    const rows = await dbAll('SELECT data FROM table_rows WHERE table_id = ? ORDER BY id', [tableId]);
    expect(safeJsonParse(rows.at(-1).data)).toEqual({ title: 'Two', state: 'New', notes: 'second', level: 'High' });
    const current = await dbGet('SELECT version, bindings FROM module_installs WHERE module_key = ? AND space_id = ?', [v1.key, ws.spaceId]);
    expect(current.version).toBe('1.1.0');
    expect(safeJsonParse(current.bindings).tables.items.columns).toContainEqual({ module_column: 'priority', target: 'level' });

    const removed = await request(app).post(`/modules/${v1.key}/uninstall`).send({ space_id: ws.spaceId });
    expect(removed.status).toBe(200);
    expect(await dbAll('SELECT id FROM universal_tables WHERE id = ?', [tableId])).toHaveLength(1);
    expect(await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [tableId])).toHaveLength(2);
    expect(await dbAll("SELECT id FROM table_columns WHERE table_id = ? AND column_name = 'notes'", [tableId])).toHaveLength(1);
    expect(await dbAll('SELECT id FROM module_installs WHERE module_key = ? AND space_id = ?', [v1.key, ws.spaceId])).toEqual([]);
  });
});
