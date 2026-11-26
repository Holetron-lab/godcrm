// @vitest-environment node
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter, safeJsonParse } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { provisionModuleTables } from '../../ModuleTableProvisioner.js';
import { fireRowCreateTriggers, fireRowUpdateTriggers } from '../../AutomationTriggerService.js';
import { setupTicketOccurrences } from '../../../scripts/setup-ticket-occurrences.js';
import { reconcileTicketOccurrences } from '../reconcile.js';
import mutateRouter from '../../../routes/v3/tables/tableRowMutateController.js';
import batchRouter from '../../../routes/v3/tables/tableRowBatchController.js';
import createRouter from '../../../routes/v3/tables/tableRowCreateController.js';

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: ws?.userId }; next(); });
app.use('/api/v3', mutateRouter);
app.use('/api/v3', batchRouter);
app.use('/api/v3', createRouter);

let ws;
let ticketsTableId;
let eventsTableId;
let statesTableId;
let initialStateId;
let secondStateId;

function data(row) {
  return safeJsonParse(row?.data, {}) || {};
}

async function insertState(name, order) {
  const result = await dbRun(
    'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
    [statesTableId, `state-${order}`, JSON.stringify({ name, order, is_final: false })],
  );
  return result.lastInsertRowid;
}

async function insertWidget(presetName) {
  const config = {
    table_id: ticketsTableId,
    kanban: { tableId: ticketsTableId },
    calendar: { tableId: ticketsTableId },
  };
  await dbRun(
    `INSERT INTO widgets (dashboard_id, owner_kind, owner_id, widget_type, preset_name, title, config, position)
     VALUES (?, 'project', ?, 'preset', ?, ?, ?, '{}')`,
    [ws.dashboardId, ws.projectId, presetName, presetName, JSON.stringify(config)],
  );
}

async function createTicket(overrides = {}) {
  const ticket = {
    what: 'English',
    state: initialStateId,
    repeat: '0 18 * * 1,3,5',
    duration: 60,
    scheduled_date: '2026-11-01',
    due_date: '2026-12-25',
    ...overrides,
  };
  const result = await dbRun(
    'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
    [ticketsTableId, `ticket-${Date.now()}-${Math.random()}`, JSON.stringify(ticket)],
  );
  await fireRowCreateTriggers(ticketsTableId, result.lastInsertRowid, ticket);
  return result.lastInsertRowid;
}

async function updateTicket(ticketId, patch) {
  const row = await dbGet('SELECT data FROM table_rows WHERE id = ? AND table_id = ?', [ticketId, ticketsTableId]);
  const oldData = data(row);
  const newData = { ...oldData, ...patch };
  await dbRun('UPDATE table_rows SET data = ? WHERE id = ? AND table_id = ?', [JSON.stringify(newData), ticketId, ticketsTableId]);
  await fireRowUpdateTriggers(ticketsTableId, ticketId, newData, oldData);
}

async function occurrenceRows(ticketId = null) {
  const rows = await dbAll('SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY id', [eventsTableId]);
  return rows
    .filter((row) => ticketId === null || Number(data(row).ticket_id) === Number(ticketId))
    .sort((left, right) => String(data(left).original_start).localeCompare(String(data(right).original_start)));
}

async function insertOneOffEvent(ticketId) {
  const result = await dbRun(
    'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
    [eventsTableId, `one-off-${Date.now()}`, JSON.stringify({
      ticket_id: ticketId,
      title: 'One-off',
      start_datetime: '2026-11-10T10:00:00.000Z',
      end_datetime: '2026-11-10T11:00:00.000Z',
      status: 'confirmed',
    })],
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
  ws = await createEphemeralWorkspace({ label: 'ticket-occurrences', table: false });
  const stateMapping = await provisionModuleTables(ws.projectId, {
    key: 'occurrence_test_states',
    tables: [{
      key: 'ticket_states',
      name: 'ticket_states',
      columns: [
        { column_name: 'name', type: 'text' },
        { column_name: 'order', type: 'number' },
        { column_name: 'is_final', type: 'checkbox' },
      ],
    }],
  });
  statesTableId = stateMapping.ticket_states.table_id;
  initialStateId = await insertState('backlog', 1);
  secondStateId = await insertState('review', 2);

  const ticketMapping = await provisionModuleTables(ws.projectId, {
    key: 'occurrence_test_tickets',
    tables: [{
      key: 'tickets',
      name: 'tickets',
      columns: [
        { column_name: 'what', type: 'text' },
        { column_name: 'state', type: 'relation', config: { relation: { tableId: statesTableId, labelColumn: 'name' } } },
        { column_name: 'scheduled_date', type: 'date' },
        { column_name: 'due_date', type: 'datetime' },
      ],
    }],
  });
  ticketsTableId = ticketMapping.tickets.table_id;
  await insertWidget('kanban_board');
  await insertWidget('calendar_widget');
  ({ eventsTableId } = await setupTicketOccurrences(ticketsTableId));
});

afterEach(async () => {
  await ws.cleanup();
});

afterAll(destroyAdapter);

describe('ADR-209 WP-1 schema setup', () => {
  it('is idempotent, adds duration, binds widgets and accepts an unmanaged event', async () => {
    const again = await setupTicketOccurrences(ticketsTableId);
    expect(again.eventsTableId).toBe(eventsTableId);
    expect(await dbAll('SELECT id FROM universal_tables WHERE project_id = ? AND table_type = ?', [ws.projectId, 'ticket_events'])).toHaveLength(1);

    const ticketColumns = await dbAll('SELECT column_name, type, config FROM table_columns WHERE table_id = ?', [ticketsTableId]);
    expect(Object.fromEntries(ticketColumns.map((column) => [column.column_name, column.type]))).toMatchObject({
      repeat: 'time', duration: 'number', scheduled_date: 'datetime', due_date: 'datetime',
    });
    const duration = ticketColumns.find((column) => column.column_name === 'duration');
    expect(safeJsonParse(duration.config, duration.config)).toMatchObject({ min: 1, suffix: ' min' });

    const widgets = await dbAll('SELECT preset_name, config FROM widgets WHERE dashboard_id = ?', [ws.dashboardId]);
    for (const widget of widgets) {
      const config = safeJsonParse(widget.config, {});
      const section = widget.preset_name === 'kanban_board' ? 'kanban' : 'calendar';
      expect(config[section].eventsTableId).toBe(eventsTableId);
    }

    const ticketId = await createTicket({ repeat: null, duration: null });
    const response = await request(app).post(`/api/v3/tables/${eventsTableId}/rows`).send({
      data: {
        ticket_id: ticketId,
        title: 'Unmanaged via API',
        start_datetime: '2026-11-10T10:00:00.000Z',
        end_datetime: '2026-11-10T11:00:00.000Z',
      },
    }).expect(201);
    expect(response.body.data.data.state).toBeUndefined();
    expect(response.body.data.data.original_start).toBeUndefined();
  });
});

describe('ADR-209 WP-1 reconcile', () => {
  it.each([60, null])('materializes exactly 24 occurrences of 60 minutes with duration=%s', async (duration) => {
    const ticketId = await createTicket({ duration });
    const rows = await occurrenceRows(ticketId);
    expect(rows).toHaveLength(24);
    expect(data(rows[0])).toMatchObject({
      ticket_id: ticketId,
      state: initialStateId,
      original_start: '2026-11-02T15:00:00.000Z',
      start_datetime: '2026-11-02T15:00:00.000Z',
      end_datetime: '2026-11-02T16:00:00.000Z',
      timezone: 'Europe/Moscow',
      status: 'confirmed',
      title: 'English',
    });
    expect(data(rows.at(-1)).original_start).toBe('2026-12-25T15:00:00.000Z');
  });

  it.each([0, -30, 'abc'])('uses the 60-minute series default for invalid duration=%s', async (duration) => {
    const ticketId = await createTicket({ duration });
    const rows = await occurrenceRows(ticketId);
    expect(rows).toHaveLength(24);
    expect(new Date(data(rows[0]).end_datetime) - new Date(data(rows[0]).start_datetime)).toBe(60 * 60_000);
  });

  it('does not insert, update or delete on an unchanged save', async () => {
    const ticketId = await createTicket();
    const before = await occurrenceRows(ticketId);
    const result = await reconcileTicketOccurrences(ticketsTableId, ticketId);
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    const after = await occurrenceRows(ticketId);
    expect(after).toEqual(before);
  });

  it('updates pristine durations, preserves a touched end and uses the new duration for added slots', async () => {
    const ticketId = await createTicket();
    const [touched] = await occurrenceRows(ticketId);
    const touchedData = { ...data(touched), state: secondStateId };
    await dbRun('UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify(touchedData), touched.id]);

    await updateTicket(ticketId, { duration: 90 });
    let rows = await occurrenceRows(ticketId);
    for (const row of rows) {
      const current = data(row);
      const expected = row.id === touched.id ? 60 : 90;
      expect(new Date(current.end_datetime) - new Date(current.start_datetime)).toBe(expected * 60_000);
    }

    await updateTicket(ticketId, { due_date: '2027-01-01' });
    rows = await occurrenceRows(ticketId);
    expect(rows).toHaveLength(27);
    const added = rows.filter((row) => data(row).original_start > '2026-12-25T15:00:00.000Z');
    expect(added).toHaveLength(3);
    for (const row of added) {
      expect(new Date(data(row).end_datetime) - new Date(data(row).start_datetime)).toBe(90 * 60_000);
    }
  });

  it('moves pristine rows to 19:00 with 90 minutes and retains a touched row on its old slot', async () => {
    const ticketId = await createTicket({ duration: 90 });
    const [touched] = await occurrenceRows(ticketId);
    await dbRun('UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify({ ...data(touched), state: secondStateId }), touched.id]);

    await updateTicket(ticketId, { repeat: '0 19 * * 1,3,5' });
    const rows = await occurrenceRows(ticketId);
    expect(rows).toHaveLength(25);
    const retained = rows.find((row) => row.id === touched.id);
    expect(data(retained).start_datetime).toBe('2026-11-02T15:00:00.000Z');
    expect(data(retained).end_datetime).toBe('2026-11-02T16:30:00.000Z');
    const moved = rows.filter((row) => row.id !== touched.id);
    expect(moved).toHaveLength(24);
    for (const row of moved) {
      expect(data(row).start_datetime.endsWith('T16:00:00.000Z')).toBe(true);
      expect(new Date(data(row).end_datetime) - new Date(data(row).start_datetime)).toBe(90 * 60_000);
    }
  });

  it('caps a larger window at 500 rows', async () => {
    const ticketId = await createTicket({
      repeat: '* * * * *', scheduled_date: '2026-11-01T00:00:00.000Z', due_date: '2026-11-03T00:00:00.000Z',
    });
    expect(await occurrenceRows(ticketId)).toHaveLength(500);
  }, 15_000);

  it('creates, updates and removes one automatic event for a single ticket', async () => {
    const ticketId = await createTicket({
      repeat: null,
      scheduled_date: '2026-11-12T15:00:00',
      due_date: null,
      duration: 60,
    });
    let rows = await occurrenceRows(ticketId);
    expect(rows).toHaveLength(1);
    expect(data(rows[0])).toMatchObject({
      original_start: '2026-11-12T12:00:00.000Z',
      start_datetime: '2026-11-12T12:00:00.000Z',
      end_datetime: '2026-11-12T13:00:00.000Z',
    });
    expect(data(rows[0]).state).toBeNull();

    await updateTicket(ticketId, { duration: 30 });
    rows = await occurrenceRows(ticketId);
    expect(rows).toHaveLength(1);
    expect(data(rows[0]).end_datetime).toBe('2026-11-12T12:30:00.000Z');

    await updateTicket(ticketId, { duration: null });
    expect(await occurrenceRows(ticketId)).toEqual([]);
  });

  it.each([
    { scheduled_date: '2026-11-12', duration: 60 },
    { scheduled_date: '2026-11-12T15:00:00', duration: null },
    { scheduled_date: '2026-11-12T15:00:00', duration: 0 },
    { scheduled_date: '2026-11-12T15:00:00', duration: -30 },
    { scheduled_date: '2026-11-12T15:00:00', duration: 'abc' },
  ])('creates no automatic single event for %j', async (overrides) => {
    const ticketId = await createTicket({ repeat: null, due_date: null, ...overrides });
    expect(await occurrenceRows(ticketId)).toEqual([]);
  });

  it('deletes pristine occurrences when repeat and duration are cleared but preserves unmanaged rows', async () => {
    const ticketId = await createTicket();
    const unmanagedId = await insertOneOffEvent(ticketId);

    await updateTicket(ticketId, { repeat: null, duration: null });
    expect((await occurrenceRows(ticketId)).map((row) => row.id)).toEqual([unmanagedId]);

    await reconcileTicketOccurrences(ticketsTableId, ticketId);
    expect((await occurrenceRows(ticketId)).map((row) => row.id)).toEqual([unmanagedId]);
  });

  it('does not fire row_create automations for the 24 materialized events', async () => {
    await dbRun("UPDATE projects SET name = 'System Data' WHERE id = ?", [ws.projectId]);
    const automations = await dbRun(
      "INSERT INTO universal_tables (project_id, name) VALUES (?, 'automations_list')",
      [ws.projectId],
    );
    const logs = await dbRun(
      "INSERT INTO universal_tables (project_id, name) VALUES (?, 'automation_logs_list')",
      [ws.projectId],
    );
    await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [
      automations.lastInsertRowid,
      'event-create-automation',
      JSON.stringify({
        name: 'Must not run',
        table_id: eventsTableId,
        trigger_type: 'row_create',
        action_type: 'update_field',
        action_config: { column_id: 'title', value: 'AUTOMATED' },
        is_active: true,
      }),
    ]);

    const ticketId = await createTicket();
    const rows = await occurrenceRows(ticketId);
    expect(rows).toHaveLength(24);
    expect(rows.every((row) => data(row).title === 'English')).toBe(true);
    expect(await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [logs.lastInsertRowid])).toEqual([]);
  });

  it('does not duplicate original_start under concurrent reconciliation', async () => {
    const ticketId = await createTicket();
    await Promise.all([
      reconcileTicketOccurrences(ticketsTableId, ticketId),
      reconcileTicketOccurrences(ticketsTableId, ticketId),
    ]);
    const rows = await occurrenceRows(ticketId);
    expect(rows).toHaveLength(24);
    expect(new Set(rows.map((row) => data(row).original_start)).size).toBe(24);
  });

  it('deletes series and unmanaged events through single-row and batch delete routes', async () => {
    const singleTicketId = await createTicket();
    const batchTicketId = await createTicket({ what: 'Batch English' });
    await insertOneOffEvent(singleTicketId);
    await insertOneOffEvent(batchTicketId);

    await request(app).delete(`/api/v3/tables/${ticketsTableId}/rows/${singleTicketId}`).expect(200);
    expect(await occurrenceRows(singleTicketId)).toEqual([]);

    await request(app).post(`/api/v3/tables/${ticketsTableId}/rows/batch-delete`).send({ rowIds: [batchTicketId] }).expect(200);
    expect(await occurrenceRows(batchTicketId)).toEqual([]);
  });
});
