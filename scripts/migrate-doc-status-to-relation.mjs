#!/usr/bin/env node
// Migrate all documents_registry tables from legacy `status` (select text)
// to canonical `status_id` (relation → _doc_statuses). Idempotent.
//
// For each documents_registry table:
//   1. Ensure `status_id` relation column exists (→ _doc_statuses.id)
//   2. Ensure `verified` checkbox column exists (Gate A plan approval)
//   3. Backfill data->>'status_id' from data->>'status' slug on every row
//      that is missing a status_id value.
//
// Safe to re-run: columns are only added if missing; backfill only
// populates rows whose status_id is NULL/missing.
//
// Usage: node scripts/migrate-doc-status-to-relation.mjs [--dry-run]

import { dbAll, dbGet, dbRun, sqlNow } from '../backend/database/connection.js';

const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log('[migrate-status]', ...a);

async function findStatusesTable() {
  const row = await dbGet(`SELECT id FROM universal_tables WHERE name = '_doc_statuses' LIMIT 1`);
  if (!row) throw new Error('_doc_statuses table not found — create it first');
  return row.id;
}

async function loadStatusMap(statusesTableId) {
  const rows = await dbAll(`SELECT id, data FROM table_rows WHERE table_id = ?`, [statusesTableId]);
  const slugToId = new Map();
  for (const r of rows) {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
    if (d.slug) slugToId.set(String(d.slug), r.id);
  }
  return slugToId;
}

async function ensureColumn(tableId, spec) {
  const existing = await dbGet(
    `SELECT id FROM table_columns WHERE table_id = ? AND column_name = ? LIMIT 1`,
    [tableId, spec.column_name]
  );
  if (existing) {
    log(`  ✓ column ${spec.column_name} already on ${tableId}`);
    return false;
  }
  if (DRY) {
    log(`  [dry] would add column ${spec.column_name} to ${tableId}`);
    return true;
  }
  await dbRun(
    `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [tableId, spec.column_name, spec.display_name, spec.type, spec.order_index, spec.config ? JSON.stringify(spec.config) : null]
  );
  log(`  + added column ${spec.column_name} (${spec.type}) to ${tableId}`);
  return true;
}

async function backfillRows(tableId, slugToId) {
  const rows = await dbAll(`SELECT id, data FROM table_rows WHERE table_id = ?`, [tableId]);
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
    const currentSlug = data.status || null;
    const currentSid = data.status_id || null;
    if (currentSid) { skipped++; continue; }
    if (!currentSlug) { skipped++; continue; }
    const sid = slugToId.get(String(currentSlug));
    if (!sid) {
      log(`  ! row ${r.id}: slug "${currentSlug}" has no match in _doc_statuses`);
      skipped++;
      continue;
    }
    if (DRY) {
      log(`  [dry] row ${r.id}: status "${currentSlug}" → status_id ${sid}`);
    } else {
      const newData = { ...data, status_id: sid };
      await dbRun(
        `UPDATE table_rows SET data = ?::jsonb, updated_at = ${sqlNow()} WHERE id = ? AND table_id = ?`,
        [JSON.stringify(newData), r.id, tableId]
      );
    }
    updated++;
  }
  log(`  backfill: ${updated} updated, ${skipped} skipped`);
  return { updated, skipped };
}

async function main() {
  log(DRY ? 'DRY RUN' : 'LIVE RUN');
  const statusesTableId = await findStatusesTable();
  log(`_doc_statuses table_id = ${statusesTableId}`);
  const slugToId = await loadStatusMap(statusesTableId);
  log(`status slug → id map:`, Object.fromEntries(slugToId));

  const registries = await dbAll(
    `SELECT id, name, project_id FROM universal_tables WHERE table_type = 'documents_registry' ORDER BY id`
  );
  log(`found ${registries.length} documents_registry tables`);

  const summary = [];
  for (const reg of registries) {
    log(`\n→ registry ${reg.id} (project ${reg.project_id}, name=${reg.name})`);
    await ensureColumn(reg.id, {
      column_name: 'status_id',
      display_name: 'Status',
      type: 'relation',
      order_index: 9,
      config: { target_table_id: statusesTableId, display_column: 'label', icon: '🏷️' }
    });
    await ensureColumn(reg.id, {
      column_name: 'verified',
      display_name: 'Verified (Plan)',
      type: 'checkbox',
      order_index: 10,
      config: {}
    });
    const { updated, skipped } = await backfillRows(reg.id, slugToId);
    summary.push({ table_id: reg.id, updated, skipped });
  }

  log('\n=== summary ===');
  for (const s of summary) log(`  t${s.table_id}: updated=${s.updated} skipped=${s.skipped}`);
  log(DRY ? '\nDRY RUN complete — no changes written.' : '\nmigration complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[migrate-status] FAILED:', e);
  process.exit(1);
});
