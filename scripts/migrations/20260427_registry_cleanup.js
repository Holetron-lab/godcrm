#!/usr/bin/env node
// Migration 2026-04-27: ADR-0011 / ADR-0013 registry cleanup.
//
// Sister migration to `20260427_doc_tables_cleanup.js`. Performs the
// table-2197 (`_registry`) refactor:
//
//   STEP A — drop the dead `verified` (checkbox) column from 2197.
//            (Already dropped in some envs; idempotent.)
//   STEP B — move table 7341 (`_doc_statuses`) into project 138
//            ("Architecture & ADR") with display_name = 'ADR Statuses'.
//   STEP C — migrate plan_verification.config.guards from `["status"]`
//            to `["status_id"]` (matches refactored backend/services/
//            verification/guards.js which resolves relation→slug).
//   STEP D — drop the `status` (select) column from 2197 and strip the
//            'status' key from all 169 row.data JSONB blobs (canonical
//            value lives on `status_id` relation).
//
// Idempotent: re-running yields 0 affected rows.
//
// Connects via POSTGRES_* env vars. Wraps everything in a single
// transaction. Prints per-step affected counts.
//
// Usage:
//   node scripts/migrations/20260427_registry_cleanup.js
//   POSTGRES_DB=godcrm_test node scripts/migrations/20260427_registry_cleanup.js

import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const HOST = process.env.POSTGRES_HOST || 'localhost';
const PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10);
const DB   = process.env.POSTGRES_DB   || 'godcrm';
const USER = process.env.POSTGRES_USER || 'godcrm';
const PASS = process.env.POSTGRES_PASSWORD;

if (!PASS) {
  console.error('[migration] POSTGRES_PASSWORD not set');
  process.exit(1);
}

const REGISTRY_TABLE_ID = 2197;
const STATUSES_TABLE_ID = 7341;
const ADR_PROJECT_ID    = 138;

const client = new Client({ host: HOST, port: PORT, database: DB, user: USER, password: PASS });

async function run() {
  await client.connect();
  console.log(`[migration] Connected: ${USER}@${HOST}:${PORT}/${DB}`);

  await client.query('BEGIN');
  try {
    // STEP A — drop `verified` column from 2197 (column row + JSONB key).
    const aColRes = await client.query(`
      DELETE FROM table_columns
      WHERE table_id = $1 AND column_name = 'verified'
    `, [REGISTRY_TABLE_ID]);
    const aDataRes = await client.query(`
      UPDATE table_rows
      SET data = data - 'verified'
      WHERE table_id = $1 AND data ? 'verified'
    `, [REGISTRY_TABLE_ID]);
    console.log(`[A] dropped 'verified' column rows: ${aColRes.rowCount}; stripped JSONB key from ${aDataRes.rowCount} rows`);

    // STEP B — move table 7341 to project 138 with display_name 'ADR Statuses'.
    //          Skip if already there.
    const bRes = await client.query(`
      UPDATE universal_tables
      SET project_id = $1, display_name = 'ADR Statuses'
      WHERE id = $2
        AND (project_id IS DISTINCT FROM $1 OR display_name IS DISTINCT FROM 'ADR Statuses')
    `, [ADR_PROJECT_ID, STATUSES_TABLE_ID]);
    console.log(`[B] moved table ${STATUSES_TABLE_ID} → project ${ADR_PROJECT_ID}: ${bRes.rowCount} row(s)`);

    // STEP C — plan_verification.config.guards = ["status_id"].
    //          Only update if not already set to ["status_id"].
    const cRes = await client.query(`
      UPDATE table_columns
      SET config = jsonb_set(
        COALESCE(config::jsonb, '{}'::jsonb),
        '{guards}',
        '["status_id"]'::jsonb,
        true
      )::text
      WHERE table_id = $1
        AND column_name = 'plan_verification'
        AND (config::jsonb->'guards') IS DISTINCT FROM '["status_id"]'::jsonb
    `, [REGISTRY_TABLE_ID]);
    console.log(`[C] set plan_verification.config.guards=["status_id"] on ${cRes.rowCount} row(s)`);

    // STEP D — drop `status` (select) column from 2197 and strip JSONB key.
    //          (Canonical status now lives on status_id relation.)
    const dColRes = await client.query(`
      DELETE FROM table_columns
      WHERE table_id = $1 AND column_name = 'status' AND type = 'select'
    `, [REGISTRY_TABLE_ID]);
    const dDataRes = await client.query(`
      UPDATE table_rows
      SET data = data - 'status'
      WHERE table_id = $1 AND data ? 'status'
    `, [REGISTRY_TABLE_ID]);
    console.log(`[D] dropped 'status' (select) column rows: ${dColRes.rowCount}; stripped JSONB key from ${dDataRes.rowCount} rows`);

    await client.query('COMMIT');
    console.log('\n[migration] COMMIT — summary:');
    console.log(`  A) verified column dropped:           ${aColRes.rowCount} (data rows: ${aDataRes.rowCount})`);
    console.log(`  B) 7341 moved to project 138:         ${bRes.rowCount}`);
    console.log(`  C) guards → ["status_id"]:            ${cRes.rowCount}`);
    console.log(`  D) status select dropped:             ${dColRes.rowCount} (data rows: ${dDataRes.rowCount})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migration] ROLLBACK due to error:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('[migration] fatal:', err);
  process.exit(1);
});
