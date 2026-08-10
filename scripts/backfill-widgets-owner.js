#!/usr/bin/env node
/**
 * Step 2/3 of the widget-owner refactor (ADR-0003 widget-embed Phase 1).
 *
 * For every row in `widgets` where `owner_kind IS NULL` or `owner_id IS NULL`,
 * populate them from the legacy `dashboard_id` column:
 *   owner_kind = 'dashboard'
 *   owner_id   = dashboard_id
 *
 * Idempotent: re-running on an already-backfilled table updates 0 rows.
 *
 * Rows with dashboard_id IS NULL (orphaned modules — see WidgetService.deleteWidget)
 * are reported and left alone; those need manual triage before step 3 can enforce
 * NOT NULL on owner_kind/owner_id.
 *
 * Usage:
 *   node scripts/backfill-widgets-owner.js [--dry-run]
 */

import pg from 'pg';
const { Pool } = pg;

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
});

async function main() {
  const totalRow = await pool.query(`SELECT COUNT(*)::int AS n FROM widgets`);
  const alreadyRow = await pool.query(
    `SELECT COUNT(*)::int AS n FROM widgets WHERE owner_kind IS NOT NULL AND owner_id IS NOT NULL`
  );
  const needRow = await pool.query(
    `SELECT COUNT(*)::int AS n FROM widgets
       WHERE (owner_kind IS NULL OR owner_id IS NULL) AND dashboard_id IS NOT NULL`
  );
  const orphanRow = await pool.query(
    `SELECT id, preset_name, title FROM widgets
       WHERE (owner_kind IS NULL OR owner_id IS NULL) AND dashboard_id IS NULL
       ORDER BY id`
  );

  const total = totalRow.rows[0].n;
  const already = alreadyRow.rows[0].n;
  const need = needRow.rows[0].n;
  const orphans = orphanRow.rows;

  console.log(`[backfill-widgets-owner] total=${total}  already_backfilled=${already}  needs_backfill=${need}  orphans(dashboard_id NULL)=${orphans.length}`);

  if (orphans.length > 0) {
    console.log('[backfill-widgets-owner] orphans (no dashboard_id, need manual triage before step 3):');
    for (const o of orphans) {
      console.log(`   id=${o.id}  preset=${o.preset_name || '-'}  title=${o.title || '-'}`);
    }
  }

  if (need === 0) {
    console.log('[backfill-widgets-owner] nothing to do');
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    console.log(`[backfill-widgets-owner] DRY RUN — would update ${need} rows`);
    await pool.end();
    return;
  }

  const res = await pool.query(
    `UPDATE widgets
        SET owner_kind = 'dashboard',
            owner_id   = dashboard_id
      WHERE (owner_kind IS NULL OR owner_id IS NULL)
        AND dashboard_id IS NOT NULL`
  );
  console.log(`[backfill-widgets-owner] updated ${res.rowCount} rows`);

  await pool.end();
}

main().catch(err => {
  console.error('[backfill-widgets-owner] FATAL:', err);
  process.exit(1);
});
