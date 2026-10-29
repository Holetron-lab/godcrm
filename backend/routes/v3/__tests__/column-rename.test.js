// @vitest-environment node
import '../../../test/setup.js';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbAll, dbGet, dbRun, getAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import router from '../columns.js';

let ws, columnId, otherId;
const app = express();
app.use(express.json());
app.use('/api/v3', (req, _res, next) => { req.user = { id: ws.userId, role: 'owner' }; next(); }, router);
const patch = (data, id = columnId, table = ws.tableId) => request(app)
  .patch(`/api/v3/tables/${table}/columns/${id}`).send(data);
const row = async data => (await dbRun('INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
  [ws.tableId, `${ws.token}-${Math.random()}`, JSON.stringify(data)])).lastInsertRowid;
const readRow = async id => (await dbGet('SELECT data FROM table_rows WHERE id = ?', [id])).data;

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const schema = await dbAll("SELECT column_name FROM information_schema.columns WHERE table_name = 'table_columns'");
  expect(schema.some(c => c.column_name === 'column_name')).toBe(true);
});
beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'column-rename', dashboard: false });
  columnId = (await dbRun("INSERT INTO table_columns (table_id, column_name, type, display_name) VALUES (?, 'цууца', 'text', 'Title')", [ws.tableId])).lastInsertRowid;
  otherId = (await dbRun("INSERT INTO table_columns (table_id, column_name, type) VALUES (?, 'other', 'text')", [ws.tableId])).lastInsertRowid;
});
afterEach(async () => { await ws?.cleanup(); });

describe('column key rename', () => {
  it('moves only the old key, preserving JSON types, missing values and legacy ID cells', async () => {
    const values = [null, false, 0, '', ['x'], { nested: 'value' }];
    const rows = [];
    for (const value of values) rows.push(await row({ 'цууца': value, other: 'untouched' }));
    const missing = await row({ other: 'untouched' });
    const legacy = await row({ [columnId]: 'legacy' });
    const res = await patch({ column_name: 'cuuca', display_name: 'New title' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ id: columnId, name: 'cuuca', display_name: 'New title' });
    for (const [i, id] of rows.entries()) expect(await readRow(id)).toEqual({ cuuca: values[i], other: 'untouched' });
    expect(await readRow(missing)).toEqual({ other: 'untouched' });
    expect(await readRow(legacy)).toEqual({ [columnId]: 'legacy' });
    expect((await patch({ column_name: 'cuuca' })).status).toBe(200);
  });
  it.each(['', 'кириллица', 'HasUpper', 'space key', 'a-b', "x'--", 'x'.repeat(256), null, 12])('rejects invalid new key %j', async column_name => {
    expect((await patch({ column_name, display_name: 'must not change' })).status).toBe(400);
    expect((await dbGet('SELECT display_name FROM table_columns WHERE id = ?', [columnId])).display_name).toBe('Title');
  });
  it('rejects duplicate names and other column ID aliases', async () => {
    for (const column_name of ['other', String(otherId)]) {
      const res = await patch({ column_name });
      expect(res.status).toBe(409);
    }
  });
  it('rejects orphan destination keys without overwriting data or metadata', async () => {
    const id = await row({ 'цууца': 'source', target: 'existing' });
    expect((await patch({ column_name: 'target', display_name: 'must not change' })).status).toBe(409);
    expect(await readRow(id)).toEqual({ 'цууца': 'source', target: 'existing' });
    expect((await dbGet('SELECT column_name, display_name FROM table_columns WHERE id = ?', [columnId]))).toEqual({ column_name: 'цууца', display_name: 'Title' });
  });
  it('cannot patch a column using a different table URL', async () => {
    const other = await createEphemeralWorkspace({ label: 'rename-other', dashboard: false });
    try { expect((await patch({ display_name: 'wrong' }, columnId, other.tableId)).status).toBe(404); }
    finally { await other.cleanup(); }
  });
  it('does not rename locked or system-source columns', async () => {
    await dbRun('UPDATE table_columns SET is_locked = 1 WHERE id = ?', [columnId]);
    expect((await patch({ column_name: 'target' })).status).toBe(400);
    await dbRun('UPDATE table_columns SET is_locked = 0 WHERE id = ?', [columnId]);
    await dbRun("UPDATE universal_tables SET is_system = 1, sync_target = 'users' WHERE id = ?", [ws.tableId]);
    expect((await patch({ column_name: 'target' })).status).toBe(400);
  });
  it('serializes concurrent renames to the same destination', async () => {
    const responses = await Promise.all([patch({ column_name: 'target' }), patch({ column_name: 'target' }, otherId)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await dbAll("SELECT id FROM table_columns WHERE table_id = ? AND column_name = 'target'", [ws.tableId]))).toHaveLength(1);
  });
});

it('rolls row data back when the metadata write fails', async () => {
  const id = await row({ 'цууца': 'source' });
  const adapter = await getAdapter();
  const transaction = adapter.transaction.bind(adapter);
  const spy = vi.spyOn(adapter, 'transaction').mockImplementation(callback => transaction(async tx => {
    const run = tx.run;
    tx.run = async (sql, params) => {
      if (sql.trim().startsWith('UPDATE table_columns')) throw new Error('Injected metadata write failure');
      return run(sql, params);
    };
    return callback(tx);
  }));
  try { expect((await patch({ column_name: 'target' })).status).toBe(500); }
  finally { spy.mockRestore(); }
  expect(await readRow(id)).toEqual({ 'цууца': 'source' });
  expect((await dbGet('SELECT column_name FROM table_columns WHERE id = ?', [columnId])).column_name).toBe('цууца');
});

it('serializes creation against rename to keep the destination unique', async () => {
  const adapter = await getAdapter();
  const run = adapter.run.bind(adapter);
  const transaction = adapter.transaction.bind(adapter);
  let insertStarted, releaseInsert;
  const started = new Promise(resolve => { insertStarted = resolve; });
  const released = new Promise(resolve => { releaseInsert = resolve; });
  const delayInsert = original => async (sql, params) => {
    if (sql.trim().startsWith('INSERT INTO table_columns')) { insertStarted(); await released; }
    return original(sql, params);
  };
  const runSpy = vi.spyOn(adapter, 'run').mockImplementation(delayInsert(run));
  const txSpy = vi.spyOn(adapter, 'transaction').mockImplementation(callback => transaction(async tx => {
    tx.run = delayInsert(tx.run);
    return callback(tx);
  }));
  try {
    const creating = request(app).post(`/api/v3/tables/${ws.tableId}/columns`)
      .send({ name: 'target', display_name: 'Target', column_type: 'text' }).then(r => r);
    await started;
    const renaming = patch({ column_name: 'target' }).then(r => r);
    // Hold the INSERT so a competing rename can reach its uniqueness check.
    await new Promise(resolve => setTimeout(resolve, 100));
    releaseInsert();
    const responses = await Promise.all([creating, renaming]);
    expect(responses.filter(r => r.status >= 200 && r.status < 300)).toHaveLength(1);
    expect((await dbAll("SELECT id FROM table_columns WHERE table_id = ? AND column_name = 'target'", [ws.tableId]))).toHaveLength(1);
  } finally { releaseInsert(); runSpy.mockRestore(); txSpy.mockRestore(); }
});
