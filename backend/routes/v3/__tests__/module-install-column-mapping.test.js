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

const requiredItems = () => ({
  tables: [{
    key: 'items',
    columns: [
      { column_name: 'status', type: 'select', required: true },
      { column_name: 'amount', type: 'number' },
      { column_name: 'title', type: 'text' },
      { column_name: 'notes', type: 'text' },
    ],
  }],
});

const mappingBlueprint = () => ({
  key: 'column-consumers', version: '2.0.0', schema: 2,
  projects: [{ key: 'main', title: 'Main' }],
  requires: requiredItems(),
  apps: [
    { key: 'metric', preset: 'number_widget', table: 'items', config: { column: 'amount', filter: { column: 'status' }, sort_by: 'title' } },
    { key: 'board', preset: 'kanban_board', table: 'items', config: { group_by_column: 'status', card_title_column: 'title', sort_by: 'amount' } },
    { key: 'graph', preset: 'chart_widget', table: 'items', config: { x_column: 'status', y_column: 'amount', group_by: 'status' } },
  ],
  dashboards: [{
    key: 'default', target: 'default',
    tiles: [
      { key: 'metric_tile', preset: 'number_widget', table: 'items', config: { filter: { column: 'status' } } },
      { key: 'board_link', preset: 'quick_links', app: 'board', config: { table_id: { $table: 'items' }, app_widget_id: { $app: 'board' } } },
    ],
  }],
  agents: [{ key: 'helper', table: 'items', columnRefPaths: ['filter.column'], config: { filter: { column: 'status' } } }],
  automations: [{ key: 'on_status', table: 'items', columnRefPaths: ['filter.column'], config: { filter: { column: 'status' } } }],
});

async function createItems() {
  const result = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, 'column_mapping_items']);
  const tableId = result.lastInsertRowid;
  for (const [name, type, order] of [['state', 'select', 1], ['total', 'number', 2], ['notes', 'text', 3]]) {
    await dbRun(
      'INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible) VALUES (?, ?, ?, ?, ?, 1)',
      [tableId, name, name, type, order],
    );
  }
  return tableId;
}

async function createAgentRegistry() {
  await dbRun(
    "INSERT INTO universal_tables (project_id, name, display_name, table_type) VALUES (?, 'AI Agents', 'AI Agents', 'ai_agents')",
    [ws.projectId],
  );
}

const bindings = (tableId, columns = [
  { module_column: 'status', target: 'state' },
  { module_column: 'amount', target: 'total' },
  { module_column: 'title', target: '__new' },
  { module_column: 'notes', target: null },
]) => ({ tables: { items: { action: 'connect', table_id: tableId, columns } } });

async function install(blueprint, { dryRun = false, tableId, bindings: explicitBindings } = {}) {
  return request(app).post('/modules/install').send({
    space_id: ws.spaceId,
    project_id: ws.projectId,
    blueprint,
    dry_run: dryRun,
    bindings: explicitBindings ?? bindings(tableId),
  });
}

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'module-column-mapping', table: false });
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

describe('ADR-207 W2.2 config column mapping', () => {
  it('repeats dry-run and applies mapped configs while preserving the source blueprint and app/table refs', async () => {
    const tableId = await createItems();
    await createAgentRegistry();
    const blueprint = mappingBlueprint();
    const frozen = structuredClone(blueprint);

    const first = await install(blueprint, { dryRun: true, tableId });
    const second = await install(blueprint, { dryRun: true, tableId });

    expect(first.status).toBe(200);
    expect(first.body.data.plan).toEqual(second.body.data.plan);
    expect(first.body.data.plan.conflicts).toEqual([]);
    expect(first.body.data.plan.agents[0]).toMatchObject({ action: 'create', config: { filter: { column: 'state' } } });
    expect(first.body.data.plan.automations[0]).toMatchObject({ action: 'create', config: { filter: { column: 'state' } } });
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);

    const applied = await install(blueprint, { tableId });
    expect(applied.status).toBe(200);
    expect(blueprint).toEqual(frozen);

    const widgets = await dbAll("SELECT * FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [ws.spaceId]);
    const byKey = new Map(widgets.map((widget) => [safeJsonParse(widget.config).__module.widget_key, widget]));
    expect(safeJsonParse(byKey.get('metric').config)).toMatchObject({ table_id: tableId, column: 'total', filter: { column: 'state' }, sort_by: 'title' });
    expect(safeJsonParse(byKey.get('board').config)).toMatchObject({ table_id: tableId, group_by_column: 'state', card_title_column: 'title', sort_by: 'total' });
    expect(safeJsonParse(byKey.get('graph').config)).toMatchObject({ table_id: tableId, x_column: 'state', y_column: 'total', group_by: 'state' });

    const tile = await dbGet('SELECT config FROM widgets WHERE id = ?', [applied.body.data.widgets.find((widget) => widget.key === 'metric_tile').widget_id]);
    expect(safeJsonParse(tile.config).filter.column).toBe('state');
    const link = await dbGet('SELECT config FROM widgets WHERE id = ?', [applied.body.data.widgets.find((widget) => widget.key === 'board_link').widget_id]);
    expect(safeJsonParse(link.config)).toMatchObject({ table_id: tableId, app_widget_id: byKey.get('board').id });
    expect(await dbGet("SELECT column_name FROM table_columns WHERE table_id = ? AND column_name = 'title'", [tableId])).toBeTruthy();

    const installation = await dbGet('SELECT blueprint FROM module_installations WHERE module_key = ? AND space_id = ?', [blueprint.key, ws.spaceId]);
    expect(safeJsonParse(installation.blueprint)).toMatchObject(frozen);
  });

  it('blocks skipped column consumers and undeclared connected presets with exact references', async () => {
    const tableId = await createItems();
    const blueprint = mappingBlueprint();
    blueprint.apps[0].config.filter.column = 'notes';
    blueprint.apps.push({ key: 'calendar', preset: 'calendar_widget', table: 'items', config: {} });

    const dry = await install(blueprint, { dryRun: true, tableId });
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'COLUMN_REF_UNMAPPED', referenced_by: ['apps.metric.config.filter.column'] }),
      expect.objectContaining({ kind: 'PRESET_COLUMN_MAPPING_UNSUPPORTED', referenced_by: ['apps.calendar'] }),
    ]));

    const applied = await install(blueprint, { tableId });
    expect(applied.status).toBe(409);
    expect(applied.body.error.code).toBe('INSTALL_BINDINGS_CONFLICT');
    expect(await dbAll("SELECT id FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [ws.spaceId])).toEqual([]);
  });

  it('remaps a bound schema 1 table_view without changing its table reference', async () => {
    const tableId = await createItems();
    const blueprint = {
      key: 'legacy-column-consumer', version: '1.0.0',
      tables: [{ key: 'items', name: 'legacy_column_items', columns: requiredItems().tables[0].columns }],
      widgets: [{
        key: 'legacy', preset_name: 'table_view',
        config: { table_id: { $table: 'items' }, sort_by: 'amount', filters: [{ column: 'status' }], visible_columns: ['title', 'amount'] },
      }],
    };

    const applied = await install(blueprint, { tableId });

    expect(applied.status).toBe(200);
    const widget = await dbGet('SELECT config FROM widgets WHERE id = ?', [applied.body.data.widgets.find((item) => item.key === 'legacy').widget_id]);
    expect(safeJsonParse(widget.config)).toMatchObject({
      table_id: tableId, sort_by: 'total', filters: [{ column: 'state' }], visible_columns: ['title', 'total'],
    });
  });
});
