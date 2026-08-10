#!/usr/bin/env node
/**
 * ADR-0003 widget-embed Phase 1, frontend-backend meta-schema sync.
 *
 * Brings every existing per-document content table (`universal_tables` row
 * with `table_type = 'document_content'`) in line with the new
 * DOCUMENT_TABLE_COLUMNS template in
 * `backend/routes/v3/documents/_helpers.js`:
 *
 *   1. `level` select column — config.options extended with
 *      ['atom', 'ticket', 'image', 'page_break', 'widget'] (was h1/h2/h3/text/divider
 *      only in the template; UI was already emitting the extras for a while, so
 *      existing rows may carry values the DB config didn't list — this realigns).
 *   2. `widget_ref` relation column — added if missing, targets `widgets` table
 *      (target_table_id stored as the string 'widgets' — the existing relation
 *      UI resolves named targets for system tables; otherwise null).
 *   3. `settings_override` text column — added if missing (stores JSON blob
 *      of preset-local overrides for an embedded widget).
 *
 * Idempotent: re-running finds existing columns / options and makes zero
 * writes.
 *
 * Usage:
 *   node scripts/migrate-doc-tables-widget-level.js            # dry-run
 *   node scripts/migrate-doc-tables-widget-level.js --apply
 */

import pg from 'pg';
const { Pool } = pg;

const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
});

const TARGET_LEVEL_OPTIONS = [
  'h1', 'h2', 'h3', 'text', 'atom', 'ticket', 'image', 'divider', 'page_break', 'widget',
];

function log(...a) { console.log('[migrate-doc-tables-widget-level]', ...a); }

async function main() {
  const docTables = (await pool.query(
    `SELECT id, name, project_id FROM universal_tables
      WHERE table_type = 'document_content' ORDER BY id`
  )).rows;

  log(`found ${docTables.length} document_content tables`);

  let levelAligned = 0, widgetRefAdded = 0, settingsAdded = 0, untouched = 0;

  for (const dt of docTables) {
    const cols = (await pool.query(
      `SELECT id, column_name, type, config, order_index
         FROM table_columns WHERE table_id = $1 ORDER BY order_index, id`,
      [dt.id]
    )).rows;

    let touchedThisTable = false;

    // 1) level — extend select options
    const levelCol = cols.find(c => c.column_name === 'level');
    if (levelCol) {
      const cfg = typeof levelCol.config === 'string'
        ? (levelCol.config ? JSON.parse(levelCol.config) : {})
        : (levelCol.config || {});
      const existingOpts = Array.isArray(cfg.options) ? cfg.options : [];
      const merged = Array.from(new Set([...existingOpts, ...TARGET_LEVEL_OPTIONS]));
      if (merged.length !== existingOpts.length) {
        const newCfg = { ...cfg, options: merged };
        log(`  table ${dt.id} (${dt.name}): level options ${existingOpts.join(',')} → ${merged.join(',')}`);
        if (APPLY) {
          await pool.query(
            `UPDATE table_columns SET config = $1 WHERE id = $2`,
            [JSON.stringify(newCfg), levelCol.id]
          );
        }
        levelAligned++;
        touchedThisTable = true;
      }
    } else {
      log(`  table ${dt.id} (${dt.name}): WARN no 'level' column — skipping`);
    }

    // 2) widget_ref — relation
    if (!cols.find(c => c.column_name === 'widget_ref')) {
      const nextOrder = (cols.reduce((m, c) => Math.max(m, c.order_index || 0), 0)) + 1;
      log(`  table ${dt.id} (${dt.name}): add widget_ref (relation) order=${nextOrder}`);
      if (APPLY) {
        await pool.query(
          `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
           VALUES ($1, 'widget_ref', 'Widget Ref', 'relation', $2, 1, $3)`,
          [dt.id, nextOrder, JSON.stringify({ relation_table: null, description: 'ADR-0003: embedded widget (widgets.id)' })]
        );
      }
      widgetRefAdded++;
      touchedThisTable = true;
    }

    // 3) settings_override — text (JSON blob)
    if (!cols.find(c => c.column_name === 'settings_override')) {
      const nextOrder = (cols.reduce((m, c) => Math.max(m, c.order_index || 0), 0)) + 2;
      log(`  table ${dt.id} (${dt.name}): add settings_override (text) order=${nextOrder}`);
      if (APPLY) {
        await pool.query(
          `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
           VALUES ($1, 'settings_override', 'Settings Override', 'text', $2, 0, $3)`,
          [dt.id, nextOrder, JSON.stringify({ hidden_in_view: true, description: 'ADR-0003: JSON overrides for embedded widget' })]
        );
      }
      settingsAdded++;
      touchedThisTable = true;
    }

    if (!touchedThisTable) untouched++;
  }

  log('---');
  log(`tables total        : ${docTables.length}`);
  log(`level extended      : ${levelAligned}`);
  log(`widget_ref added    : ${widgetRefAdded}`);
  log(`settings_override+  : ${settingsAdded}`);
  log(`already up to date  : ${untouched}  ${APPLY ? '' : '(DRY RUN — use --apply to execute)'}`);

  await pool.end();
}

main().catch(err => {
  console.error('[migrate-doc-tables-widget-level] FATAL:', err);
  process.exit(1);
});
