#!/usr/bin/env node
// ADR-0020 Phase 1 §гайка-2 — create missing companion tables for ADR-0017/0018/0019.
//
// Background: registry rows 134519/134725/135069 in table 2197 (widget 218 = ADRs)
// were created without a per-doc companion table — `data.table_id` is absent.
// Without a companion, the bdd-list / atom widgets inside those docs cannot
// render. Other recently-created ADRs (0010/0012/0020/0021) all have companions
// in project 138 (Architecture & ADR), space 11.
//
// What this script does (idempotent):
//   1. For each (regRowId, slug) target, check if a companion table named
//      `doc_<slug>_<regRowId>` already exists.
//   2. If not: INSERT into universal_tables (project 138, table_type=
//      'document_content'), then provision DOCUMENT_TABLE_COLUMNS via the
//      canonical helper.
//   3. Patch the registry row: merge `table_id: <newId>` into data.
//
// Usage:
//   node scripts/adr-0020-create-missing-companions.mjs --dry-run   (default)
//   node scripts/adr-0020-create-missing-companions.mjs --apply

import { dbAll, dbGet, dbRun } from '../backend/database/connection.js';
import {
  DOCUMENT_TABLE_COLUMNS,
  createTableColumns,
} from '../backend/routes/v3/documents/_helpers.js';
import { generateBaseId } from '../backend/utils/baseId.js';

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

const PROJECT_ID = 138; // Architecture & ADR (space 11)
const REGISTRY_TABLE_ID = 2197;

const TARGETS = [
  { regRowId: 134519, slug: 'adr-0017-json-column-viewer-editor', display: 'ADR-0017 — JSON Column: Viewer, Editor & Templates' },
  { regRowId: 134725, slug: 'adr-0018-godcrm-watch-app-garmin-bridge', display: 'ADR-0018 — Godcrm Watch App: Garmin Connect IQ ↔ Flutter Bridge' },
  { regRowId: 135069, slug: 'adr-0019-background-jobs-framework', display: 'ADR-0019 — Background Jobs Framework (admin space 1)' },
];

const log = (...a) => console.log('[adr-0020-companions]', ...a);

async function main() {
  log(DRY ? 'DRY-RUN (no writes)' : 'APPLY MODE — will write to DB');

  for (const t of TARGETS) {
    const tableName = `doc_${t.slug}_${t.regRowId}`;
    log('---');
    log(`target: row ${t.regRowId} → ${tableName}`);

    const existingTable = await dbGet(
      `SELECT id, project_id FROM universal_tables WHERE name = $1 LIMIT 1`,
      [tableName]
    );

    const reg = await dbGet(
      `SELECT id, data FROM table_rows WHERE id = $1 AND table_id = $2`,
      [t.regRowId, REGISTRY_TABLE_ID]
    );
    if (!reg) {
      log(`  ✗ registry row ${t.regRowId} NOT FOUND in table ${REGISTRY_TABLE_ID} — skipping`);
      continue;
    }
    const regData = typeof reg.data === 'string' ? JSON.parse(reg.data) : reg.data;
    const currentTableId = regData?.table_id ?? null;

    if (existingTable) {
      log(`  ⊙ companion already exists: id=${existingTable.id}, project=${existingTable.project_id}`);
      if (currentTableId !== existingTable.id) {
        log(`  ⚠ registry table_id (${currentTableId}) != existing table id (${existingTable.id}) — would patch`);
        if (APPLY) {
          const patched = { ...regData, table_id: existingTable.id };
          await dbRun(
            `UPDATE table_rows SET data = $1, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(patched), t.regRowId]
          );
          log(`  ✓ patched registry row ${t.regRowId} with table_id=${existingTable.id}`);
        }
      } else {
        log(`  ✓ registry already bound to ${currentTableId}`);
      }
      continue;
    }

    if (currentTableId) {
      log(`  ⚠ registry has table_id=${currentTableId} but no table by name ${tableName} exists — possible drift, skipping (manual review needed)`);
      continue;
    }

    log(`  → would create table "${tableName}" in project ${PROJECT_ID}`);
    log(`  → would provision ${DOCUMENT_TABLE_COLUMNS.length} canonical columns`);
    log(`  → would patch registry row ${t.regRowId} data.table_id`);

    if (!APPLY) continue;

    const baseId = generateBaseId();
    const insertRes = await dbRun(
      `INSERT INTO universal_tables (project_id, name, display_name, table_type, base_id, created_by)
       VALUES ($1, $2, $3, 'document_content', $4, NULL)
       RETURNING id`,
      [PROJECT_ID, tableName, t.display, baseId]
    );
    const newTableId = insertRes.lastInsertRowid ?? insertRes.rows?.[0]?.id ?? insertRes.id;
    if (!newTableId) {
      log(`  ✗ failed to determine new table id from insert result:`, insertRes);
      continue;
    }
    log(`  ✓ created universal_tables.id=${newTableId} (base_id=${baseId})`);

    await createTableColumns(newTableId, DOCUMENT_TABLE_COLUMNS);
    log(`  ✓ provisioned ${DOCUMENT_TABLE_COLUMNS.length} columns`);

    const patched = { ...regData, table_id: newTableId };
    await dbRun(
      `UPDATE table_rows SET data = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(patched), t.regRowId]
    );
    log(`  ✓ patched registry row ${t.regRowId} with table_id=${newTableId}`);
  }

  log('---');
  log('done');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[adr-0020-companions] FATAL', err);
  process.exit(1);
});
