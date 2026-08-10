// ADR-0034 §7 — Integration tests for the 23P01 → 409 contract on
// POST/PUT /api/v3/tables/:tableId/rows. Boots a minimal Express app with
// the tables router, mocks auth, and exercises the full controller path
// against godcrm_test.

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbGet, dbRun, resetAdapter } from '../database/connection.js';
import tablesRouter from '../routes/v3/tables.js';
import {
  enableBookingConstraint,
  disableBookingConstraint,
} from '../lib/booking-constraint.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v3', (req, _res, next) => {
    req.user = { id: 1, email: 'test@example.com', role: 'admin' };
    next();
  }, tablesRouter);
  return app;
}

async function makeFreshTable() {
  const project = await dbRun(
    `INSERT INTO projects (name, type, owner_id, created_at, updated_at)
     VALUES ($1, 'default', 1, NOW(), NOW())`,
    [`bcx_int_proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`]
  );
  const projectId = project.lastInsertRowid;
  const table = await dbRun(
    `INSERT INTO universal_tables (project_id, name, display_name, is_system, created_at, updated_at)
     VALUES ($1, $2, 'IntBookings', 0, NOW(), NOW())`,
    [projectId, `bcx_int_t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`]
  );
  return { projectId, tableId: table.lastInsertRowid };
}

async function dropTable({ projectId, tableId }) {
  await dbRun(`DELETE FROM table_rows WHERE table_id = $1`, [tableId]);
  await dbRun(`DELETE FROM universal_tables WHERE id = $1`, [tableId]);
  await dbRun(`DELETE FROM projects WHERE id = $1`, [projectId]);
}

describe('POST/PUT /api/v3/tables/:tableId/rows — booking 23P01→409 (ADR-0034 §7)', () => {
  let app;
  let ctx;

  beforeAll(async () => {
    await resetAdapter();
    app = createTestApp();
  });

  afterEach(async () => {
    if (!ctx) return;
    try { await disableBookingConstraint(ctx.tableId); } catch {}
    await dropTable(ctx);
    ctx = null;
  });

  test('single overlapping POST returns 201 then 409 with conflicting_row_id', async () => {
    ctx = await makeFreshTable();
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });

    const ok = await request(app)
      .post(`/api/v3/tables/${ctx.tableId}/rows`)
      .send({ data: { lane_id: 'L1', start_at: '2026-05-09T14:00:00Z', end_at: '2026-05-09T15:00:00Z' } });
    expect(ok.status).toBe(201);
    expect(ok.body.success).toBe(true);
    const firstRowId = Number(ok.body.data.id);
    expect(firstRowId).toBeGreaterThan(0);

    const conflict = await request(app)
      .post(`/api/v3/tables/${ctx.tableId}/rows`)
      .send({ data: { lane_id: 'L1', start_at: '2026-05-09T14:30:00Z', end_at: '2026-05-09T15:30:00Z' } });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({
      success: false,
      error: 'slot_taken',
      conflicting_row_id: firstRowId,
    });
  });

  test('parallel POSTs to the same slot — exactly one wins, the other gets 409', async () => {
    ctx = await makeFreshTable();
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });

    const payload = { lane_id: 'L1', start_at: '2026-05-09T16:00:00Z', end_at: '2026-05-09T17:00:00Z' };
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/v3/tables/${ctx.tableId}/rows`).send({ data: { ...payload } }),
      request(app).post(`/api/v3/tables/${ctx.tableId}/rows`).send({ data: { ...payload } }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = r1.status === 201 ? r1 : r2;
    const loser = r1.status === 409 ? r1 : r2;
    expect(winner.body.success).toBe(true);
    expect(loser.body.error).toBe('slot_taken');
    expect(Number(loser.body.conflicting_row_id)).toBe(Number(winner.body.data.id));
  });

  test('non-overlapping POST in same lane returns 201', async () => {
    ctx = await makeFreshTable();
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });

    const a = await request(app)
      .post(`/api/v3/tables/${ctx.tableId}/rows`)
      .send({ data: { lane_id: 'L1', start_at: '2026-05-09T10:00:00Z', end_at: '2026-05-09T11:00:00Z' } });
    const b = await request(app)
      .post(`/api/v3/tables/${ctx.tableId}/rows`)
      .send({ data: { lane_id: 'L1', start_at: '2026-05-09T11:00:00Z', end_at: '2026-05-09T12:00:00Z' } });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  test('PUT overlapping returns 409 with conflicting_row_id (excluding self)', async () => {
    ctx = await makeFreshTable();
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });

    const blockerRes = await request(app)
      .post(`/api/v3/tables/${ctx.tableId}/rows`)
      .send({ data: { lane_id: 'L1', start_at: '2026-05-09T14:00:00Z', end_at: '2026-05-09T15:00:00Z' } });
    expect(blockerRes.status).toBe(201);
    const blockerId = Number(blockerRes.body.data.id);

    const movableRes = await request(app)
      .post(`/api/v3/tables/${ctx.tableId}/rows`)
      .send({ data: { lane_id: 'L1', start_at: '2026-05-09T16:00:00Z', end_at: '2026-05-09T17:00:00Z' } });
    expect(movableRes.status).toBe(201);
    const movableId = Number(movableRes.body.data.id);

    // Try to move `movable` so it overlaps `blocker`.
    const conflictRes = await request(app)
      .put(`/api/v3/tables/${ctx.tableId}/rows/${movableId}`)
      .send({ data: { lane_id: 'L1', start_at: '2026-05-09T14:30:00Z', end_at: '2026-05-09T15:30:00Z' } });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body).toMatchObject({
      success: false,
      error: 'slot_taken',
      conflicting_row_id: blockerId,
    });

    // PUT that does not actually overlap any other row succeeds (self is excluded).
    const okRes = await request(app)
      .put(`/api/v3/tables/${ctx.tableId}/rows/${movableId}`)
      .send({ data: { lane_id: 'L1', start_at: '2026-05-09T18:00:00Z', end_at: '2026-05-09T19:00:00Z' } });
    expect(okRes.status).toBe(200);
  });
});
