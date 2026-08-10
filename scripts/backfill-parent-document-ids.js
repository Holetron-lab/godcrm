#!/usr/bin/env node
/**
 * Backfill `parent_document_id` on tickets in table 1708 (ADR-0012 / ADR-154).
 *
 * The doc-scoped filter in POST /api/v3/widgets/:id/resolve-tickets relies on
 * each ticket carrying a `parent_document_id` key inside `data` jsonb. Almost
 * none of the tickets created before this contract had it set, so the filter
 * returns 0 rows for every documents widget.
 *
 * Strategy (two passes per ticket; first match wins):
 *
 *   Primary  — conversation chain: NOT directly possible because conversations
 *              bind to either a ticket OR a document, not both. Skipped here;
 *              kept as a documented possibility if a future schema adds a
 *              cross-reference. This runner therefore only attempts Secondary.
 *
 *   Secondary — content-row ticket_ref: every documents-widget content table
 *              may contain rows with `data->>'ticket_ref' = <ticket.id>`. From
 *              that content table id, look up the documents_registry row whose
 *              `data->>'table_id'` matches — that row's id is the parent
 *              document id.
 *
 *   Tertiary  — project-id heuristic (not implemented; needs explicit user
 *              approval per task brief).
 *
 * Output: per-ticket resolution log + final report
 *   { totalTickets, hasParentAlready, primaryMatches, secondaryMatches,
 *     skipped, sampleSkipped }
 *
 * Usage:
 *   node scripts/backfill-parent-document-ids.js            # dry-run (default)
 *   node scripts/backfill-parent-document-ids.js --apply    # writes to DB
 *
 * Connects via env vars (POSTGRES_HOST/PORT/DB/USER/PASSWORD), same as
 * scripts/backfill-widgets-owner.js.
 */

import pg from 'pg';
const { Pool } = pg;

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

const TICKETS_TABLE_ID = 1708;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
});

const log = (...a) => console.log('[backfill-parent-document-ids]', ...a);

/**
 * Build map: contentTableId (number) -> parent document id (number).
 * Reads every documents_registry row, parses its `data` jsonb, and looks for
 * `table_id` (the canonical key — 657/661 rows on prod) or, defensively,
 * `content_table_id`.
 */
async function buildContentTableToDocMap() {
  const sql = `
    SELECT tr.id AS doc_id,
           tr.data->>'table_id'         AS content_table_id_a,
           tr.data->>'content_table_id' AS content_table_id_b
      FROM table_rows tr
      JOIN universal_tables ut ON ut.id = tr.table_id
     WHERE ut.table_type = 'documents_registry'
  `;
  const { rows } = await pool.query(sql);
  const map = new Map();
  for (const r of rows) {
    const ct = r.content_table_id_a || r.content_table_id_b;
    if (!ct) continue;
    const ctNum = Number(ct);
    if (!Number.isFinite(ctNum)) continue;
    // First writer wins; if the same content table is referenced by two
    // documents (shouldn't happen, but defensive), we log and skip.
    if (map.has(ctNum) && map.get(ctNum) !== Number(r.doc_id)) {
      log(`  WARN: content_table ${ctNum} referenced by both doc ${map.get(ctNum)} and doc ${r.doc_id}; keeping ${map.get(ctNum)}`);
      continue;
    }
    map.set(ctNum, Number(r.doc_id));
  }
  return map;
}

/**
 * Build map: ticket_id (number) -> { contentTableId, contentRowId }.
 * Scans every table_row whose `data->>'ticket_ref'` is set. The result is
 * the ticket → content-table linkage we need for Secondary resolution.
 */
async function buildTicketRefIndex() {
  const sql = `
    SELECT id   AS content_row_id,
           table_id AS content_table_id,
           data->>'ticket_ref' AS ticket_ref
      FROM table_rows
     WHERE data->>'ticket_ref' IS NOT NULL
  `;
  const { rows } = await pool.query(sql);
  const map = new Map();
  for (const r of rows) {
    const tid = Number(r.ticket_ref);
    if (!Number.isFinite(tid)) continue;
    map.set(tid, {
      contentTableId: Number(r.content_table_id),
      contentRowId: Number(r.content_row_id),
    });
  }
  return map;
}

/**
 * Update a batch of tickets in a single transaction.
 * `pairs` is [{ id, parent_document_id }, ...] (≤100 per call).
 */
async function applyBatch(client, pairs) {
  if (!pairs.length) return 0;
  await client.query('BEGIN');
  try {
    for (const p of pairs) {
      await client.query(
        `UPDATE table_rows
            SET data = jsonb_set(data, '{parent_document_id}', to_jsonb($1::int)),
                updated_at = NOW()
          WHERE id = $2 AND table_id = $3`,
        [p.parent_document_id, p.id, TICKETS_TABLE_ID]
      );
    }
    await client.query('COMMIT');
    return pairs.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  log(APPLY ? 'APPLY MODE — writing changes' : 'DRY-RUN — no UPDATE will be issued (pass --apply to write)');

  // 0. counters
  const totalsRes = await pool.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE data ? 'parent_document_id')::int AS has_parent
      FROM table_rows
     WHERE table_id = $1`,
    [TICKETS_TABLE_ID]
  );
  const totalTickets = totalsRes.rows[0].total;
  const hasParentAlready = totalsRes.rows[0].has_parent;
  log(`tickets in table ${TICKETS_TABLE_ID}: total=${totalTickets}  with_parent_already=${hasParentAlready}  needs_backfill=${totalTickets - hasParentAlready}`);

  // 1. lookup tables
  const contentTableToDoc = await buildContentTableToDocMap();
  log(`content_table -> doc map: ${contentTableToDoc.size} entries`);
  const ticketRefIndex = await buildTicketRefIndex();
  log(`ticket_ref index: ${ticketRefIndex.size} entries (rows referencing a ticket)`);

  // 2. iterate tickets that need backfill
  const ticketsRes = await pool.query(
    `SELECT id FROM table_rows
      WHERE table_id = $1
        AND NOT (data ? 'parent_document_id')
      ORDER BY id`,
    [TICKETS_TABLE_ID]
  );
  const ticketsToProcess = ticketsRes.rows.map(r => Number(r.id));

  let primaryMatches = 0;   // reserved for future direct linkage; always 0 for now
  let secondaryMatches = 0;
  let skipped = 0;
  const sampleSkipped = [];
  const updates = []; // { id, parent_document_id }

  for (const ticketId of ticketsToProcess) {
    // Primary: not implementable from current schema (conversations bind to
    // either ticket OR doc, never both at once). Stays at 0; documented above.

    // Secondary: ticket_ref index
    const ref = ticketRefIndex.get(ticketId);
    if (ref) {
      const docId = contentTableToDoc.get(ref.contentTableId);
      if (docId != null) {
        secondaryMatches++;
        updates.push({ id: ticketId, parent_document_id: docId });
        continue;
      }
    }

    // No match
    skipped++;
    if (sampleSkipped.length < 5) sampleSkipped.push(ticketId);
  }

  // 3. apply (if --apply)
  let written = 0;
  if (APPLY && updates.length > 0) {
    const client = await pool.connect();
    try {
      const BATCH = 100;
      for (let i = 0; i < updates.length; i += BATCH) {
        const chunk = updates.slice(i, i + BATCH);
        written += await applyBatch(client, chunk);
        log(`  applied batch ${i / BATCH + 1}: ${chunk.length} rows (running total ${written})`);
      }
    } finally {
      client.release();
    }
  }

  // 4. report
  log('');
  log('=== report ===');
  log(`  totalTickets       : ${totalTickets}`);
  log(`  hasParentAlready   : ${hasParentAlready}`);
  log(`  needsBackfill      : ${ticketsToProcess.length}`);
  log(`  primaryMatches     : ${primaryMatches}   (conversation chain — not implemented)`);
  log(`  secondaryMatches   : ${secondaryMatches} (ticket_ref in content tables)`);
  log(`  skipped            : ${skipped}`);
  log(`  sampleSkipped      : [${sampleSkipped.join(', ')}]`);
  if (APPLY) {
    log(`  written            : ${written}`);
  } else {
    log('');
    log('DRY-RUN — rerun with --apply once you accept this plan.');
  }

  await pool.end();
}

main().catch(err => {
  console.error('[backfill-parent-document-ids] FATAL:', err);
  process.exit(1);
});
