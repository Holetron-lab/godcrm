// Integration tests for POST /api/v3/widgets/:widgetId/resolve-tickets.
//
// Mirrors the style of resolveTicketRefController.test.js: a mini express
// app mounts `buildResolveTicketsRouter` with mocked DB / widget loaders so
// the controller's filter-active dispatch + column-filter contract can be
// exercised without a real DB.

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildResolveTicketsRouter } from '../resolveTicketsController.js';

function buildApp({
  widgets = {},
  columnsByTable = {},      // { tableId: [{ id, column_name }] } — full column list
  rowsByTable = {},         // { tableId: [row, row, ...] } — used for `all`/`table_all`
  rowsByColumnValue = {},   // { `${tableId}:${columnName}:${value}`: [rows] } — column-filter
  tableMeta = {},           // { tableId: { id, space_id } } — universal_tables row
} = {}) {
  const dbGetMock = async (sql, params) => {
    if (/FROM table_columns WHERE table_id = \? AND column_name = \?/i.test(sql)) {
      const [tableId, columnName] = params;
      const cols = columnsByTable[tableId] || [];
      const found = cols.find(c => c.column_name === columnName);
      return found ? { id: found.id } : null;
    }
    if (/FROM universal_tables/i.test(sql)) {
      const [tableId] = params;
      return tableMeta[tableId] || null;
    }
    if (/COUNT\(\*\)/i.test(sql)) {
      const [tableId] = params;
      const rows = rowsByTable[tableId] || [];
      return { c: rows.length };
    }
    return null;
  };

  const dbAllMock = async (sql, params) => {
    if (/SELECT id, column_name FROM table_columns WHERE table_id = \?/i.test(sql)) {
      const [tableId] = params;
      return columnsByTable[tableId] || [];
    }
    if (/FROM table_rows[\s\S]*data::jsonb ->> \?/i.test(sql)) {
      const [tableId, columnName, value] = params;
      const key = `${tableId}:${columnName}:${value}`;
      return rowsByColumnValue[key] || [];
    }
    if (/AND id = ANY\(\?::int\[\]\)/i.test(sql)) {
      // Multi-id branch: preserves order of `ids` via array_position().
      const [tableId, ids /* array param for ANY */, orderIds] = params;
      const order = Array.isArray(orderIds) ? orderIds : ids;
      const rows = rowsByTable[tableId] || [];
      const byId = new Map(rows.map(r => [Number(r.id), r]));
      return order
        .map(n => byId.get(Number(n)))
        .filter(Boolean);
    }
    if (/FROM table_rows[\s\S]*WHERE table_id = \?[\s\S]*AND id = \?/i.test(sql)) {
      const [tableId, rowId] = params;
      const rows = rowsByTable[tableId] || [];
      return rows.filter(r => Number(r.id) === Number(rowId));
    }
    if (/FROM table_rows[\s\S]*ORDER BY id DESC[\s\S]*LIMIT/i.test(sql)) {
      const [tableId, limit, offset] = params;
      const rows = rowsByTable[tableId] || [];
      return rows.slice(offset, offset + limit);
    }
    return [];
  };

  const loadWidget = async (id) => widgets[id] ?? null;

  const app = express();
  app.use(express.json());
  app.use(buildResolveTicketsRouter({
    dbGet: dbGetMock,
    dbAll: dbAllMock,
    loadWidget,
  }));
  return app;
}

describe('POST /widgets/:widgetId/resolve-tickets', () => {
  it('column filter with literal value returns matching tickets only', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'adr_ref', value: '129897' },
        },
      },
    };
    const columnsByTable = {
      1708: [
        { id: 'col-adr', column_name: 'adr_ref' },
        { id: 'col-what', column_name: 'what' },
      ],
    };
    const rowsByColumnValue = {
      '1708:adr_ref:129897': [
        {
          id: 1,
          base_id: 'b1',
          table_id: 1708,
          data: { adr_ref: '129897', what: 'Match A' },
          created_at: '2026-04-25T00:00:00.000Z',
          updated_at: '2026-04-25T00:00:00.000Z',
        },
        {
          id: 2,
          base_id: 'b2',
          table_id: 1708,
          data: { adr_ref: '129897', what: 'Match B' },
          created_at: '2026-04-25T01:00:00.000Z',
          updated_at: '2026-04-25T01:00:00.000Z',
        },
      ],
    };
    const app = buildApp({ widgets, columnsByTable, rowsByColumnValue });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.tickets.map(t => t.data.what)).toEqual(['Match A', 'Match B']);
    expect(res.body.data.applied_filter.column).toBe('adr_ref');
    expect(res.body.data.applied_filter.value).toBe('129897');
  });

  it('column filter with use_owner_id resolves value from widget.owner_id (document owner)', async () => {
    const widgets = {
      300: {
        id: 300,
        preset_name: 'tickets_list',
        owner_kind: 'document',
        owner_id: 555,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'parent_doc', use_owner_id: true },
        },
      },
    };
    const columnsByTable = {
      1708: [{ id: 'col-pd', column_name: 'parent_doc' }],
    };
    const rowsByColumnValue = {
      '1708:parent_doc:555': [
        {
          id: 9,
          base_id: 'b9',
          table_id: 1708,
          data: { parent_doc: '555' },
          created_at: '2026-04-25T00:00:00.000Z',
          updated_at: '2026-04-25T00:00:00.000Z',
        },
      ],
    };
    const app = buildApp({ widgets, columnsByTable, rowsByColumnValue });

    const res = await request(app).post('/widgets/300/resolve-tickets').send({}).expect(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.applied_filter.value).toBe('555');
  });

  it('unknown column returns 400 unknown_filter_column', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'nope', value: 'x' },
        },
      },
    };
    const columnsByTable = {
      1708: [{ id: 'col-adr', column_name: 'adr_ref' }],
    };
    const app = buildApp({ widgets, columnsByTable });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(400);
    expect(res.body.error).toBe('unknown_filter_column');
    expect(res.body.column).toBe('nope');
  });

  it('use_owner_id without document owner returns 400', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'adr_ref', use_owner_id: true },
        },
      },
    };
    const columnsByTable = { 1708: [{ id: 'col-adr', column_name: 'adr_ref' }] };
    const app = buildApp({ widgets, columnsByTable });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(400);
    expect(res.body.error).toBe('use_owner_id_requires_document_owner');
  });

  it('filter with empty string value (no use_owner_id) returns all rows from table', async () => {
    // Reproduces widget 3064 in prod: stale `filter:{column:'state', value:''}`
    // must not collapse the list — empty value means "filter inactive".
    const widgets = {
      3064: {
        id: 3064,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        space_id: 4,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'state', value: '' },
        },
      },
    };
    const columnsByTable = { 1708: [{ id: 'col-what', column_name: 'what' }] };
    const tableMeta = { 1708: { id: 1708, space_id: 4 } };
    const rowsByTable = {
      1708: [
        {
          id: 11,
          base_id: 'b11',
          table_id: 1708,
          data: { 'col-what': 'A' },
          created_at: '2026-04-25T00:00:00.000Z',
          updated_at: '2026-04-25T00:00:00.000Z',
        },
        {
          id: 12,
          base_id: 'b12',
          table_id: 1708,
          data: { 'col-what': 'B' },
          created_at: '2026-04-25T01:00:00.000Z',
          updated_at: '2026-04-25T01:00:00.000Z',
        },
      ],
    };
    const app = buildApp({ widgets, columnsByTable, tableMeta, rowsByTable });

    const res = await request(app).post('/widgets/3064/resolve-tickets').send({}).expect(200);
    expect(res.body.data.filter_mode).toBe('all');
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.tickets.map(t => t.data.what).sort()).toEqual(['A', 'B']);
  });

  it('no filter configured returns all rows from table', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        space_id: 4,
        config: { tickets_table_id: 1708 },
      },
    };
    const columnsByTable = { 1708: [{ id: 'col-x', column_name: 'x' }] };
    const tableMeta = { 1708: { id: 1708, space_id: 4 } };
    const rowsByTable = {
      1708: [
        {
          id: 1,
          base_id: 'b1',
          table_id: 1708,
          data: { 'col-x': '1' },
          created_at: '2026-04-25T00:00:00.000Z',
          updated_at: '2026-04-25T00:00:00.000Z',
        },
      ],
    };
    const app = buildApp({ widgets, columnsByTable, tableMeta, rowsByTable });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(200);
    expect(res.body.data.filter_mode).toBe('all');
    expect(res.body.data.total).toBe(1);
  });

  it('relation column filter matches rows whose data is keyed by column NAME (regression)', async () => {
    // Reproduces the prod bug from screenshot: priority picker saves
    // {column:'priority', value:'24272'} (row_id of "medium" in table 1705).
    // Tickets in prod store data under the column NAME (`priority: 24272`),
    // not under the column id (`12719`). Backend MUST query by name.
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'priority', value: '24272' },
        },
      },
    };
    const columnsByTable = {
      1708: [{ id: 12719, column_name: 'priority' }],
    };
    const rowsByColumnValue = {
      '1708:priority:24272': [
        {
          id: 128319,
          base_id: 'b128319',
          table_id: 1708,
          data: { priority: 24272, what: 'medium-priority ticket' },
          created_at: '2026-04-25T00:00:00.000Z',
          updated_at: '2026-04-25T00:00:00.000Z',
        },
      ],
    };
    const app = buildApp({ widgets, columnsByTable, rowsByColumnValue });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(200);
    expect(res.body.data.filter_mode).toBe('column-filter');
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.applied_filter.column).toBe('priority');
    expect(res.body.data.applied_filter.value).toBe('24272');
  });

  it('id filter returns the row whose primary key equals the value (table_rows.id)', async () => {
    // The pseudo-column `id` skips the table_columns existence check and
    // queries by table_rows.id directly. Lets users pin a single ticket
    // (e.g. for inserting it into a document by number).
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'id', value: '127904' },
        },
      },
    };
    // No need to register `id` in table_columns — controller skips that
    // lookup for the pseudo-column. Other columns can still exist.
    const columnsByTable = { 1708: [{ id: 'col-what', column_name: 'what' }] };
    const rowsByTable = {
      1708: [
        {
          id: 127904,
          base_id: 'b127904',
          table_id: 1708,
          data: { what: 'POST /api/v3/.../escalate' },
          created_at: '2026-04-25T00:00:00.000Z',
          updated_at: '2026-04-25T00:00:00.000Z',
        },
        {
          id: 127905,
          base_id: 'b127905',
          table_id: 1708,
          data: { what: 'unrelated' },
          created_at: '2026-04-25T00:00:00.000Z',
          updated_at: '2026-04-25T00:00:00.000Z',
        },
      ],
    };
    const app = buildApp({ widgets, columnsByTable, rowsByTable });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(200);
    expect(res.body.data.filter_mode).toBe('column-filter');
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.tickets[0].id).toBe(127904);
    expect(res.body.data.applied_filter.column).toBe('id');
    expect(res.body.data.applied_filter.value).toBe('127904');
  });

  it('id filter with non-numeric value returns no rows (silent miss)', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'id', value: 'abc' },
        },
      },
    };
    const columnsByTable = { 1708: [{ id: 'col-x', column_name: 'x' }] };
    const rowsByTable = { 1708: [{ id: 1, base_id: 'b1', table_id: 1708, data: {}, created_at: '', updated_at: '' }] };
    const app = buildApp({ widgets, columnsByTable, rowsByTable });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(200);
    expect(res.body.data.filter_mode).toBe('column-filter');
    expect(res.body.data.total).toBe(0);
  });

  it('id filter with ids array returns rows in array order (manual-ids mode)', async () => {
    // ADR-0012 §4.8: multi-ID atom pattern. The order of `ids` (left-to-right)
    // dictates the rendered order (top-to-bottom). Backend uses
    // array_position() to keep that order regardless of insert/update time.
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'id', ids: [132068, 132066, 132067] },
        },
      },
    };
    const columnsByTable = { 1708: [{ id: 'col-what', column_name: 'what' }] };
    const rowsByTable = {
      1708: [
        { id: 132066, base_id: 'b1', table_id: 1708, data: { what: 'first by creation' }, created_at: '', updated_at: '' },
        { id: 132067, base_id: 'b2', table_id: 1708, data: { what: 'second' }, created_at: '', updated_at: '' },
        { id: 132068, base_id: 'b3', table_id: 1708, data: { what: 'third' }, created_at: '', updated_at: '' },
        { id: 132069, base_id: 'b4', table_id: 1708, data: { what: 'unrelated' }, created_at: '', updated_at: '' },
      ],
    };
    const app = buildApp({ widgets, columnsByTable, rowsByTable });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(200);
    expect(res.body.data.filter_mode).toBe('manual-ids');
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.tickets.map(t => t.id)).toEqual([132068, 132066, 132067]);
    expect(res.body.data.applied_filter.column).toBe('id');
    expect(res.body.data.applied_filter.ids).toEqual([132068, 132066, 132067]);
  });

  it('id filter with ids accepts a CSV string and dedupes / drops bad entries', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          // Tolerant input — frontend sanitises but backend is the
          // canonical guard against drifted UI / direct DB edits.
          filter: { column: 'id', ids: '132066, 132067 , 132066 , bad,, 132068' },
        },
      },
    };
    const columnsByTable = { 1708: [{ id: 'col-what', column_name: 'what' }] };
    const rowsByTable = {
      1708: [
        { id: 132066, base_id: 'b1', table_id: 1708, data: { what: 'a' }, created_at: '', updated_at: '' },
        { id: 132067, base_id: 'b2', table_id: 1708, data: { what: 'b' }, created_at: '', updated_at: '' },
        { id: 132068, base_id: 'b3', table_id: 1708, data: { what: 'c' }, created_at: '', updated_at: '' },
      ],
    };
    const app = buildApp({ widgets, columnsByTable, rowsByTable });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(200);
    expect(res.body.data.filter_mode).toBe('manual-ids');
    expect(res.body.data.applied_filter.ids).toEqual([132066, 132067, 132068]);
    expect(res.body.data.tickets.map(t => t.id)).toEqual([132066, 132067, 132068]);
  });

  it('ids on non-id column is ignored (legacy single-value path wins)', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'adr_ref', value: '129897', ids: [1, 2, 3] },
        },
      },
    };
    const columnsByTable = { 1708: [{ id: 'col-adr', column_name: 'adr_ref' }] };
    const rowsByColumnValue = {
      '1708:adr_ref:129897': [
        { id: 50, base_id: 'b50', table_id: 1708, data: { adr_ref: '129897' }, created_at: '', updated_at: '' },
      ],
    };
    const app = buildApp({ widgets, columnsByTable, rowsByColumnValue });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(200);
    expect(res.body.data.filter_mode).toBe('column-filter');
    expect(res.body.data.applied_filter.value).toBe('129897');
    expect(res.body.data.applied_filter.ids).toBeUndefined();
  });

  it('rejects column names with non-identifier chars (defence in depth)', async () => {
    const widgets = {
      218: {
        id: 218,
        preset_name: 'tickets_list',
        owner_kind: 'dashboard',
        owner_id: 7,
        config: {
          tickets_table_id: 1708,
          filter: { column: 'bad name; DROP TABLE', value: 'x' },
        },
      },
    };
    const app = buildApp({ widgets, columnsByTable: { 1708: [] } });

    const res = await request(app).post('/widgets/218/resolve-tickets').send({}).expect(400);
    expect(res.body.error).toBe('invalid_filter_column');
  });

  it('non-numeric widgetId returns 400', async () => {
    const app = buildApp({});
    await request(app).post('/widgets/abc/resolve-tickets').send({}).expect(400);
  });

  it('widget not found returns 404', async () => {
    const app = buildApp({ widgets: {} });
    await request(app).post('/widgets/9999/resolve-tickets').send({}).expect(404);
  });
});
