// @vitest-environment node
import '../../../../test/setup.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbAll, dbGet, dbRun } from '../../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';
import router from '../tableRowListController.js';
import { buildOrderClause } from '../../../../services/orderClause.js';

const app = express();
app.use('/api/v3', router);
let ws;
const columns = {};
let foreignColumn;
const rowIds = [];

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  ws = await createEphemeralWorkspace({ label: 'row-sort', dashboard: false });
  for (const [name, type] of [['title', 'text'], ['amount', 'number'], ['position', 'number']]) {
    columns[name] = (await dbRun(
      'INSERT INTO table_columns (table_id, column_name, type) VALUES (?, ?, ?)',
      [ws.tableId, name, type]
    )).lastInsertRowid;
  }
  const other = await dbRun('INSERT INTO universal_tables (project_id, name) VALUES (?, ?)', [ws.projectId, `other-${ws.token}`]);
  foreignColumn = (await dbRun(
    'INSERT INTO table_columns (table_id, column_name, type) VALUES (?, ?, ?)',
    [other.lastInsertRowid, 'foreign', 'text']
  )).lastInsertRowid;
  // Values deliberately cross page boundaries; row 2 uses legacy column-ID keys.
  const values = [
    { title: 'Bravo', amount: 10, position: 3, group: 'keep' },
    { [columns.title]: 'Alpha', [columns.amount]: '2', position: 1, group: 'keep' },
    { title: 'Delta', amount: -2.5, position: 4, group: 'omit' },
    { title: 'Charlie', amount: '100', position: 2, group: 'keep' },
    { title: 'Echo', amount: null, group: 'keep' },
    { title: 'Foxtrot', amount: 'dirty', group: 'keep' },
  ];
  for (const [index, data] of values.entries()) {
    rowIds.push((await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [ws.tableId, `${ws.token}-${index}`, JSON.stringify(data), `2026-01-0${index + 1}`, `2026-02-0${6 - index}`]
    )).lastInsertRowid);
  }
});

afterAll(async () => {
  await ws?.cleanup();
  if (ws) expect(await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [ws.tableId])).toEqual([]);
});

async function list(query = {}) {
  return request(app).get(`/api/v3/tables/${ws.tableId}/rows`).query(query);
}

describe('table_rows sorting from the column header', () => {
  it.each([
    ['asc', 1, [1, 0]], ['asc', 2, [3, 2]],
    ['desc', 1, [5, 4]], ['desc', 2, [2, 3]],
  ])('sorts text %s before pagination, page %s', async (sortDirection, page, indices) => {
    const res = await list({ sortColumn: columns.title, sortDirection, page, limit: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.rows.map(r => r.id)).toEqual(indices.map(i => rowIds[i]));
    expect(res.body.data.pagination).toEqual({ page, limit: 2, total: 6, pages: 3 });
  });

  it.each([
    ['asc', [2, 1, 0, 3, 5, 4]], ['desc', [3, 0, 1, 2, 5, 4]],
  ])('sorts numbers %s numerically, with null/dirty cells last', async (sortDirection, indices) => {
    const res = await list({ sortColumn: columns.amount, sortDirection });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.rows.map(r => r.id)).toEqual(indices.map(i => rowIds[i]));
  });

  it('explicit sorting overrides typed order; reset restores it', async () => {
    await dbRun("UPDATE table_columns SET type = 'order' WHERE id = ?", [columns.position]);
    try {
      const sorted = await list({ sortColumn: columns.position, sortDirection: 'desc' });
      expect(sorted.body.data.rows.map(r => r.id)).toEqual([2, 0, 3, 1, 5, 4].map(i => rowIds[i]));
      const reset = await list();
      expect(reset.status, JSON.stringify(reset.body)).toBe(200);
      expect(reset.body.data.rows.map(r => r.id)).toEqual([1, 3, 0, 2, 5, 4].map(i => rowIds[i]));
    } finally {
      await dbRun("UPDATE table_columns SET type = 'number' WHERE id = ?", [columns.position]);
    }
  });

  it.each([' 1.5 ', '+.5', '1e1', '', {}, '1e999999'])('handles numeric cell %j without 500', async amount => {
    await dbRun("UPDATE table_rows SET data = jsonb_set(data, '{amount}', ?::jsonb) WHERE id = ?", [JSON.stringify(amount), rowIds[0]]);
    try {
      const res = await list({ sortColumn: columns.amount, sortDirection: 'asc' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const valid = [' 1.5 ', '+.5', '1e1'].includes(amount);
      expect(res.body.data.rows.map(r => r.id)).toEqual(
        (valid ? (amount === '1e1' ? [2, 1, 0, 3, 5, 4] : [2, 0, 1, 3, 5, 4]) : [2, 1, 3, 5, 4, 0]).map(i => rowIds[i])
      );
    } finally {
      await dbRun("UPDATE table_rows SET data = jsonb_set(data, '{amount}', '10') WHERE id = ?", [rowIds[0]]);
    }
  });

  it('binds even punctuation in stored field names as a value', async () => {
    const field = "quoted'?--field";
    await dbRun('UPDATE table_columns SET column_name = ? WHERE id = ?', [field, columns.title]);
    try {
      // The legacy ID-keyed Alpha row is still found; other rows have no such field.
      const res = await list({ sortColumn: columns.title, sortDirection: 'asc', limit: 1 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.rows[0].id).toBe(rowIds[1]);
    } finally {
      await dbRun("UPDATE table_columns SET column_name = 'title' WHERE id = ?", [columns.title]);
    }
  });

  it('breaks equal-value/equal-time ties consistently across pages', async () => {
    const ids = [];
    try {
      for (let i = 0; i < 3; i++) {
        ids.push((await dbRun(
          'INSERT INTO table_rows (table_id, base_id, data, created_at) VALUES (?, ?, ?, ?)',
          [ws.tableId, `${ws.token}-tie-${i}`, '{"title":"Tie"}', '2026-03-01']
        )).lastInsertRowid);
      }
      const actual = [];
      for (let page = 1; page <= 3; page++) {
        const res = await list({ sortColumn: columns.title, sortDirection: 'asc', limit: 1, page, filter: '{"title":"Tie"}' });
        expect(res.status).toBe(200);
        actual.push(res.body.data.rows[0].id);
      }
      expect(actual).toEqual([...ids].reverse());
    } finally {
      for (const id of ids) await dbRun('DELETE FROM table_rows WHERE id = ?', [id]);
    }
  });

  it('executes the default order guard through the real placeholder adapter', async () => {
    const rows = await dbAll(`
      SELECT data FROM (VALUES (?::jsonb), (?::jsonb), (?::jsonb), (?::jsonb)) AS fixture(data)
      ORDER BY ${buildOrderClause('order', { tieBreak: null })}
    `, ['{"order":10}', '{"order":2.5}', '{"order":-1}', '{"order":"dirty"}']);
    expect(rows.map(r => r.data.order)).toEqual([-1, 2.5, 10, 'dirty']);
  });

  it('keeps search/filter totals independent of sort parameters', async () => {
    const res = await list({ sortColumn: columns.title, sortDirection: 'asc', search: 'a', searchColumns: `title,${columns.title}`,
      filter: JSON.stringify({ group: 'keep' }), limit: 2, page: 2 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.rows.map(r => r.id)).toEqual([rowIds[3]]);
    expect(res.body.data.pagination.total).toBe(3);
  });

  it.each([
    ['__sys_created_at', 'asc', 0], ['__sys_updated_at', 'asc', 5],
    ['__row_id', 'desc', 5], ['__base_id', 'asc', 0],
  ])('maps synthetic column %s to its row field', async (sortColumn, sortDirection, index) => {
    const res = await list({ sortColumn, sortDirection, limit: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.rows[0].id).toBe(rowIds[index]);
  });

  it.each([
    { sortColumn: 'missing', sortDirection: 'asc' },
    { sortColumn: '1 OR 1=1', sortDirection: 'asc' },
    { sortColumn: '1', sortDirection: 'asc; DROP TABLE table_rows' },
    { sortColumn: ['1', '2'], sortDirection: 'asc' },
    { sortColumn: '1' }, { sortDirection: 'asc' },
  ])('rejects invalid sorting without a server error: %j', async query => {
    expect((await list(query)).status).toBe(400);
  });

  it('rejects a valid column ID belonging to another table', async () => {
    expect((await list({ sortColumn: foreignColumn, sortDirection: 'asc' })).status).toBe(400);
  });

  it('retains created_at DESC when reset on a table without typed order', async () => {
    await dbRun("UPDATE table_columns SET type = 'number' WHERE id = ?", [columns.position]);
    try {
      expect((await list()).body.data.rows.map(r => r.id)).toEqual([...rowIds].reverse());
    } finally {
      await dbRun("UPDATE table_columns SET type = 'order' WHERE id = ?", [columns.position]);
    }
  });
});
