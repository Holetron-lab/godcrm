#!/usr/bin/env node
/**
 * Fleet Audit WP-4 (Bugs 1552/228712) — one-off backfill for the `files` table.
 *
 * Two defects make fileGuard refuse files that exist on disk:
 *   1. `files.space_id IS NULL` on column-bound uploads whose column has no
 *      `visibility` config → fileGuard falls to `private` and 403s everyone,
 *      owner included (fileGuard.js "No space membership for this file").
 *      Fix: derive space_id from project_id → projects.space_id, or from
 *      table_id → universal_tables.project_id → projects.space_id.
 *   2. `files.url` stored as an absolute URL from an earlier host
 *      (`https://crm.hltrn.cc/uploads/...`, `https://devcrm.hltrn.cc/...`).
 *      fileGuard matches `WHERE url = '/uploads/...'` → no row → 404.
 *      Fix: strip the origin, keep the `/uploads/...` (or `/downloads/...`) path.
 *
 * Rows with no project/table link and no space_id (system uploads: coins,
 * favicon, moysklad-migration, …) are reported as [SKIP] and left alone —
 * there is nothing to derive from, and they are not user content.
 *
 *   $ node backend/scripts/backfill-files-space-url.js            # plan only, writes nothing
 *   $ node backend/scripts/backfill-files-space-url.js --apply    # write (a *_test database)
 *   $ node backend/scripts/backfill-files-space-url.js --apply --prod   # write to a non-test DB
 *
 * `--prod` exists because PM2 exports POSTGRES_DB=godcrm_prod into every shell
 * on .128 (ADR-0009); an `--apply` that lands on the master by accident must
 * fail closed. Idempotent: a second run plans zero changes.
 *
 * Exit codes: 0 — ok · 2 — refused to start
 */

import dotenv from 'dotenv';
dotenv.config();

import { dbAll, dbRun, destroyAdapter } from '../database/connection.js';

const ABS_UPLOAD_RE = /^https?:\/\/[^/]+(\/(?:uploads|downloads)\/.+)$/;

/** `https://crm.hltrn.cc/uploads/x.png` → `/uploads/x.png`; anything else → null (no change). */
export function normalizeUploadUrl(url) {
  const m = typeof url === 'string' ? url.match(ABS_UPLOAD_RE) : null;
  return m ? m[1] : null;
}

/**
 * Decide what to write for one candidate row.
 * @param {{id:string,url:string|null,space_id:number|null,derived_space_id:number|null}} row
 * @returns {{id:string,url?:string,space_id?:number}|null} null = nothing to do
 */
export function planRow(row) {
  const change = { id: row.id };
  const url = normalizeUploadUrl(row.url);
  if (url) change.url = url;
  if (row.space_id == null && row.derived_space_id != null) change.space_id = row.derived_space_id;
  return change.url || change.space_id ? change : null;
}

/** Candidate rows: space_id missing, or url absolute. `?` is a placeholder for the adapter, so no regex here. */
export async function loadCandidates() {
  return dbAll(`
    SELECT f.id, f.url, f.space_id,
           COALESCE(pt.space_id, pp.space_id) AS derived_space_id
      FROM files f
      LEFT JOIN projects pp ON pp.id = f.project_id
      LEFT JOIN universal_tables t ON t.id = f.table_id
      LEFT JOIN projects pt ON pt.id = t.project_id
     WHERE f.space_id IS NULL
        OR f.url LIKE 'http://%'
        OR f.url LIKE 'https://%'
     ORDER BY f.created_at, f.id
  `);
}

/** @returns {{changes:object[], skipped:object[]}} */
export function buildPlan(rows) {
  const changes = [];
  const skipped = [];
  for (const row of rows) {
    const change = planRow(row);
    if (change) changes.push(change);
    else skipped.push(row);
  }
  return { changes, skipped };
}

export async function applyPlan(changes) {
  for (const c of changes) {
    await dbRun(
      `UPDATE files
          SET url = COALESCE(?, url),
              space_id = COALESCE(?, space_id),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [c.url ?? null, c.space_id ?? null, c.id]
    );
  }
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  const PROD_OK = process.argv.includes('--prod');
  const db = process.env.POSTGRES_DB;
  console.log(`[backfill-files] db=${db} host=${process.env.POSTGRES_HOST} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  if (APPLY && !/_test$/.test(db || '') && !PROD_OK) {
    console.error(`[backfill-files] REFUSED: --apply on "${db}" needs --prod (ADR-0009: masters are written by the executor, not by accident)`);
    process.exit(2);
  }

  const rows = await loadCandidates();
  const { changes, skipped } = buildPlan(rows);

  for (const c of changes) {
    const tags = [c.url && 'URL', c.space_id && 'SPACE'].filter(Boolean).join('+');
    console.log(`[${tags}] ${c.id}${c.url ? ` url → ${c.url}` : ''}${c.space_id ? ` space_id → ${c.space_id}` : ''}`);
  }
  for (const r of skipped) console.log(`[SKIP] ${r.id} ${r.url} (no project/table link to derive space_id)`);

  const urls = changes.filter((c) => c.url).length;
  const spaces = changes.filter((c) => c.space_id).length;
  console.log(`[backfill-files] candidates=${rows.length} url=${urls} space_id=${spaces} rows=${changes.length} skip=${skipped.length}`);

  if (APPLY) {
    await applyPlan(changes);
    console.log(`[backfill-files] applied ${changes.length} rows`);
  } else {
    console.log('[backfill-files] dry-run, nothing written — re-run with --apply');
  }
  await destroyAdapter();
}

if (process.argv[1] && process.argv[1].endsWith('backfill-files-space-url.js')) {
  main().catch((err) => {
    console.error('[backfill-files] FAIL', err);
    process.exit(1);
  });
}
