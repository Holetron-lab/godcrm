// @vitest-environment node
import '../../../../test/setup.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbAll, dbGet, dbRun } from '../../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';
import router from '../index.js';

let ws, stranger, currentUser;
const columns = {};
const ids = [];
const app = express();
app.use(express.json());
app.use('/api/v3', (req, _res, next) => { req.user = currentUser; next(); }, router);
const summary = (data = {}, tableId = ws.tableId) => request(app)
  .post(`/api/v3/tables/${tableId}/summary`).send({ data });

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const schema = await dbAll("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('table_rows', 'table_columns', 'universal_tables')");
  expect(schema.some(c => c.table_name === 'table_rows' && c.column_name === 'data')).toBe(true);
  ws = await createEphemeralWorkspace({ label: 'summary', dashboard: false });
  stranger = await createEphemeralWorkspace({ label: 'summary-outsider', dashboard: false });
  currentUser = { id: ws.userId, role: 'viewer' };
  for (const [name, type] of [['amount', 'number'], ['title', 'text'], ['tags', 'multi-select'], ['done', 'checkbox'], ['date', 'date']]) {
    columns[name] = String((await dbRun('INSERT INTO table_columns (table_id, column_name, type) VALUES (?, ?, ?)', [ws.tableId, name, type])).lastInsertRowid);
  }
  for (let i = 1; i <= 65; i++) {
    const data = { amount: i, title: i <= 60 ? 'keep' : 'omit', tags: i % 2 ? ['a', 'b'] : 'b;c', done: i % 2 === 0, date: i <= 60 ? '2026-01-15' : '2026-02-15' };
    if (i === 65) { data[columns.amount] = data.amount; delete data.amount; }
    ids.push((await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [ws.tableId, `${ws.token}-${i}`, JSON.stringify(data)])).lastInsertRowid);
  }
});
afterAll(async () => {
  await stranger?.cleanup();
  await ws?.cleanup();
});

describe('server table summary', () => {
  it('aggregates all 65 rows, including legacy keys, without returning rows', async () => {
    const res = await summary();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.total).toBe(65);
    expect(res.body.data.rows).toBeUndefined();
    expect(res.body.data.columns[columns.amount]).toMatchObject({ count: 65, sum: 2145, avg: 33, min: 1, max: 65, numericCount: 65 });
    expect(res.body.data.columns[columns.title]).toMatchObject({ countUnique: 2, countFilled: 65, countEmpty: 0, percentFilled: 100 });
    expect(res.body.data.columns[columns.done]).toMatchObject({ checked: 32, unchecked: 33, percentChecked: 49 });
    expect(res.body.data.columns[columns.tags].valueCounts).toEqual({ a: 33, b: 65, c: 32 });
    expect(res.body.data.columns[columns.date]).toMatchObject({ earliest: '2026-01-15T00:00:00.000Z', latest: '2026-02-15T00:00:00.000Z', dateRange: 31 });
  });
  it('applies search, select and inclusive date range before aggregation', async () => {
    const res = await summary({ searchQuery: 'KEEP', searchColumns: [columns.title], selectFilters: { [columns.tags]: ['a'] }, dateFilters: { [columns.date]: { from: '2026-01-01', to: '2026-01-15' } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.total).toBe(30);
    expect(res.body.data.columns[columns.amount].sum).toBe(900);
  });
  it('supports explicit selection beyond the first page and ignores foreign row IDs', async () => {
    const res = await summary({ columnIds: [columns.amount], rowIds: [String(ids[0]), String(ids[64]), '2147483647'] });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.columns)).toEqual([columns.amount]);
    expect(res.body.data.columns[columns.amount]).toMatchObject({ count: 2, sum: 66 });
    expect((await summary({ rowIds: [] })).body.data.total).toBe(0);
  });
  it('returns explicit empty aggregates for an empty filtered set', async () => {
    const res = await summary({ searchQuery: 'no-match' });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.columns[columns.amount]).toMatchObject({ count: 0, sum: 0, avg: null, min: null, max: null, countEmpty: 0 });
  });
  it('treats wildcard and SQL characters as literal search input', async () => {
    for (const searchQuery of ['%', '_', "' OR 1=1 --"]) {
      expect((await summary({ searchQuery })).body.data.total).toBe(0);
    }
  });
  it('handles empty, malformed, extreme numeric and invalid date cells without 500', async () => {
    const extra = [];
    try {
      for (const amount of [null, '', 'dirty', '1e999999', 'NaN', 'Infinity', {}, 0]) {
        extra.push((await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)', [ws.tableId, `${ws.token}-bad-${extra.length}`, JSON.stringify({ amount, date: '2026-02-30' })])).lastInsertRowid);
      }
      const res = await summary({ rowIds: extra.map(String) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.columns[columns.amount]).toMatchObject({ count: 8, numericCount: 1, sum: 0, countEmpty: 2, countFilled: 6 });
      expect(res.body.data.columns[columns.date].earliest).toBeNull();
    } finally {
      for (const id of extra) await dbRun('DELETE FROM table_rows WHERE id = ?', [id]);
    }
  });
  it.each([{ page: 2 }, { columnIds: ['oops'] }, { columnIds: ['2147483647'] }, { searchColumns: ['2147483647'] }, { dateFilters: { 1: { from: 'bad' } } }, { selectFilters: { 1: 'bad' } }])('rejects invalid or unknown input %j', async data => {
    expect((await summary(data)).status).toBe(400);
  });
  it('denies outsiders and project-restricted keys', async () => {
    try {
      currentUser = { id: stranger.userId, role: 'viewer' };
      expect((await summary()).status).toBe(403);
      currentUser = { id: ws.userId, role: 'admin', projectId: stranger.projectId };
      expect((await summary()).status).toBe(403);
      currentUser = null;
      expect((await summary()).status).toBe(401);
    } finally { currentUser = { id: ws.userId, role: 'viewer' }; }
  });
  it('allows a viewer grant but excludes denied columns from both output and search', async () => {
    await dbRun('INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by) VALUES (?, ?, ?, ?)', [stranger.userId, ws.spaceId, 'viewer', ws.userId]);
    await dbRun('UPDATE table_columns SET config = ? WHERE id = ?', [JSON.stringify({ access_control: { denied: ['viewer'] } }), columns.title]);
    currentUser = { id: stranger.userId, role: 'viewer' };
    try {
      const res = await summary();
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(65);
      expect(res.body.data.columns[columns.title]).toBeUndefined();
      expect((await summary({ searchQuery: 'keep' })).body.data.total).toBe(0);
      expect((await summary({ columnIds: [columns.title] })).status).toBe(400);
      expect((await summary({ selectFilters: { [columns.title]: ['keep'] } })).status).toBe(400);
      await dbRun("UPDATE user_access_permissions SET access_level = 'denied' WHERE user_id = ? AND space_id = ?", [stranger.userId, ws.spaceId]);
      currentUser.role = 'admin';
      expect((await summary()).status).toBe(403);
    } finally {
      currentUser = { id: ws.userId, role: 'viewer' };
      await dbRun('UPDATE table_columns SET config = NULL WHERE id = ?', [columns.title]);
      await dbRun('DELETE FROM user_access_permissions WHERE user_id = ? AND space_id = ?', [stranger.userId, ws.spaceId]);
    }
  });
  it('applies an exact parent-row filter independently of toolbar filters', async () => {
    const res = await summary({ filter: { title: 'omit' } });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(5);
    expect(res.body.data.columns[columns.amount].sum).toBe(315);
    expect((await summary({ filter: { [columns.amount]: 65 } })).body.data.total).toBe(1);
    expect((await summary({ filter: { unknown: 1 } })).status).toBe(400);
  });
  it('accepts precise timezone bounds so the client can preserve its local calendar day', async () => {
    const res = await summary({ dateFilters: { [columns.date]: { from: '2026-01-15T02:00:00+03:00', to: '2026-01-15T03:00:00+03:00' } } });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(60);
  });
  it('supports serialized multi-select arrays and trims delimited options like the grid', async () => {
    for (const tags of ['["a","b"]', ' a ; b ', ' a , b ']) {
      await dbRun("UPDATE table_rows SET data = jsonb_set(data, '{tags}', ?::jsonb) WHERE id = ?", [JSON.stringify(tags), ids[0]]);
      try {
        const res = await summary({ selectFilters: { [columns.tags]: ['a'] } });
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(33);
        expect(res.body.data.columns[columns.tags].valueCounts).toEqual({ a: 33, b: 33 });
      } finally {
        await dbRun("UPDATE table_rows SET data = jsonb_set(data, '{tags}', ?::jsonb) WHERE id = ?", ['["a","b"]', ids[0]]);
      }
    }
  });
  it('keeps empty-string exact filters distinct from missing values', async () => {
    await dbRun("UPDATE table_rows SET data = jsonb_set(data, '{title}', '\"\"') WHERE id = ?", [ids[0]]);
    try {
      const res = await summary({ filter: { title: '' } });
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.columns[columns.title].countEmpty).toBe(1);
    } finally {
      await dbRun("UPDATE table_rows SET data = jsonb_set(data, '{title}', '\"keep\"') WHERE id = ?", [ids[0]]);
    }
  });
  it('rejects nonexistent tables and unsupported system sources explicitly', async () => {
    expect((await summary({}, 2147483647)).status).toBe(404);
    await dbRun("UPDATE universal_tables SET is_system = 1, sync_target = 'users' WHERE id = ?", [ws.tableId]);
    try {
      const res = await summary();
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SUMMARY_SOURCE_UNSUPPORTED');
    } finally { await dbRun('UPDATE universal_tables SET is_system = 0, sync_target = NULL WHERE id = ?', [ws.tableId]); }
  });
});

it('keeps full row counts for absent cells and null-name / ID fallbacks', async () => {
  const original = (await dbGet('SELECT data FROM table_rows WHERE id = ?', [ids[0]])).data;
  try {
    for (const [data, expected] of [
      [{ title: 'keep' }, { count: 1, countEmpty: 1, countFilled: 0, sum: 0 }],
      [{ amount: null, [columns.amount]: 7, title: 'keep' }, { count: 1, countEmpty: 0, countFilled: 1, sum: 7 }],
      [{ amount: 0, [columns.amount]: 7, title: 'keep' }, { count: 1, countEmpty: 0, countFilled: 1, sum: 0 }],
    ]) {
      await dbRun('UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify(data), ids[0]]);
      const res = await summary({ columnIds: [columns.amount], rowIds: [String(ids[0])], searchQuery: 'keep', searchColumns: [columns.title] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.columns[columns.amount]).toMatchObject(expected);
      expect(Object.keys(res.body.data.columns)).toEqual([columns.amount]);
    }
  } finally { await dbRun('UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify(original), ids[0]]); }
});
