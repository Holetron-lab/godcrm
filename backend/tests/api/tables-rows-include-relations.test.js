// ADR-205 AC1/AC2 — GET /tables/:id/rows and /rows/:rowId on the local `table_rows` branch:
// without `include` the payload keys are exactly the pre-ADR-205 ones; with
// `include=relations` the lens map resolves text keys (valueColumn ≠ id) and numeric ids,
// and counts missing keys. DB-backed on the pinned test contour (ADR-0009).
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbRun, resetAdapter } from '../../database/connection.js';
import tablesRouter from '../../routes/v3/tables.js';
import { createEphemeralWorkspace } from '../helpers/workspace-fixture.js';

const app = express();
app.use(express.json());
app.use('/api/v3', (req, _res, next) => { req.user = { id: 1, email: 'test@example.com', role: 'admin' }; next(); }, tablesRouter);

let ws;
let productsId;   // related table: rows keyed by `code`
let ordersId;     // parent table: `product` (text, lens by code) + `status` (select, lens by id)
let statusId;     // related table for the id lens
let chairRowId;
let statusRowId;

async function insertColumn(tableId, name, type, config, order) {
  await dbRun(
    `INSERT INTO table_columns (table_id, column_name, display_name, type, config, order_index, is_visible, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
    [tableId, name, name, type, JSON.stringify(config), order]
  );
}
async function insertRow(tableId, data) {
  const r = await dbRun('INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
    [tableId, `b-${tableId}-${Math.random().toString(36).slice(2)}`, JSON.stringify(data)]);
  return r.lastInsertRowid;
}

beforeAll(async () => {
  await resetAdapter();
  ws = await createEphemeralWorkspace({ label: 'lens', dashboard: false });
  ordersId = ws.tableId;
  productsId = (await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, `lens-products-${ws.token}`])).lastInsertRowid;
  statusId = (await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, `lens-status-${ws.token}`])).lastInsertRowid;

  await insertColumn(productsId, 'code', 'text', {}, 0);
  await insertColumn(productsId, 'image', 'text', {}, 1);
  await insertColumn(statusId, 'name', 'text', {}, 0);
  await insertColumn(ordersId, 'product', 'text', { relation: { enabled: true, tableId: String(productsId), valueColumn: 'code', labelColumn: 'image' } }, 0);
  await insertColumn(ordersId, 'status', 'select', { relation: { enabled: true, tableId: String(statusId), valueColumn: 'id', labelColumn: 'name', colorColumn: 'color' } }, 1);
  await insertColumn(ordersId, 'note', 'text', {}, 2);

  chairRowId = await insertRow(productsId, { code: 'CHAIR-1', image: 'img/chair.jpg' });
  await insertRow(productsId, { code: 'TABLE-9', image: 'img/table.jpg' });
  statusRowId = await insertRow(statusId, { name: 'done', color: '#22c55e' });

  await insertRow(ordersId, { product: 'CHAIR-1', status: statusRowId, note: 'a' });
  await insertRow(ordersId, { product: 'TABLE-9', status: String(statusRowId), note: 'b' });
  await insertRow(ordersId, { product: 'GHOST-0', status: 999999999, note: 'c' });
});

afterAll(async () => {
  for (const id of [ordersId, productsId, statusId]) {
    await dbRun('DELETE FROM table_rows WHERE table_id = ?', [id]);
    await dbRun('DELETE FROM table_columns WHERE table_id = ?', [id]);
  }
  await ws.cleanup();
});

describe('GET /tables/:id/rows — ADR-205 include=relations (local table_rows)', () => {
  test('AC1: without include the payload has exactly rows + pagination', async () => {
    const res = await request(app).get(`/api/v3/tables/${ordersId}/rows`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['pagination', 'rows']);
    expect(res.body.data.rows).toHaveLength(3);
    expect(res.body.data.rows[0].data.product).toMatch(/^(CHAIR-1|TABLE-9|GHOST-0)$/); // keys stay raw
  });

  test('AC2: include=relations resolves text keys and ids, counts missing, keys stay raw', async () => {
    const res = await request(app).get(`/api/v3/tables/${ordersId}/rows?include=relations`);
    expect(res.status).toBe(200);
    const { rows, relations, relations_meta } = res.body.data;
    expect(rows.map((r) => r.data.product).sort()).toEqual(['CHAIR-1', 'GHOST-0', 'TABLE-9']);
    expect(relations.product).toEqual({
      'CHAIR-1': { value: 'img/chair.jpg', label: 'img/chair.jpg' },
      'TABLE-9': { value: 'img/table.jpg', label: 'img/table.jpg' },
    });
    expect(relations_meta.product).toEqual({ resolved: 2, missing: 1, truncated: false });
    expect(relations.status).toEqual({ [String(statusRowId)]: { value: 'done', label: 'done', color: '#22c55e' } });
    expect(relations_meta.status).toEqual({ resolved: 1, missing: 1, truncated: false });
    expect(relations.note).toBeUndefined();
  });

  test('single row GET: include=relations attaches the map next to row + columns', async () => {
    const list = await request(app).get(`/api/v3/tables/${ordersId}/rows?limit=1&filter=${encodeURIComponent('{"note":"a"}')}`);
    const rowId = list.body.data.rows[0].id;

    const plain = await request(app).get(`/api/v3/tables/${ordersId}/rows/${rowId}`);
    expect(Object.keys(plain.body.data).sort()).toEqual(['columns', 'row']);

    const lensed = await request(app).get(`/api/v3/tables/${ordersId}/rows/${rowId}?include=relations`);
    expect(lensed.status).toBe(200);
    expect(lensed.body.data.row.data.product).toBe('CHAIR-1');
    expect(lensed.body.data.relations.product).toEqual({ 'CHAIR-1': { value: 'img/chair.jpg', label: 'img/chair.jpg' } });
    expect(lensed.body.data.relations_meta.status.resolved).toBe(1);
    expect(chairRowId).toBeGreaterThan(0);
  });
});
