#!/usr/bin/env node
// Migration 2026-04-29: ADR-0012 Phase 8.1+8.2+8.3 (template virtualization
// prep — non-destructive).
//
// STEP A — Backfill empty widget templates.
//          For every distinct widgets.preset_name observed in doc-owned
//          rows (owner_kind='document'), insert one template row:
//            (is_template=true, preset_name=<X>, config='{}', owner_kind='space',
//             owner_id=1, dashboard_id=NULL, title='Template: <X>')
//          Idempotent via partial unique index widgets_template_preset_unique_idx
//          (defined by knex 047_widgets_is_template.js) — re-runs are no-ops.
//
// STEP B — Normalize outlier widget_ref columns to type='relation'.
//          Architect found 2 outliers on PROD (1 text, 1 number); on
//          godcrm_test only 1 (number, table 3574 "Document Atoms").
//          Whatever is non-relation gets retyped + config patched to point
//          at widgets.id (target_table_id = NULL, resolved at render time
//          via owner_kind='space' → space-local Widgets stub).
//
// STEP C — Seed `Widgets` registry stub in every System Data project
//          (one universal_tables row per system_data project, is_system=1,
//          sync_target='widgets'). Idempotent via NOT EXISTS check.
//
// Usage:
//   POSTGRES_DB=godcrm_test  POSTGRES_PASSWORD=... node scripts/migrations/20260429_widget_templates_phase8.js
//   POSTGRES_DB=godcrm_prod  POSTGRES_PASSWORD=... node scripts/migrations/20260429_widget_templates_phase8.js
//
// Re-running prints all-zero deltas (templates: 0, outliers: 0, stubs: 0).

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
  console.log(`[migration] connected to ${DB}@${HOST}:${PORT}`);

  await client.query('BEGIN');
  try {
    // STEP A — backfill 8 empty templates (one per distinct doc-owned preset_name)
    const presets = await client.query(`
      SELECT DISTINCT preset_name
      FROM widgets
      WHERE owner_kind = 'document'
        AND preset_name IS NOT NULL
        AND preset_name != ''
      ORDER BY preset_name
    `);

    let templatesInserted = 0;
    for (const { preset_name } of presets.rows) {
      const exists = await client.query(`
        SELECT 1 FROM widgets WHERE is_template = true AND preset_name = $1 LIMIT 1
      `, [preset_name]);
      if (exists.rowCount > 0) continue;

      await client.query(`
        INSERT INTO widgets
          (widget_type, preset_name, title, config, position,
           owner_kind, owner_id, is_template, dashboard_id)
        VALUES
          ('preset', $1, $2, '{}', '{"x":0,"y":0,"w":6,"h":4}',
           'space', 1, true, NULL)
      `, [preset_name, `Template: ${preset_name}`]);
      templatesInserted += 1;
    }
    console.log(`[STEP A] templates inserted: ${templatesInserted} (of ${presets.rows.length} distinct presets)`);

    // STEP B — normalize outlier widget_ref columns to type='relation'
    const outliers = await client.query(`
      SELECT id, table_id, type, config
      FROM table_columns
      WHERE column_name = 'widget_ref' AND type != 'relation'
    `);
    let outliersFixed = 0;
    for (const col of outliers.rows) {
      // preserve any existing config keys; force type=relation; ensure the
      // ADR-0003 description is present so future readers know the intent.
      let cfg = {};
      try { cfg = col.config ? JSON.parse(col.config) : {}; } catch { cfg = {}; }
      const merged = {
        ...cfg,
        relation_table: cfg.relation_table ?? null,
        description: cfg.description || 'ADR-0003: embedded widget (widgets.id)',
      };
      await client.query(`
        UPDATE table_columns
        SET type = 'relation', config = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [col.id, JSON.stringify(merged)]);
      outliersFixed += 1;
      console.log(`[STEP B] retyped col_id=${col.id} (table_id=${col.table_id}, was '${col.type}') → 'relation'`);
    }
    console.log(`[STEP B] outliers normalized: ${outliersFixed}`);

    // STEP C — seed Widgets registry stub in every system_data project
    const systemProjects = await client.query(`
      SELECT id FROM projects WHERE type = 'system_data' ORDER BY id
    `);

    let stubsInserted = 0;
    for (const { id: projectId } of systemProjects.rows) {
      const exists = await client.query(`
        SELECT 1 FROM universal_tables
        WHERE project_id = $1 AND name = 'Widgets'
        LIMIT 1
      `, [projectId]);
      if (exists.rowCount > 0) continue;

      await client.query(`
        INSERT INTO universal_tables
          (project_id, name, display_name, description, icon, is_system, sync_target)
        VALUES
          ($1, 'Widgets', 'Widgets', 'Widget templates (read-only)', '🧩', 1, 'widgets')
      `, [projectId]);
      stubsInserted += 1;
    }
    console.log(`[STEP C] registry stubs inserted: ${stubsInserted} (of ${systemProjects.rows.length} system_data projects)`);

    await client.query('COMMIT');
    console.log('[migration] COMMIT — done');
    console.log(`[summary] templates=+${templatesInserted}  outliers=${outliersFixed}  stubs=+${stubsInserted}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migration] ROLLBACK due to error:', err);
    throw err;
  } finally {
    await client.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
