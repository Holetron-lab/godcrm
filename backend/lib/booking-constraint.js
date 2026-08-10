// ADR-0034 §7 — DB exclusion constraint for booking widgets.
//
// Postgres GiST EXCLUDE on (lane = AND tstzrange(start,end) &&), scoped per
// universal_tables.table_id via WHERE clause. Single CRM-wide btree_gist
// extension + one IMMUTABLE wrapper (booking_tstzrange_iso). Constraint
// definitions are tracked in `booking_constraints` registry table (lazily
// created on first enable).
//
// Identifier safety: column names are validated against a strict regex before
// being interpolated into DDL. Numeric inputs go through Number() coercion.
// Range payloads are user-supplied via JSONB (data->>col) — the helper never
// interpolates row data into SQL.
//
// IMMUTABLE wrapper note: text::timestamptz is STABLE in Postgres because it
// honours session TimeZone. We label the wrapper IMMUTABLE because callers
// MUST pass ISO-8601 strings carrying an explicit offset (Z or ±HH:MM); for
// such inputs the cast result is deterministic. This lie is required —
// EXCLUDE/GiST expressions reject non-IMMUTABLE functions.

import { dbAll, dbGet, dbRun } from '../database/connection.js';

const SAFE_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const REGISTRY_TABLE = 'booking_constraints';
const WRAPPER_FN = 'booking_tstzrange_iso';
const TABLE_ROWS = 'table_rows';

function constraintNameFor(tableId) {
  return `booking_excl_${Number(tableId)}`;
}

function assertTableId(tableId) {
  const n = Number(tableId);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('booking-constraint: table_id must be a positive integer');
  }
  return n;
}

function assertSafeColumn(label, value) {
  if (typeof value !== 'string' || !SAFE_IDENT.test(value)) {
    throw new Error(`booking-constraint: ${label} must match /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/`);
  }
  return value;
}

async function ensureExtension() {
  await dbRun(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
}

async function ensureWrapper() {
  // Skip CREATE OR REPLACE when the wrapper is already there — avoids
  // "tuple concurrently updated" when parallel callers (vitest concurrency,
  // overlapping HTTP requests) race on pg_proc. CREATE OR REPLACE FUNCTION
  // is NOT internally serialised the way CREATE EXTENSION IF NOT EXISTS is.
  const existing = await dbGet(
    `SELECT 1 AS hit FROM pg_proc WHERE proname = ? LIMIT 1`,
    [WRAPPER_FN]
  );
  if (existing) return;
  try {
    await dbRun(`
      CREATE OR REPLACE FUNCTION ${WRAPPER_FN}(s text, e text)
      RETURNS tstzrange
      LANGUAGE sql
      IMMUTABLE
      PARALLEL SAFE
      AS $$ SELECT tstzrange(s::timestamptz, e::timestamptz, '[)') $$
    `);
  } catch (err) {
    // Concurrent creation: another session won the race. If the wrapper now
    // exists, treat as success — definitions are identical.
    const recheck = await dbGet(
      `SELECT 1 AS hit FROM pg_proc WHERE proname = ? LIMIT 1`,
      [WRAPPER_FN]
    );
    if (recheck) return;
    throw err;
  }
}

async function ensureRegistryTable() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS ${REGISTRY_TABLE} (
      id SERIAL PRIMARY KEY,
      table_id INTEGER NOT NULL UNIQUE,
      lane_column TEXT NOT NULL,
      start_column TEXT NOT NULL,
      end_column TEXT NOT NULL,
      constraint_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function enableBookingConstraint({ table_id, lane_column, start_column, end_column }) {
  const tid = assertTableId(table_id);
  const lane = assertSafeColumn('lane_column', lane_column);
  const start = assertSafeColumn('start_column', start_column);
  const end = assertSafeColumn('end_column', end_column);

  await ensureExtension();
  await ensureWrapper();
  await ensureRegistryTable();

  const cname = constraintNameFor(tid);

  // Idempotent: drop prior incarnation, then re-add. ALTER validates existing
  // rows against the new EXCLUDE predicate; if ANY pair already overlaps,
  // Postgres raises 23P01 from the ALTER itself. Surface that as a
  // structured `BOOKING_CONSTRAINT_EXISTING_OVERLAP` error so callers can
  // return 400 with a clear message instead of a 500.
  await dbRun(`ALTER TABLE ${TABLE_ROWS} DROP CONSTRAINT IF EXISTS "${cname}"`);
  // NOTE: We deliberately use `(data->>'col') IS NOT NULL` instead of the JSONB
  // existence operator `data ? 'col'`. connection.js's convertPlaceholders does
  // a global `?` → `$N` rewrite and would corrupt the JSONB `?` operator.
  try {
    await dbRun(`
      ALTER TABLE ${TABLE_ROWS} ADD CONSTRAINT "${cname}"
      EXCLUDE USING GIST (
        ((data->>'${lane}')) WITH =,
        ${WRAPPER_FN}(data->>'${start}', data->>'${end}') WITH &&
      )
      WHERE (
        table_id = ${tid}
        AND (data->>'${lane}') IS NOT NULL
        AND (data->>'${start}') IS NOT NULL
        AND (data->>'${end}') IS NOT NULL
      )
    `);
  } catch (alterErr) {
    if (alterErr && alterErr.code === '23P01') {
      const wrapped = new Error(
        `Cannot enable booking constraint on table ${tid}: existing rows already overlap`
      );
      wrapped.code = 'BOOKING_CONSTRAINT_EXISTING_OVERLAP';
      wrapped.cause = alterErr;
      throw wrapped;
    }
    throw alterErr;
  }

  await dbRun(`
    INSERT INTO ${REGISTRY_TABLE} (table_id, lane_column, start_column, end_column, constraint_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    ON CONFLICT (table_id) DO UPDATE SET
      lane_column = EXCLUDED.lane_column,
      start_column = EXCLUDED.start_column,
      end_column = EXCLUDED.end_column,
      constraint_name = EXCLUDED.constraint_name,
      updated_at = NOW()
  `, [tid, lane, start, end, cname]);

  return {
    table_id: tid,
    lane_column: lane,
    start_column: start,
    end_column: end,
    constraint_name: cname,
  };
}

export async function disableBookingConstraint(table_id) {
  const tid = assertTableId(table_id);
  await ensureRegistryTable();
  const cname = constraintNameFor(tid);
  await dbRun(`ALTER TABLE ${TABLE_ROWS} DROP CONSTRAINT IF EXISTS "${cname}"`);
  await dbRun(`DELETE FROM ${REGISTRY_TABLE} WHERE table_id = ?`, [tid]);
}

export async function getBookingConstraint(table_id) {
  const tid = assertTableId(table_id);
  // Don't auto-create the registry on read — return null when no helper has
  // ever enabled a constraint on this DB.
  const exists = await dbGet(`
    SELECT 1 AS hit FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ?
  `, [REGISTRY_TABLE]);
  if (!exists) return null;
  const row = await dbGet(`
    SELECT table_id, lane_column, start_column, end_column, constraint_name
    FROM ${REGISTRY_TABLE} WHERE table_id = ?
  `, [tid]);
  return row || null;
}

export function isBookingConflictError(err) {
  if (!err || err.code !== '23P01') return false;
  const cname = err.constraint || '';
  return /^booking_excl_\d+$/.test(cname);
}

export async function findConflictingRowId({ table_id, data, exclude_row_id = null }) {
  const tid = assertTableId(table_id);
  const cfg = await getBookingConstraint(tid);
  if (!cfg) return null;

  const laneVal = data?.[cfg.lane_column];
  const startVal = data?.[cfg.start_column];
  const endVal = data?.[cfg.end_column];
  if (laneVal == null || !startVal || !endVal) return null;

  // Same `?`-operator avoidance as enableBookingConstraint — the placeholder
  // converter would otherwise mangle `data ? 'col'`.
  const params = [tid, String(laneVal), String(startVal), String(endVal)];
  let sql = `
    SELECT id FROM ${TABLE_ROWS}
    WHERE table_id = ?
      AND (data->>'${cfg.lane_column}') IS NOT NULL
      AND (data->>'${cfg.start_column}') IS NOT NULL
      AND (data->>'${cfg.end_column}') IS NOT NULL
      AND (data->>'${cfg.lane_column}') = ?
      AND ${WRAPPER_FN}(data->>'${cfg.start_column}', data->>'${cfg.end_column}')
          && tstzrange((?)::timestamptz, (?)::timestamptz, '[)')
  `;
  if (exclude_row_id != null) {
    sql += ` AND id <> ?`;
    params.push(Number(exclude_row_id));
  }
  sql += ` ORDER BY id ASC LIMIT 1`;
  const row = await dbGet(sql, params);
  return row ? Number(row.id) : null;
}
