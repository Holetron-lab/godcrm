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
const table = (key = 'items') => ({
  key,
  name: `matrix_${key}`,
  columns: [{ column_name: 'name', type: 'text', required: true }],
});
const appAt = (key, tableKey = 'items') => ({ key, preset: 'table_view', table: tableKey, config: {} });
const tileAt = (key, tableKey = 'items') => ({
  key,
  preset: 'number_widget',
  table: tableKey,
  config: { table_id: { $table: tableKey }, aggregate: 'count' },
});
const requiresTickets = () => ({
  tables: [{ key: 'tickets', columns: [{ column_name: 'name', type: 'text', required: true }] }],
});

const compositions = [
  {
    id: 1,
    blueprint: (key) => ({
      key, version: '2.0.0', schema: 2, projects: projects(), tables: [table()],
      seed: [{ table: 'items', key: ['name'], rows: [{ name: 'one' }] }],
    }),
  },
  {
    id: 2,
    blueprint: (key) => ({
      key, version: '2.0.0', schema: 2, projects: projects(), tables: [table()], apps: [appAt('board')],
      sidebar: [{ widget: 'board' }],
    }),
  },
  {
    id: 3,
    requires: true,
    blueprint: (key) => ({
      key, version: '2.0.0', schema: 2, projects: projects(), requires: requiresTickets(), apps: [appAt('board', 'tickets')],
      seed: [{ table: 'tickets', key: ['name'], rows: [{ name: 'Seeded ticket' }] }],
    }),
  },
  {
    id: 4,
    blueprint: (key) => ({
      key, version: '2.0.0', schema: 2, projects: projects(), tables: [table()], apps: [appAt('board')],
      dashboards: [{ key: 'default', target: 'default', tiles: [tileAt('open_count')] }],
    }),
  },
  {
    id: 5,
    requires: true,
    blueprint: (key) => ({
      key, version: '2.0.0', schema: 2, projects: projects(), requires: requiresTickets(),
      dashboards: [{ key: 'default', target: 'default', tiles: [tileAt('open_count', 'tickets')] }],
    }),
  },
  {
    id: 6,
    blueprint: (key) => ({
      key, version: '2.0.0', schema: 2, projects: projects(), tables: [table('items'), table('archive')],
      apps: [appAt('board'), appAt('archive_app', 'archive')],
      dashboards: [{
        key: 'office',
        target: 'new',
        title: 'Virtual Office',
        tiles: [tileAt('open_count'), { key: 'board_link', preset: 'quick_links', app: 'board', config: {} }],
      }],
    }),
  },
  {
    id: 7,
    blueprint: (key) => ({
      key, version: '2.0.0', schema: 2,
      projects: [{ key: 'main', title: 'Main' }, { key: 'analytics', title: 'Analytics' }],
      tables: [table(), { ...table('metrics'), project: 'analytics', columns: [{ column_name: 'value', type: 'number' }] }],
    }),
  },
];

async function install(blueprint, { dryRun = false, bindings = null } = {}) {
  return request(app).post('/modules/install').send({
    space_id: ws.spaceId,
    project_id: ws.projectId,
    blueprint,
    dry_run: dryRun,
    bindings,
  });
}

async function createRequiredTickets() {
  const result = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'existing_tickets']);
  await dbRun(
    "INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, 'name', 'Name', 'text', 1, 1)",
    [result.lastInsertRowid],
  );
  return result.lastInsertRowid;
}

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'module-v2', table: false });
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

describe('ADR-207 W2.1 schema 2 composition matrix', () => {
  it.each(compositions)('composition $id passes dry-run, apply and repeated dry-run', async ({ id, blueprint: makeBlueprint, requires }) => {
    const blueprint = makeBlueprint(`matrix-${id}`);
    const bindings = requires
      ? { tables: { tickets: { action: 'connect', table_id: await createRequiredTickets() } } }
      : null;

    const dry = await install(blueprint, { dryRun: true, bindings });
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.changes).toBeGreaterThan(0);
    expect(dry.body.data.plan.conflicts).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);

    const applied = await install(blueprint, { bindings });
    expect(applied.status).toBe(200);
    expect(applied.body.data.status).toBe('installed');

    const repeated = await install(blueprint, { dryRun: true, bindings });
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.plan.conflicts).toEqual([]);
    expect(repeated.body.data.plan.changes).toBe(0);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toHaveLength(1);

    const widgets = await dbAll(
      "SELECT * FROM widgets WHERE owner_kind = 'space' AND owner_id = ? ORDER BY id",
      [ws.spaceId],
    );
    if (id === 2 || id === 6) {
      expect(widgets.length).toBeGreaterThan(0);
      expect(widgets.every((widget) => widget.dashboard_id === null)).toBe(true);
    }
    if (id === 3) {
      const board = await dbGet("SELECT config FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [ws.spaceId]);
      expect(safeJsonParse(board.config).table_id).toBe(bindings.tables.tickets.table_id);
      const seeded = await dbGet('SELECT data FROM table_rows WHERE table_id = ?', [bindings.tables.tickets.table_id]);
      expect(safeJsonParse(seeded.data)).toMatchObject({ name: 'Seeded ticket' });
    }
    if (id === 4 || id === 5) {
      const tile = await dbGet(`SELECT w.* FROM widgets w JOIN dashboards d ON d.id = w.dashboard_id
        WHERE d.space_id = ? AND w.preset_name = 'number_widget'`, [ws.spaceId]);
      expect(tile).toBeTruthy();
      expect(safeJsonParse(tile.config).table_id).toBe(id === 5 ? bindings.tables.tickets.table_id : applied.body.data.mapping.items.table_id);
    }
    if (id === 6) {
      const board = await dbGet("SELECT * FROM dashboards WHERE space_id = ? AND name = 'Virtual Office'", [ws.spaceId]);
      expect(board).toMatchObject({ is_default: 0 });
      const link = await dbGet("SELECT config FROM widgets WHERE dashboard_id = ? AND preset_name = 'quick_links'", [board.id]);
      const app = widgets.find((widget) => safeJsonParse(widget.config).__module?.widget_key === 'board');
      expect(safeJsonParse(link.config).app_widget_id).toBe(app.id);
    }
    if (id === 7) {
      const metrics = await dbGet('SELECT t.project_id, p.name AS project_name FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE t.name = ?', ['matrix_metrics']);
      expect(metrics.project_name).toBe('Analytics');
    }
  });

  it('reports an unbound requires table and blocks apply without partial writes', async () => {
    const blueprint = compositions.find((composition) => composition.id === 3).blueprint('missing-requires');
    const dry = await install(blueprint, { dryRun: true });

    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'REQUIRES_TABLE_UNBOUND', table: 'tickets', blocking: true }),
    ]));

    const applied = await install(blueprint);
    expect(applied.status).toBe(409);
    expect(applied.body.error.code).toBe('INSTALL_BINDINGS_CONFLICT');
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);
    expect(await dbAll("SELECT id FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [ws.spaceId])).toEqual([]);
  });

  it('adopts an app and skips a tile through schema 2 bindings', async () => {
    const existing = await dbRun(
      `INSERT INTO widgets (dashboard_id, owner_kind, owner_id, widget_type, preset_name, title, config, position, created_by)
       VALUES (NULL, 'space', ?, 'preset', 'table_view', 'Existing app', '{}', '{}', ?)`,
      [ws.spaceId, ws.userId],
    );
    const blueprint = compositions.find((composition) => composition.id === 4).blueprint('bound-surface');
    const bindings = {
      apps: { board: { action: 'adopt', widget_id: existing.lastInsertRowid } },
      tiles: { open_count: { action: 'skip' } },
    };

    const dry = await install(blueprint, { dryRun: true, bindings });
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.apps[0]).toMatchObject({ action: 'adopt', widget_id: existing.lastInsertRowid });
    expect(dry.body.data.plan.tiles[0]).toMatchObject({ action: 'skip', widget_id: null });

    const applied = await install(blueprint, { bindings });
    expect(applied.status).toBe(200);
    expect(applied.body.data.widgets.filter((widget) => widget.key === 'open_count')).toEqual([]);
    const adopted = await dbGet('SELECT * FROM widgets WHERE id = ?', [existing.lastInsertRowid]);
    expect(safeJsonParse(adopted.config).__module).toMatchObject({ key: 'bound-surface', widget_key: 'board' });
    expect(safeJsonParse(adopted.config).table_id).toBe(applied.body.data.mapping.items.table_id);
    expect(await dbAll(`SELECT w.id FROM widgets w JOIN dashboards d ON d.id = w.dashboard_id
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE (d.space_id = ? OR p.space_id = ?) AND w.preset_name = 'number_widget'`, [ws.spaceId, ws.spaceId])).toEqual([]);
  });

  it('reuses schema 2 project and table bindings during upgrade', async () => {
    const blueprint = compositions.find((composition) => composition.id === 7).blueprint('upgrade-v2');
    expect((await install(blueprint)).status).toBe(200);
    blueprint.version = '2.1.0';
    blueprint.tables[1].columns.push({ column_name: 'unit', type: 'text' });

    const upgraded = await request(app).post('/modules/upgrade-v2/upgrade').send({
      space_id: ws.spaceId,
      blueprint,
    });

    expect(upgraded.status).toBe(200);
    expect(upgraded.body.data.status).toBe('upgraded');
    expect(upgraded.body.data.plan.changes).toBe(1);
    const metrics = await dbGet('SELECT id FROM universal_tables WHERE name = ?', ['matrix_metrics']);
    expect(await dbGet("SELECT column_name FROM table_columns WHERE table_id = ? AND column_name = 'unit'", [metrics.id])).toBeTruthy();
    expect(await dbAll('SELECT id FROM projects WHERE space_id = ? AND id <> ?', [ws.spaceId, ws.projectId])).toHaveLength(1);
  });

  it('uninstalls standalone schema 2 apps and keeps tables across projects', async () => {
    const blueprint = {
      ...compositions.find((composition) => composition.id === 7).blueprint('uninstall-v2'),
      apps: [appAt('metrics_app', 'metrics')],
    };
    expect((await install(blueprint)).status).toBe(200);

    const removed = await request(app).post('/modules/uninstall-v2/uninstall').send({ space_id: ws.spaceId });

    expect(removed.status).toBe(200);
    expect(removed.body.data.tables_kept).toHaveLength(2);
    expect(await dbAll("SELECT id FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [ws.spaceId])).toEqual([]);
    expect(await dbAll('SELECT id FROM universal_tables WHERE name IN (?, ?)', ['matrix_items', 'matrix_metrics'])).toHaveLength(2);
    expect(await dbAll('SELECT id FROM module_installs WHERE space_id = ?', [ws.spaceId])).toEqual([]);
  });
});
