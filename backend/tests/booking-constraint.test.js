// ADR-0034 §7 — Unit tests for booking-constraint helper.
//
// Runs against godcrm_test (ADR-0009 boot guard enforces this). Each test
// allocates a fresh project + universal_table so the EXCLUDE constraint is
// scoped to a private table_id and never collides with seeded data.

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { dbAll, dbGet, dbRun } from '../database/connection.js';
import {
  enableBookingConstraint,
  disableBookingConstraint,
  getBookingConstraint,
  findConflictingRowId,
  isBookingConflictError,
} from '../lib/booking-constraint.js';
import { generateBaseId } from '../utils/baseId.js';

async function makeFreshTable() {
  const project = await dbRun(
    `INSERT INTO projects (name, type, owner_id, created_at, updated_at)
     VALUES ($1, 'default', 1, NOW(), NOW())`,
    [`bcx_proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`]
  );
  const projectId = project.lastInsertRowid;
  const table = await dbRun(
    `INSERT INTO universal_tables (project_id, name, display_name, is_system, created_at, updated_at)
     VALUES ($1, $2, 'Bookings', 0, NOW(), NOW())`,
    [projectId, `bcx_t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`]
  );
  return { projectId, tableId: table.lastInsertRowid };
}

async function dropTable({ projectId, tableId }) {
  await dbRun(`DELETE FROM table_rows WHERE table_id = $1`, [tableId]);
  await dbRun(`DELETE FROM universal_tables WHERE id = $1`, [tableId]);
  await dbRun(`DELETE FROM projects WHERE id = $1`, [projectId]);
}

async function insertRow(tableId, data) {
  const r = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [tableId, generateBaseId(), JSON.stringify(data)]
  );
  return r.lastInsertRowid;
}

describe('booking-constraint helper (ADR-0034 §7)', () => {
  let ctx;

  beforeEach(async () => {
    ctx = await makeFreshTable();
  });

  afterEach(async () => {
    if (!ctx) return;
    try { await disableBookingConstraint(ctx.tableId); } catch {}
    await dropTable(ctx);
    ctx = null;
  });

  test('enableBookingConstraint creates the registry row + GiST constraint', async () => {
    const cfg = await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    expect(cfg).toEqual({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
      constraint_name: `booking_excl_${ctx.tableId}`,
    });

    const stored = await getBookingConstraint(ctx.tableId);
    expect(stored).toMatchObject({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
      constraint_name: `booking_excl_${ctx.tableId}`,
    });

    const con = await dbGet(
      `SELECT 1 AS hit FROM pg_constraint WHERE conname = $1`,
      [`booking_excl_${ctx.tableId}`]
    );
    expect(con).toBeTruthy();
  });

  test('CREATE EXTENSION btree_gist is installed and re-enabling is idempotent', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    const ext = await dbGet(`SELECT 1 AS hit FROM pg_extension WHERE extname = 'btree_gist'`);
    expect(ext).toBeTruthy();

    // Calling enable again must not error (CREATE EXTENSION IF NOT EXISTS).
    await expect(enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    })).resolves.toBeTruthy();
  });

  test('IMMUTABLE wrapper booking_tstzrange_iso exists with correct volatility', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    const fn = await dbGet(`
      SELECT provolatile FROM pg_proc
      WHERE proname = 'booking_tstzrange_iso'
      LIMIT 1
    `);
    expect(fn).toBeTruthy();
    expect(fn.provolatile).toBe('i');
  });

  test('overlapping inserts inside same lane are rejected with 23P01', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    const id1 = await insertRow(ctx.tableId, {
      lane_id: 'L1',
      start_at: '2026-05-09T14:00:00Z',
      end_at: '2026-05-09T15:00:00Z',
    });
    expect(id1).toBeGreaterThan(0);

    let pgErr;
    try {
      await insertRow(ctx.tableId, {
        lane_id: 'L1',
        start_at: '2026-05-09T14:30:00Z',
        end_at: '2026-05-09T15:30:00Z',
      });
    } catch (e) {
      pgErr = e;
    }
    expect(pgErr).toBeTruthy();
    expect(pgErr.code).toBe('23P01');
    expect(pgErr.constraint).toBe(`booking_excl_${ctx.tableId}`);
  });

  test('non-overlapping inserts in same lane succeed', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    await insertRow(ctx.tableId, { lane_id: 'L1', start_at: '2026-05-09T14:00:00Z', end_at: '2026-05-09T15:00:00Z' });
    const id2 = await insertRow(ctx.tableId, { lane_id: 'L1', start_at: '2026-05-09T15:00:00Z', end_at: '2026-05-09T16:00:00Z' });
    expect(id2).toBeGreaterThan(0);
  });

  test('overlapping inserts in different lanes succeed', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    await insertRow(ctx.tableId, { lane_id: 'L1', start_at: '2026-05-09T14:00:00Z', end_at: '2026-05-09T15:00:00Z' });
    const id2 = await insertRow(ctx.tableId, { lane_id: 'L2', start_at: '2026-05-09T14:30:00Z', end_at: '2026-05-09T15:30:00Z' });
    expect(id2).toBeGreaterThan(0);
  });

  test('constraint is scoped — overlap in another table_id is allowed', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    await insertRow(ctx.tableId, { lane_id: 'L1', start_at: '2026-05-09T14:00:00Z', end_at: '2026-05-09T15:00:00Z' });

    const otherCtx = await makeFreshTable();
    try {
      const id = await insertRow(otherCtx.tableId, { lane_id: 'L1', start_at: '2026-05-09T14:30:00Z', end_at: '2026-05-09T15:30:00Z' });
      expect(id).toBeGreaterThan(0);
    } finally {
      await dropTable(otherCtx);
    }
  });

  test('disableBookingConstraint drops the GiST constraint and registry row', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    await disableBookingConstraint(ctx.tableId);

    const cfg = await getBookingConstraint(ctx.tableId);
    expect(cfg).toBeNull();

    const con = await dbGet(
      `SELECT 1 AS hit FROM pg_constraint WHERE conname = $1`,
      [`booking_excl_${ctx.tableId}`]
    );
    expect(con).toBeFalsy();

    const id = await insertRow(ctx.tableId, { lane_id: 'L1', start_at: '2026-05-09T14:00:00Z', end_at: '2026-05-09T15:00:00Z' });
    const id2 = await insertRow(ctx.tableId, { lane_id: 'L1', start_at: '2026-05-09T14:30:00Z', end_at: '2026-05-09T15:30:00Z' });
    expect(id).toBeGreaterThan(0);
    expect(id2).toBeGreaterThan(0);
  });

  test('isBookingConflictError narrows by code AND constraint name', () => {
    expect(isBookingConflictError({ code: '23P01', constraint: 'booking_excl_42' })).toBe(true);
    expect(isBookingConflictError({ code: '23P01', constraint: 'unrelated_excl' })).toBe(false);
    expect(isBookingConflictError({ code: '23505', constraint: 'booking_excl_42' })).toBe(false);
    expect(isBookingConflictError({ code: '23P01' })).toBe(false);
    expect(isBookingConflictError(null)).toBe(false);
    expect(isBookingConflictError(undefined)).toBe(false);
  });

  test('findConflictingRowId returns the existing row when overlap is intended', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    const existingId = await insertRow(ctx.tableId, {
      lane_id: 'L1',
      start_at: '2026-05-09T14:00:00Z',
      end_at: '2026-05-09T15:00:00Z',
    });
    const conflictId = await findConflictingRowId({
      table_id: ctx.tableId,
      data: { lane_id: 'L1', start_at: '2026-05-09T14:30:00Z', end_at: '2026-05-09T15:30:00Z' },
    });
    expect(conflictId).toBe(existingId);
  });

  test('findConflictingRowId honours exclude_row_id (PUT self-skip)', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId,
      lane_column: 'lane_id',
      start_column: 'start_at',
      end_column: 'end_at',
    });
    const selfId = await insertRow(ctx.tableId, {
      lane_id: 'L1',
      start_at: '2026-05-09T14:00:00Z',
      end_at: '2026-05-09T15:00:00Z',
    });
    const conflict = await findConflictingRowId({
      table_id: ctx.tableId,
      data: { lane_id: 'L1', start_at: '2026-05-09T14:30:00Z', end_at: '2026-05-09T15:30:00Z' },
      exclude_row_id: selfId,
    });
    expect(conflict).toBeNull();
  });

  test('enableBookingConstraint rejects unsafe identifiers', async () => {
    await expect(enableBookingConstraint({
      table_id: ctx.tableId, lane_column: 'lane; DROP TABLE', start_column: 'start_at', end_column: 'end_at',
    })).rejects.toThrow(/lane_column must match/);
    await expect(enableBookingConstraint({
      table_id: ctx.tableId, lane_column: 'lane_id', start_column: '', end_column: 'end_at',
    })).rejects.toThrow(/start_column must match/);
    await expect(enableBookingConstraint({
      table_id: 'oops', lane_column: 'lane_id', start_column: 'start_at', end_column: 'end_at',
    })).rejects.toThrow(/table_id must be a positive integer/);
  });

  test('enableBookingConstraint is idempotent (re-enable replaces)', async () => {
    await enableBookingConstraint({
      table_id: ctx.tableId, lane_column: 'lane_id', start_column: 'start_at', end_column: 'end_at',
    });
    const cfg2 = await enableBookingConstraint({
      table_id: ctx.tableId, lane_column: 'lane_id', start_column: 'start_at', end_column: 'end_at',
    });
    expect(cfg2.constraint_name).toBe(`booking_excl_${ctx.tableId}`);

    const dupes = await dbAll(
      `SELECT COUNT(*)::int AS n FROM booking_constraints WHERE table_id = $1`,
      [ctx.tableId]
    );
    expect(dupes[0].n).toBe(1);
  });
});
