// @vitest-environment node
import '../../../../test/setup.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbAll, dbGet, dbRun } from '../../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';
import router from '../index.js';

let ws, columns;
const app = express();
app.use(express.json());
app.use('/api/v3', (req, _res, next) => { req.user = { id: ws.userId, role: 'viewer' }; next(); }, router);

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const schema = await dbAll("SELECT column_name FROM information_schema.columns WHERE table_name = 'table_rows'");
  expect(schema.some(c => c.column_name === 'data')).toBe(true);
  ws = await createEphemeralWorkspace({ label: 'summary-perf', dashboard: false });
  await dbRun(`INSERT INTO table_columns (table_id, column_name, type)
    SELECT $1, 'amount_' || n, 'number' FROM generate_series(1, 17) AS n`, [ws.tableId]);
  columns = await dbAll('SELECT id FROM table_columns WHERE table_id = ? ORDER BY id', [ws.tableId]);
  await dbRun(`INSERT INTO table_rows (table_id, base_id, data)
    SELECT $1, $2 || n, (SELECT jsonb_object_agg('amount_' || c, n) FROM generate_series(1, 17) c)
    FROM generate_series(1, 11159) n`, [ws.tableId, ws.token]);
}, 180000);
afterAll(async () => { await ws?.cleanup(); });

it('summarizes 11159 rows / 17 columns within the interactive budget', async () => {
  const start = performance.now();
  const res = await request(app).post(`/api/v3/tables/${ws.tableId}/summary`)
    .send({ data: { columnIds: columns.map(c => String(c.id)) } });
  const elapsed = performance.now() - start;
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.data.total).toBe(11159);
  for (const c of columns) expect(res.body.data.columns[c.id]).toMatchObject({ count: 11159, sum: 62267220 });
  expect(elapsed, `summary took ${Math.round(elapsed)} ms`).toBeLessThan(5000);
}, 90000);
