#!/usr/bin/env node
// Backfill: per-project _doc_statuses + remap registry status_id rows.
// One-shot migration to fix ADR-0001 §5 refinement — every project with a
// documents_registry needs its OWN _doc_statuses (was sharing 7341).
//
// Steps:
//   1. For each documents_registry grouped by project (skip project 5103 — already correct):
//      a) ensureDocStatusesForProject(projectId) — creates the table + seed rows if missing.
//   2. Build old_id → slug map from canonical source 7341.
//   3. For each registry:
//      a) UPDATE table_columns.config.target_table_id → new per-project _doc_statuses.
//      b) UPDATE table_rows.data.status_id (7341 ids → new per-project ids via slug).
//   4. Skip orphan registries (project_id pointing to non-existent project).
//   5. Idempotent — second run sees all in place and exits with 0 changes.
//
// Usage:
//   node scripts/backfill-doc-statuses-per-project.js          # dry-run (default)
//   node scripts/backfill-doc-statuses-per-project.js --apply  # execute

import { dbAll, dbGet, dbRun, sqlNow } from '../backend/database/connection.js';
import { ensureDocStatusesForProject } from '../backend/routes/v3/documents/_helpers.js';

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log('[backfill-doc-statuses]', ...a);

const CANONICAL_STATUSES_TABLE_ID = 7341; // Architecture v2
const KEEP_PROJECT_ID = 5103;              // Architecture v2 — already correct

async function loadCanonicalSlugMap() {
  const rows = await dbAll(`SELECT id, data FROM table_rows WHERE table_id = ?`, [CANONICAL_STATUSES_TABLE_ID]);
  const idToSlug = new Map();
  for (const r of rows) {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
    if (d.slug) idToSlug.set(r.id, String(d.slug));
  }
  return idToSlug;
}

async function listRegistries() {
  return dbAll(`
    SELECT ut.id AS registry_id, ut.project_id, ut.name, p.id AS project_exists
    FROM universal_tables ut
    LEFT JOIN projects p ON p.id = ut.project_id
    WHERE ut.table_type = 'documents_registry'
    ORDER BY ut.project_id, ut.id
  `);
}

async function remapRegistry(registry, oldIdToSlug, newSlugToId) {
  const rows = await dbAll(`SELECT id, data FROM table_rows WHERE table_id = ?`, [registry.registry_id]);
  let touched = 0, orphaned = 0;
  for (const r of rows) {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
    const sid = data?.status_id;
    if (!sid) continue;
    const oldId = Number(sid);
    const slug = oldIdToSlug.get(oldId);
    if (!slug) {
      // Not a canonical id (could already be remapped or unknown) — skip but warn.
      orphaned++;
      continue;
    }
    const newId = newSlugToId[slug];
    if (!newId) {
      log(`  ! row ${r.id}: slug "${slug}" missing in new _doc_statuses — skip`);
      orphaned++;
      continue;
    }
    if (newId === oldId) continue; // already pointing at the right row (e.g. project 5103 rows)
    if (APPLY) {
      const newData = { ...data, status_id: newId };
      await dbRun(
        `UPDATE table_rows SET data = ?::jsonb, updated_at = ${sqlNow()} WHERE id = ? AND table_id = ?`,
        [JSON.stringify(newData), r.id, registry.registry_id]
      );
    }
    touched++;
  }
  return { touched, orphaned };
}

async function updateRegistryColumnConfig(registryId, newStatusesTableId) {
  const col = await dbGet(
    `SELECT id, config FROM table_columns WHERE table_id = ? AND column_name = 'status_id' LIMIT 1`,
    [registryId]
  );
  if (!col) return 0;
  const current = typeof col.config === 'string' ? JSON.parse(col.config) : (col.config || {});
  if (Number(current.target_table_id) === Number(newStatusesTableId)) return 0;
  const next = { ...current, target_table_id: newStatusesTableId, display_column: 'label' };
  if (APPLY) {
    await dbRun(
      `UPDATE table_columns SET config = ? WHERE id = ?`,
      [JSON.stringify(next), col.id]
    );
  }
  return 1;
}

async function main() {
  log(APPLY ? 'APPLY MODE — writing changes' : 'DRY-RUN — pass --apply to write');

  const oldIdToSlug = await loadCanonicalSlugMap();
  log(`canonical slug map from table ${CANONICAL_STATUSES_TABLE_ID}: ${oldIdToSlug.size} entries`);
  for (const [id, slug] of oldIdToSlug) log(`  ${id} → ${slug}`);

  const registries = await listRegistries();
  log(`\nfound ${registries.length} documents_registry tables\n`);

  const summary = [];
  const projectCache = new Map(); // project_id → { tableId, rowIds }

  for (const reg of registries) {
    const header = `registry ${reg.registry_id} (project ${reg.project_id})`;

    if (!reg.project_exists) {
      log(`→ ${header} [ORPHAN] — project ${reg.project_id} missing, skip`);
      summary.push({ registry_id: reg.registry_id, project_id: reg.project_id, action: 'orphan-skip' });
      continue;
    }
    if (reg.project_id === KEEP_PROJECT_ID) {
      log(`→ ${header} [KEEP] — project ${KEEP_PROJECT_ID} already uses canonical 7341, skip`);
      summary.push({ registry_id: reg.registry_id, project_id: reg.project_id, action: 'keep' });
      continue;
    }

    let perProject = projectCache.get(reg.project_id);
    if (!perProject) {
      if (APPLY) {
        perProject = await ensureDocStatusesForProject(reg.project_id, null);
      } else {
        // Dry-run: check if already exists
        const existing = await dbGet(
          `SELECT id FROM universal_tables WHERE project_id = ? AND name = '_doc_statuses' LIMIT 1`,
          [reg.project_id]
        );
        if (existing) {
          const rows = await dbAll(`SELECT id, data FROM table_rows WHERE table_id = ?`, [existing.id]);
          const rowIds = {};
          for (const r of rows) {
            const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
            if (d.slug) rowIds[d.slug] = r.id;
          }
          perProject = { tableId: existing.id, rowIds };
        } else {
          perProject = { tableId: `<would-create-for-${reg.project_id}>`, rowIds: Object.fromEntries(Array.from(oldIdToSlug.values()).map(slug => [slug, `<new-row-${slug}>`])) };
        }
      }
      projectCache.set(reg.project_id, perProject);
      log(`→ project ${reg.project_id}: _doc_statuses table ${perProject.tableId} (${Object.keys(perProject.rowIds).length} slugs ready)`);
    }

    let configChanged = 0;
    let rowsChanged = 0;
    let orphans = 0;

    // Update column config (only if target_table_id changed)
    if (typeof perProject.tableId === 'number') {
      configChanged = await updateRegistryColumnConfig(reg.registry_id, perProject.tableId);
    } else {
      configChanged = 1; // dry-run placeholder
    }

    // Remap rows — only if we have real new ids (number)
    const hasRealIds = Object.values(perProject.rowIds).every(v => typeof v === 'number');
    if (hasRealIds) {
      const res = await remapRegistry(reg, oldIdToSlug, perProject.rowIds);
      rowsChanged = res.touched;
      orphans = res.orphaned;
    } else {
      // Dry-run — simulate how many rows would be touched
      const rows = await dbAll(`SELECT data FROM table_rows WHERE table_id = ?`, [reg.registry_id]);
      for (const r of rows) {
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
        if (data?.status_id && oldIdToSlug.has(Number(data.status_id))) rowsChanged++;
        else if (data?.status_id) orphans++;
      }
    }

    log(`   ${header}: config ${configChanged ? (APPLY ? 'updated' : 'would-update') : 'unchanged'}, rows ${APPLY ? 'remapped' : 'would-remap'}=${rowsChanged}, orphan-status=${orphans}`);
    summary.push({
      registry_id: reg.registry_id,
      project_id: reg.project_id,
      new_statuses_table_id: perProject.tableId,
      config_changed: configChanged,
      rows_changed: rowsChanged,
      orphan_rows: orphans
    });
  }

  log('\n=== summary ===');
  let totalProjects = projectCache.size;
  let totalRows = 0, totalConfigs = 0, totalOrphanRows = 0;
  for (const s of summary) {
    if (s.action) continue;
    totalRows += s.rows_changed || 0;
    totalConfigs += s.config_changed || 0;
    totalOrphanRows += s.orphan_rows || 0;
  }
  log(`  projects: ${totalProjects} new per-project _doc_statuses ${APPLY ? 'created' : 'would create'}`);
  log(`  configs : ${totalConfigs} status_id column(s) ${APPLY ? 'updated' : 'would update'}`);
  log(`  rows    : ${totalRows} registry row(s) status_id ${APPLY ? 'remapped' : 'would remap'}`);
  log(`  orphans : ${totalOrphanRows} status_id value(s) don't match any canonical row (skipped)`);
  for (const s of summary.filter(x => x.action === 'orphan-skip')) log(`  orphan-registry: ${s.registry_id} (project ${s.project_id})`);
  for (const s of summary.filter(x => x.action === 'keep')) log(`  kept-as-is: registry ${s.registry_id} (project ${s.project_id})`);

  if (!APPLY) log('\nDRY-RUN complete — rerun with --apply to execute.');
  else log('\nLIVE RUN complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error('[backfill-doc-statuses] FAILED:', e);
  process.exit(1);
});
