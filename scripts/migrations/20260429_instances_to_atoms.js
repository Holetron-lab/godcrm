#!/usr/bin/env node
// Migration 2026-04-29: ADR-0012 Phase 8.4 — collapse instance widgets into atom rows.
//
// Situation today:
//   - 33 widgets rows with owner_kind='document' carry per-doc config (filter.ids etc.).
//   - 23 of them are referenced by an atom row (data->>'widget_ref' matches widget.id,
//     data->>'level' = 'widget') in the doc's companion atom table.
//   - 10 of them are orphaned (no atom references them — leftovers from earlier
//     prototyping; verified via single SQL across all table_rows).
//
// Target shape (ADR-0012 Phase 8 + ADR-0017 §5b):
//   - effective_config = deepMerge(template.config, atom.settings_override)
//   - templates live in `widgets` with is_template=true (created by Phase 8.1, ids 4123..4130).
//
// What this migration does:
//   For each BOUND row → set atom.widget_ref = template_id (matched by preset_name),
//                        set atom.settings_override = deepMerge(widget.config, current_override),
//                        DELETE the instance widget row.
//   For each ORPHAN row → DELETE the instance widget row (no atom to update).
//
// Merge policy: widget.config is the base layer, atom.settings_override layers on top.
// This is the same precedence the renderer applies today, so visible output stays identical.
// Arrays replace wholesale (Helm semantics).
//
// Idempotent: a second run finds 0 widgets where owner_kind='document' AND is_template=false.
//
// Usage:
//   # dry-run (default — no writes, prints plan + per-row diff)
//   POSTGRES_DB=godcrm_prod POSTGRES_PASSWORD=... node scripts/migrations/20260429_instances_to_atoms.js
//
//   # apply (transactional — rolls back on first error)
//   POSTGRES_DB=godcrm_prod POSTGRES_PASSWORD=... node scripts/migrations/20260429_instances_to_atoms.js --apply

import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const HOST = process.env.POSTGRES_HOST || 'localhost';
const PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10);
const DB   = process.env.POSTGRES_DB   || 'godcrm';
const USER = process.env.POSTGRES_USER || 'godcrm';
const PASS = process.env.POSTGRES_PASSWORD;

const APPLY = process.argv.includes('--apply');

if (!PASS) {
  console.error('[migration] POSTGRES_PASSWORD not set');
  process.exit(1);
}

function deepMerge(base, over) {
  if (over === null || over === undefined) return base;
  if (base === null || base === undefined) return over;
  if (typeof base !== 'object' || typeof over !== 'object') return over;
  if (Array.isArray(base) || Array.isArray(over)) return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
  return out;
}

function safeParse(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

async function main() {
  const client = new Client({ host: HOST, port: PORT, database: DB, user: USER, password: PASS });
  await client.connect();
  console.log(`[migration] connected to ${DB}@${HOST}:${PORT} — mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  await client.query('BEGIN');
  try {
    const templates = await client.query(`
      SELECT id, preset_name FROM widgets WHERE is_template = true
    `);
    const tplByPreset = new Map(templates.rows.map(r => [r.preset_name, r.id]));
    console.log(`[migration] templates loaded: ${templates.rows.length} (${[...tplByPreset.keys()].sort().join(', ')})`);

    const instances = await client.query(`
      SELECT id, preset_name, owner_id, config
      FROM widgets
      WHERE owner_kind = 'document' AND COALESCE(is_template, false) = false
      ORDER BY preset_name, id
    `);
    console.log(`[migration] instance widgets: ${instances.rows.length}`);

    const summary = { bound: [], orphan: [], errors: [] };

    for (const w of instances.rows) {
      const wid = w.id;
      const preset = w.preset_name;
      const tplId = tplByPreset.get(preset);
      if (!tplId) {
        summary.errors.push(`widget ${wid}: no template for preset "${preset}"`);
        continue;
      }

      // Find the atom that references this widget. data->>'widget_ref' is text,
      // data->'widget_ref' is a JSON number; match either form.
      const atomRes = await client.query(`
        SELECT id, table_id, data
        FROM table_rows
        WHERE data->>'widget_ref' = $1 AND data->>'level' = 'widget'
        LIMIT 2
      `, [String(wid)]);

      if (atomRes.rows.length === 0) {
        summary.orphan.push({ widget_id: wid, preset, owner_id: w.owner_id });
        continue;
      }
      if (atomRes.rows.length > 1) {
        summary.errors.push(`widget ${wid}: ${atomRes.rows.length} atoms reference it (expected 1)`);
        continue;
      }

      const atom = atomRes.rows[0];
      const widgetCfg = safeParse(w.config) || {};
      const curOverride = safeParse(atom.data.settings_override) || {};
      const newOverride = deepMerge(widgetCfg, curOverride);

      summary.bound.push({
        widget_id: wid,
        preset,
        template_id: tplId,
        atom_id: atom.id,
        atom_table: atom.table_id,
        widget_config: widgetCfg,
        prev_override: curOverride,
        new_override: newOverride,
      });

      if (APPLY) {
        // Set atom.widget_ref = template_id, atom.settings_override = newOverride.
        await client.query(`
          UPDATE table_rows
          SET data = jsonb_set(
                       jsonb_set(COALESCE(data, '{}'::jsonb), '{widget_ref}', to_jsonb($1::int)),
                       '{settings_override}', $2::jsonb
                     ),
              updated_at = NOW()
          WHERE id = $3
        `, [tplId, JSON.stringify(newOverride), atom.id]);
      }
    }

    if (APPLY) {
      // Delete all 33 instance widgets in one shot (both bound and orphaned).
      const del = await client.query(`
        DELETE FROM widgets
        WHERE owner_kind = 'document' AND COALESCE(is_template, false) = false
      `);
      console.log(`[migration] deleted instance widgets: ${del.rowCount}`);
    }

    // Report
    console.log(`\n=== SUMMARY ===`);
    console.log(`bound (atom rewires + widget delete): ${summary.bound.length}`);
    console.log(`orphan (widget delete only):          ${summary.orphan.length}`);
    console.log(`errors:                                ${summary.errors.length}`);

    if (summary.errors.length) {
      console.log(`\n--- ERRORS ---`);
      summary.errors.forEach(e => console.log(`  ${e}`));
      throw new Error('errors detected — rolling back');
    }

    console.log(`\n--- BOUND ---`);
    for (const b of summary.bound) {
      console.log(`  widget ${b.widget_id} (${b.preset}) → tpl ${b.template_id}; atom ${b.atom_id}@t${b.atom_table}`);
      console.log(`    new_override: ${JSON.stringify(b.new_override)}`);
    }
    console.log(`\n--- ORPHAN ---`);
    for (const o of summary.orphan) {
      console.log(`  widget ${o.widget_id} (${o.preset}) — owner_id=${o.owner_id}, no atom refs`);
    }

    if (APPLY) {
      await client.query('COMMIT');
      console.log(`\n[migration] COMMIT — ${summary.bound.length} atom rewires, ${summary.bound.length + summary.orphan.length} widget rows deleted`);
    } else {
      await client.query('ROLLBACK');
      console.log(`\n[migration] DRY-RUN ROLLBACK — re-run with --apply to commit`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[migration] ROLLBACK on error:`, err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('[migration] fatal:', err);
  process.exit(1);
});
