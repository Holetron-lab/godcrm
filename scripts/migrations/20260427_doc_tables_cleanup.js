#!/usr/bin/env node
// Migration 2026-04-27: doc_* table cleanup.
//
// Companion to the factory update in `_helpers.js` that:
//   - adds `integer: true` to the `order` column config
//   - adds `cellFormat.mode: 'markdown'` to `content_${lang}` columns
//   - drops the `task_ref` and `ticket_ref` columns from new doc tables
//   - removes 'ticket' from the `level` enum
//
// This migration brings the 662 EXISTING `doc_*` tables in line with the new
// factory shape. Idempotent — re-running yields 0 affected rows.
//
// Steps:
//   a) Drop task_ref / ticket_ref entries from `table_columns` (doc_* tables)
//   b) Strip the same keys from JSONB row data
//   c) `content_${lang}` → ensure cellFormat.mode = 'markdown'
//   d) `order` → ensure config.integer = true
//   e) Drop 'ticket' from `level` enum options
//
// Connects via POSTGRES_* env vars (matches `backend/database/adapters/PostgresAdapter.js`).
// Wraps everything in a single transaction. Prints per-step affected counts.
//
// Usage:
//   node scripts/migrations/20260427_doc_tables_cleanup.js
//   POSTGRES_DB=godcrm_test node scripts/migrations/20260427_doc_tables_cleanup.js

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

const client = new Client({ host: HOST, port: PORT, database: DB, user: USER, password: PASS });

async function run() {
  await client.connect();
  console.log(`[migration] Connected: ${USER}@${HOST}:${PORT}/${DB}`);

  await client.query('BEGIN');
  try {
    // a) Drop task_ref / ticket_ref column rows from table_columns
    const aRes = await client.query(`
      DELETE FROM table_columns
      WHERE column_name IN ('task_ref','ticket_ref')
        AND table_id IN (
          SELECT id FROM universal_tables WHERE name LIKE 'doc\\_%' ESCAPE '\\'
        )
    `);
    console.log(`[a] dropped ${aRes.rowCount} task_ref/ticket_ref column rows`);

    // b) Strip task_ref / ticket_ref keys from JSONB row data
    const bRes = await client.query(`
      UPDATE table_rows
      SET data = data - 'task_ref' - 'ticket_ref'
      WHERE table_id IN (
          SELECT id FROM universal_tables WHERE name LIKE 'doc\\_%' ESCAPE '\\'
        )
        AND (data ? 'task_ref' OR data ? 'ticket_ref')
    `);
    console.log(`[b] stripped task_ref/ticket_ref keys from ${bRes.rowCount} JSONB rows`);

    // c) content_${lang} → cellFormat.mode = 'markdown' if not already.
    //   `jsonb_set` does NOT create intermediate objects (path '{cellFormat,mode}'
    //   no-ops when cellFormat is absent), so we ensure cellFormat exists first
    //   via jsonb_set with the object path, then set mode in a second jsonb_set.
    //   Stored as text in a `text` column → wrap in `::text`.
    const cRes = await client.query(`
      UPDATE table_columns
      SET config = jsonb_set(
        jsonb_set(
          COALESCE(config::jsonb, '{}'::jsonb),
          '{cellFormat}',
          COALESCE(config::jsonb->'cellFormat', '{}'::jsonb),
          true
        ),
        '{cellFormat,mode}', '"markdown"'::jsonb, true
      )::text
      WHERE column_name LIKE 'content\\_%' ESCAPE '\\'
        AND table_id IN (
          SELECT id FROM universal_tables WHERE name LIKE 'doc\\_%' ESCAPE '\\'
        )
        AND (config::jsonb->'cellFormat'->>'mode') IS DISTINCT FROM 'markdown'
    `);
    console.log(`[c] set cellFormat.mode='markdown' on ${cRes.rowCount} content_* columns`);

    // d) order → integer:true. Top-level key, no nesting issue. `::text` to fit
    //   the text column.
    const dRes = await client.query(`
      UPDATE table_columns
      SET config = jsonb_set(
        COALESCE(config::jsonb, '{}'::jsonb),
        '{integer}', 'true'::jsonb, true
      )::text
      WHERE column_name = 'order'
        AND table_id IN (
          SELECT id FROM universal_tables WHERE name LIKE 'doc\\_%' ESCAPE '\\'
        )
        AND (config::jsonb->>'integer') IS DISTINCT FROM 'true'
    `);
    console.log(`[d] set config.integer=true on ${dRes.rowCount} order columns`);

    // e) Drop 'ticket' from level enum options. Cast to text to fit text column.
    const eRes = await client.query(`
      UPDATE table_columns
      SET config = jsonb_set(
        config::jsonb, '{options}',
        COALESCE(
          (SELECT jsonb_agg(opt) FROM jsonb_array_elements_text(config::jsonb->'options') opt WHERE opt <> 'ticket'),
          '[]'::jsonb
        )
      )::text
      WHERE column_name = 'level'
        AND table_id IN (
          SELECT id FROM universal_tables WHERE name LIKE 'doc\\_%' ESCAPE '\\'
        )
        AND config::jsonb->'options' ? 'ticket'
    `);
    console.log(`[e] removed 'ticket' from ${eRes.rowCount} level enum configs`);

    await client.query('COMMIT');
    console.log('\n[migration] COMMIT — summary:');
    console.log(`  a) task_ref/ticket_ref columns dropped:   ${aRes.rowCount}`);
    console.log(`  b) JSONB rows stripped of those keys:     ${bRes.rowCount}`);
    console.log(`  c) content_* columns → markdown:          ${cRes.rowCount}`);
    console.log(`  d) order columns → integer:true:          ${dRes.rowCount}`);
    console.log(`  e) level enums → 'ticket' removed:        ${eRes.rowCount}`);
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
