#!/usr/bin/env node
/**
 * One-shot: backfill empty bdd_specs rows for every document in
 * `bdd_enabled` widget registries (currently widget 218 → registry 2197).
 *
 * For each registry row that does not yet have a matching spec
 * (table_rows.table_id=7255 with data->>'source_doc_id' = registry_row.id),
 * insert a draft spec row carrying source_doc_id, code (= registry name),
 * owner_user_id (= registry created_by), status=draft.
 *
 * Idempotent: NOT EXISTS guard ensures re-running creates 0 rows.
 *
 * Usage:
 *   node scripts/backfill-bdd-specs-widget-218.js [--dry-run]
 */

import pg from 'pg';
const { Pool } = pg;

const DRY_RUN = process.argv.includes('--dry-run');
const SPEC_TABLE_ID = 7255;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
});

function genBaseId() {
  return 'bdd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

async function main() {
  const widgets = await pool.query(
    `SELECT id, config::jsonb AS config FROM widgets WHERE config::jsonb->>'bdd_enabled' = 'true'`
  );

  if (widgets.rows.length === 0) {
    console.log('[backfill-bdd] no bdd_enabled widgets found');
    process.exit(0);
  }

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalScanned = 0;

  for (const w of widgets.rows) {
    const cfg = w.config || {};
    const registryId = parseInt(cfg.registry_table_id || cfg.documents_table_id, 10);
    if (!registryId) {
      console.log(`[backfill-bdd] widget ${w.id}: no registry_table_id, skip`);
      continue;
    }

    const docs = await pool.query(
      `SELECT id, base_id, data, created_by FROM table_rows WHERE table_id = $1 ORDER BY id`,
      [registryId]
    );
    console.log(`[backfill-bdd] widget ${w.id} (registry ${registryId}): ${docs.rows.length} docs`);

    for (const doc of docs.rows) {
      totalScanned++;
      const data = typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || {});

      const existing = await pool.query(
        `SELECT id FROM table_rows WHERE table_id = $1 AND data->>'source_doc_id' = $2 LIMIT 1`,
        [SPEC_TABLE_ID, String(doc.id)]
      );
      if (existing.rows.length > 0) {
        totalSkipped++;
        continue;
      }

      const specData = {
        source_doc_id: doc.id,
        code: data.name || data.title || `doc_${doc.id}`,
        owner_user_id: doc.created_by || null,
        status: 'draft',
      };

      if (DRY_RUN) {
        console.log(`  [dry] would create spec for doc ${doc.id} (${specData.code})`);
        totalCreated++;
        continue;
      }

      const ins = await pool.query(
        `INSERT INTO table_rows (table_id, base_id, data, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [SPEC_TABLE_ID, genBaseId(), JSON.stringify(specData), doc.created_by || null]
      );
      totalCreated++;
      if (totalCreated % 25 === 0) {
        console.log(`  + created ${totalCreated} specs so far... (last id ${ins.rows[0].id})`);
      }
    }
  }

  console.log('---');
  console.log(`[backfill-bdd] scanned: ${totalScanned}  created: ${totalCreated}  skipped (already existed): ${totalSkipped}  ${DRY_RUN ? '(DRY RUN)' : ''}`);
  await pool.end();
}

main().catch(err => {
  console.error('[backfill-bdd] FATAL:', err);
  process.exit(1);
});
