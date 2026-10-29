// GET /api/v3/ai/agents pagination across several agent tables (MEM-20255).
//
// node-postgres returns COUNT(*) (int8) as a string. The handler summed those
// strings, so `total` came back as e.g. "080221010" and the per-table `skipped`
// accounting concatenated too: pages after the first re-served the last tables
// and any offset still returned rows. MentionUsersContext.tsx loops until an
// empty page or `result.length >= total`, so the directory query never finished
// and kept appending full agent rows (instructions included) into the heap.
//
// DB-backed (godcrm_test, ADR-0009): the real pg parser is what turns COUNT into
// a string, so no mocking. `godcrm_test` also exposes admin-space agent tables to
// every user; expected values are derived from the same DB query the handler
// uses, so the assertions stay valid whatever that shared data contains.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbRun, dbAll } from '../../../../database/connection.js';
import { generateBaseId } from '../../../../utils/baseId.js';
import { createEphemeralWorkspace } from '../../../../tests/helpers/workspace-fixture.js';
import agentCrudRouter from '../agentCrudController.js';

const app = express();
app.use(express.json());
let currentUser = null;
app.use((req, _res, next) => { req.user = currentUser; next(); });
app.use('/api/v3/ai', agentCrudRouter);

// Table sizes chosen so that a page of 5 crosses a table boundary, one table is
// empty, and one table is smaller than a page.
const TABLE_SIZES = [3, 2, 0, 2];
const PAGE = 5;

let ws;
const extraTableIds = [];
let expectedTotal = 0;
let fixtureOffset = 0;
const fixtureTotal = TABLE_SIZES.reduce((a, b) => a + b, 0);

async function seedRows(tableId, n) {
  for (let i = 0; i < n; i++) {
    await dbRun(
      'INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)',
      [tableId, generateBaseId(), JSON.stringify({ name: `Paged agent ${tableId}-${i}`, status: 'active' }), ws.userId]
    );
  }
}

async function fetchPage(offset, limit = PAGE) {
  const res = await request(app).get(`/api/v3/ai/agents?limit=${limit}&offset=${offset}`).expect(200);
  expect(res.body.success).toBe(true);
  return res.body.data;
}

beforeAll(async () => {
  ws = await createEphemeralWorkspace({ label: 'agents-paging', dashboard: false, table: false });
  currentUser = { id: ws.userId, email: ws.email, role: 'owner' };

  for (const [i, size] of TABLE_SIZES.entries()) {
    const t = await dbRun(
      'INSERT INTO universal_tables (project_id, name) VALUES (?, ?)',
      [ws.projectId, `Agents paging ${i} ${ws.token}`]
    );
    extraTableIds.push(t.lastInsertRowid);
    await seedRows(t.lastInsertRowid, size);
  }

  // Same visibility predicate as the handler; Number() is the oracle, not the code under test.
  const counts = await dbAll(`
    SELECT ut.id AS table_id, (SELECT COUNT(*) FROM table_rows tr WHERE tr.table_id = ut.id) AS cnt
    FROM universal_tables ut
    JOIN projects p ON ut.project_id = p.id
    JOIN spaces s ON p.space_id = s.id
    WHERE (ut.name LIKE '%Agents%' OR ut.name LIKE '%agents%' OR ut.name LIKE '%Агенты%')
      AND ut.name NOT LIKE 'doc\\_%' ESCAPE '\\'
      AND (s.owner_id = ? OR s.type = 'admin')
    ORDER BY ut.id
  `, [ws.userId]);
  expectedTotal = counts.reduce((sum, r) => sum + Number(r.cnt), 0);
  expect(expectedTotal).toBeGreaterThanOrEqual(fixtureTotal);
  // Walk our small trailing tables, not the growing shared admin directory.
  // Keep real pg counts and exercise skipping every preceding table as well.
  expect(counts.slice(-extraTableIds.length).map(r => r.table_id)).toEqual(extraTableIds);
  fixtureOffset = expectedTotal - fixtureTotal;
});

afterAll(async () => {
  for (const id of extraTableIds) await dbRun('DELETE FROM table_rows WHERE table_id = ?', [id]);
  await ws?.cleanup();
});

describe('GET /api/v3/ai/agents pagination with PostgreSQL string counts', () => {
  it('returns a numeric total equal to the sum of per-table counts', async () => {
    const page = await fetchPage(0);
    expect(typeof page.total).toBe('number');
    expect(page.total).toBe(expectedTotal);
  });

  it('walks every fixture table exactly once with small pages and terminates', async () => {
    const seen = new Map();
    let requests = 0;
    for (let offset = fixtureOffset; ; offset += PAGE) {
      const page = await fetchPage(offset);
      requests += 1;
      for (const a of page.agents) seen.set(a.id, (seen.get(a.id) || 0) + 1);
      // Same stop condition as MentionUsersContext.tsx, after the skipped prefix.
      if (!page.agents.length || fixtureOffset + seen.size >= page.total) break;
      expect(requests).toBeLessThanOrEqual(Math.ceil(fixtureTotal / PAGE) + 1);
    }

    expect(requests).toBe(Math.ceil(fixtureTotal / PAGE));
    expect(seen.size).toBe(fixtureTotal);
    expect([...seen.values()].every(n => n === 1)).toBe(true);

    const fixtureIds = new Set([...seen.keys()]);
    const fixtureRows = await dbAll(
      `SELECT id FROM table_rows WHERE table_id IN (${extraTableIds.map(() => '?').join(',')})`, extraTableIds
    );
    for (const r of fixtureRows) expect(fixtureIds.has(r.id)).toBe(true);
  });

  it('returns an empty page past the end instead of re-serving the last tables', async () => {
    const page = await fetchPage(expectedTotal);
    expect(page.agents).toEqual([]);
    const far = await fetchPage(19800, 200);
    expect(far.agents).toEqual([]);
    expect(far.total).toBe(expectedTotal);
  });
});
