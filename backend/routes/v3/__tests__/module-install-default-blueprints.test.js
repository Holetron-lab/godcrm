import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { getDefaultModuleBlueprints } from '../../../services/module-blueprint/defaultBlueprints.js';
import { fireRowCreateTriggers, fireRowUpdateTriggers } from '../../../services/AutomationTriggerService.js';
import router from '../module-install.js';

const blueprints = getDefaultModuleBlueprints();
const tableBlueprints = blueprints.filter((blueprint) => blueprint.tables.length + blueprint.requires.tables.length > 0);
let ws;
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => { req.user = { id: ws?.userId }; next(); });
app.use('/modules', router);

function install(blueprint, { dryRun = false, bindings = null } = {}) {
  return request(app).post('/modules/install').send({
    space_id: ws.spaceId,
    project_id: ws.projectId,
    blueprint,
    dry_run: dryRun,
    bindings,
  });
}

async function createConnectedBindings(blueprint) {
  const declarations = [...blueprint.tables, ...blueprint.requires.tables];
  const ids = {};
  for (const table of declarations) {
    const result = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [
      ws.projectId,
      `connected_${blueprint.key}_${table.key}`,
    ]);
    ids[table.key] = result.lastInsertRowid;
  }

  const bindings = { tables: {} };
  for (const table of declarations) {
    const columns = table.columns.map((column, index) => ({
      module_column: column.column_name,
      target: index === 0 ? '__new' : `live_${column.column_name}`,
    }));
    bindings.tables[table.key] = { action: 'connect', table_id: ids[table.key], seed: true, columns };

    for (const [index, column] of table.columns.entries()) {
      if (index === 0) continue;
      const config = column.type === 'relation' ? {
        relation: { enabled: true, tableId: ids[column.target], labelColumn: 'name' },
      } : column.config;
      await dbRun(
        `INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [ids[table.key], `live_${column.column_name}`, column.display_name, column.type, config ? JSON.stringify(config) : null, index],
      );
    }
  }
  return bindings;
}

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'default-blueprints', table: false });
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

describe('ADR-207 W2.4 default blueprint installation', () => {
  it.each(blueprints)('$key passes dry-run, apply and repeated dry-run', async (blueprint) => {
    const bindings = blueprint.requires.tables.length ? await createConnectedBindings(blueprint) : null;
    const dry = await install(blueprint, { dryRun: true, bindings });
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.conflicts).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);

    const applied = await install(blueprint, { bindings });
    expect(applied.status).toBe(200);
    expect(applied.body.data.status).toBe('installed');

    const repeated = await install(blueprint, { dryRun: true });
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.plan.conflicts).toEqual([]);
    expect(repeated.body.data.plan.changes).toBe(0);
    expect(await dbAll('SELECT id FROM module_installs WHERE space_id = ?', [ws.spaceId])).toHaveLength(1);

    if (blueprint.key === 'kanban_pack') {
      expect(await dbAll('SELECT id FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId])).toHaveLength(8);
      expect(await dbAll('SELECT id FROM table_rows WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id=t.project_id WHERE p.space_id = ?)', [ws.spaceId])).toHaveLength(16);
      const eventTable = await dbGet(
        'SELECT id FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ?) AND table_type = ?',
        [ws.spaceId, 'ticket_events'],
      );
      expect(eventTable).toBeTruthy();
      const board = await dbGet(
        "SELECT config FROM widgets WHERE owner_kind = 'space' AND owner_id = ? AND preset_name = 'kanban_board'",
        [ws.spaceId],
      );
      const config = typeof board.config === 'string' ? JSON.parse(board.config) : board.config;
      expect(config.kanban.eventsTableId).toBe(eventTable.id);
      const duration = await dbGet(
        "SELECT type, config FROM table_columns WHERE column_name = 'duration' AND table_id IN (SELECT id FROM universal_tables WHERE name = 'tickets' AND project_id IN (SELECT id FROM projects WHERE space_id = ?))",
        [ws.spaceId],
      );
      expect(duration.type).toBe('number');
      const durationConfig = typeof duration.config === 'string' ? JSON.parse(duration.config) : duration.config;
      expect(durationConfig).toMatchObject({ min: 1, suffix: ' min' });
    }
    if (blueprint.key === 'preset_kanban_board') {
      expect(await dbAll('SELECT id FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId])).toHaveLength(2);
      const eventTable = await dbGet(
        'SELECT id FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ?) AND table_type = ?',
        [ws.spaceId, 'ticket_events'],
      );
      const board = await dbGet(
        "SELECT config FROM widgets WHERE owner_kind = 'space' AND owner_id = ? AND preset_name = 'kanban_board'",
        [ws.spaceId],
      );
      const config = typeof board.config === 'string' ? JSON.parse(board.config) : board.config;
      expect(config.kanban.eventsTableId).toBe(eventTable.id);
      expect(config.kanban.statusColumn).toBe('state');
      expect(config.kanban.titleColumn).toBe('what');

      const ticketColumns = await dbAll('SELECT column_name, type FROM table_columns WHERE table_id = ?', [config.kanban.tableId]);
      expect(Object.fromEntries(ticketColumns.map((column) => [column.column_name, column.type]))).toMatchObject({
        what: 'text', state: 'select', repeat: 'time', duration: 'number', scheduled_date: 'datetime', due_date: 'datetime',
      });
      const ticket = {
        what: 'English', state: 'Backlog', repeat: '0 18 * * 1,3,5', duration: 60,
        scheduled_date: '2026-11-01', due_date: '2026-12-25',
      };
      const inserted = await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [
        config.kanban.tableId, 'generic-kanban-series', JSON.stringify(ticket),
      ]);
      await fireRowCreateTriggers(config.kanban.tableId, inserted.lastInsertRowid, ticket);
      const occurrences = await dbAll('SELECT id, data FROM table_rows WHERE table_id = ?', [eventTable.id]);
      expect(occurrences).toHaveLength(24);
      const first = occurrences.map((row) => ({ id: row.id, ...(typeof row.data === 'string' ? JSON.parse(row.data) : row.data) }))
        .sort((left, right) => left.original_start.localeCompare(right.original_start))[0];
      expect(first).toMatchObject({ title: 'English', state: 'Backlog', status: 'confirmed' });

      const { id: firstEventId, ...firstEventData } = first;
      await dbRun('UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify({ ...firstEventData, state: 'Done' }), firstEventId]);
      const rescheduled = { ...ticket, duration: 90 };
      await dbRun('UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify(rescheduled), inserted.lastInsertRowid]);
      await fireRowUpdateTriggers(config.kanban.tableId, inserted.lastInsertRowid, rescheduled, ticket);
      const reconciled = (await dbAll('SELECT data FROM table_rows WHERE table_id = ?', [eventTable.id]))
        .map((row) => typeof row.data === 'string' ? JSON.parse(row.data) : row.data);
      expect(reconciled).toHaveLength(24);
      for (const occurrence of reconciled) {
        const minutes = (new Date(occurrence.end_datetime) - new Date(occurrence.start_datetime)) / 60_000;
        expect(minutes).toBe(occurrence.original_start === first.original_start ? 60 : 90);
      }
      expect(reconciled.find((occurrence) => occurrence.original_start === first.original_start).state).toBe('Done');
    }
    if (blueprint.key === 'ai_agents_pack') {
      expect(await dbAll('SELECT id FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId])).toHaveLength(10);
      expect(await dbAll('SELECT id FROM table_rows WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id=t.project_id WHERE p.space_id = ?)', [ws.spaceId])).toEqual([]);
    }
  });

  it.each(tableBlueprints)('$key accepts connect rename and __new in a real dry-run', async (blueprint) => {
    const bindings = await createConnectedBindings(blueprint);
    const dry = await install(blueprint, { dryRun: true, bindings });

    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.conflicts).toEqual([]);
    for (const table of dry.body.data.plan.tables) {
      expect(table.action).toBe('connect');
      if (table.columns.length) expect(table.columns[0].target).toBe('__new');
      expect(table.columns.slice(1).every((column) => column.target.startsWith('live_'))).toBe(true);
    }
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);
  });
});
