// ADR-0012 §Phase 5 (M3 backend) — integration tests for
//   GET /api/v3/widgets/:widgetId/tickets/:ticketId/resolve
//
// Uses supertest against a mini express app that mounts the controller's
// `buildResolveRouter` factory with mocked DB / widget loaders. No real DB.

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildResolveRouter } from '../resolveTicketRefController.js';

const FIXED_NOW = () => new Date('2026-04-25T12:00:00.000Z');

function buildApp({ widgets = {}, ticketRows = {}, columns = {} } = {}) {
  const app = express();

  // mock dbGet — called with first row in `SELECT ... FROM table_rows`.
  const dbGetMock = async (_sql, params) => {
    const [rowId, tableId] = params;
    const key = `${tableId}:${rowId}`;
    return ticketRows[key] ?? null;
  };

  // mock dbAll — called with column lookup `SELECT id, column_name FROM
  // table_columns WHERE table_id = ?`. Returns the column array configured
  // via `columns[tableId]`.
  const dbAllMock = async (_sql, params) => {
    const [tableId] = params;
    return columns[tableId] ?? [];
  };

  const loadWidget = async (id) => widgets[id] ?? null;

  app.use(buildResolveRouter({
    dbGet: dbGetMock,
    dbAll: dbAllMock,
    loadWidget,
    now: FIXED_NOW,
  }));

  return app;
}

describe('GET /widgets/:widgetId/tickets/:ticketId/resolve', () => {
  it('happy path — returns ticket + snapshot', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'documents',
        config: { tickets_table_id: 1708 },
      },
    };
    const ticketRows = {
      '1708:131090': {
        id: 131090,
        base_id: 'b-131090',
        table_id: 1708,
        // jsonb data uses column-id keys; we'll map to names via dbAllMock
        data: { 'col-what': 'Hello atom', 'col-state': 24276, 'col-assigned': '16' },
        created_at: '2026-04-20T00:00:00.000Z',
        updated_at: '2026-04-25T09:00:00.000Z',
      },
    };
    const columns = {
      1708: [
        { id: 'col-what', column_name: 'what' },
        { id: 'col-state', column_name: 'state' },
        { id: 'col-assigned', column_name: 'assigned_to' },
      ],
    };
    const app = buildApp({ widgets, ticketRows, columns });

    const res = await request(app)
      .get('/widgets/218/tickets/131090/resolve')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.ticket.id).toBe(131090);
    expect(res.body.data.ticket.data.what).toBe('Hello atom');
    expect(res.body.data.ticket.data.state).toBe(24276);
    expect(res.body.data.ticket.data.assigned_to).toBe('16');

    expect(res.body.data.snapshot).toEqual({
      title: 'Hello atom',
      status: 24276,
      assigned_to: '16',
      updated_at: '2026-04-25T09:00:00.000Z',
      snapshotted_at: '2026-04-25T12:00:00.000Z',
    });
  });

  it('happy path with column data already named (no map)', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        config: { tickets_table_id: 1708 },
      },
    };
    const ticketRows = {
      '1708:42': {
        id: 42,
        base_id: 'b-42',
        table_id: 1708,
        data: { what: 'Direct names', state: 24275 },
        created_at: '2026-04-25T08:00:00.000Z',
        updated_at: '2026-04-25T08:00:00.000Z',
      },
    };
    const app = buildApp({ widgets, ticketRows, columns: { 1708: [] } });

    const res = await request(app)
      .get('/widgets/218/tickets/42/resolve')
      .expect(200);

    expect(res.body.data.ticket.data.what).toBe('Direct names');
    expect(res.body.data.snapshot.title).toBe('Direct names');
    expect(res.body.data.snapshot.status).toBe(24275);
  });

  it('non-tickets-linked widget → 400 WIDGET_NOT_TICKETS_LINKED', async () => {
    const widgets = {
      500: {
        id: 500,
        preset_name: 'kanban', // not a tickets-linked preset
        config: { board_id: 1 },
      },
    };
    const app = buildApp({ widgets });

    const res = await request(app)
      .get('/widgets/500/tickets/1/resolve')
      .expect(400);

    expect(res.body.error).toBe('WIDGET_NOT_TICKETS_LINKED');
    expect(res.body.code).toBe('WIDGET_NOT_TICKETS_LINKED');
  });

  it('widget not found → 404', async () => {
    const app = buildApp({ widgets: {} });

    const res = await request(app)
      .get('/widgets/9999/tickets/1/resolve')
      .expect(404);

    // Uses default response.notFound shape: { success:false, error:{code,message} }
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toMatch(/Widget/);
  });

  it('ticket not found in resolved tickets table → 404', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'documents',
        config: { tickets_table_id: 1708 },
      },
    };
    const app = buildApp({ widgets, ticketRows: {} });

    const res = await request(app)
      .get('/widgets/218/tickets/77777/resolve')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toMatch(/Ticket/);
  });

  it('non-numeric widgetId → 400', async () => {
    const app = buildApp({});
    const res = await request(app)
      .get('/widgets/abc/tickets/1/resolve')
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('non-numeric ticketId → 400', async () => {
    const app = buildApp({});
    const res = await request(app)
      .get('/widgets/1/tickets/abc/resolve')
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('documents widget without explicit tickets_table_id falls back to 1708', async () => {
    const widgets = {
      400: {
        id: 400,
        preset_name: 'documents',
        config: { registry_table_id: 9999 }, // legacy doc widget, no tickets binding
      },
    };
    const ticketRows = {
      '1708:131090': {
        id: 131090,
        base_id: 'b',
        table_id: 1708,
        data: { what: 'Default-table fallback', state: 24275 },
        created_at: '2026-04-25T08:00:00.000Z',
        updated_at: '2026-04-25T08:00:00.000Z',
      },
    };
    const app = buildApp({ widgets, ticketRows, columns: { 1708: [] } });

    const res = await request(app)
      .get('/widgets/400/tickets/131090/resolve')
      .expect(200);
    expect(res.body.data.snapshot.title).toBe('Default-table fallback');
  });
});
