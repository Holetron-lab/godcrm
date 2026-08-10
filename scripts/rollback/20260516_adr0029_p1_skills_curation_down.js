#!/usr/bin/env node
// DOWN migration for 2026-05-16 ADR-0029 Phase 1 — Skills Curation Pipeline.
//
// Restores table 3710 + 1790 to byte-equal pre-UP state by reading the
// pre-migration JSONL backups at:
//   /root/backups/adr-0029-p1-pre-2026-05-16-rows.jsonl
//   /root/backups/adr-0029-p1-pre-2026-05-16-cols.jsonl
//
// Strategy:
//   1. DELETE skill_adoptions universal_tables row + its table_columns.
//   2. DELETE skill_sources universal_tables row + its table_rows + table_columns.
//   3. DELETE all 7 new rows in 3710 (system-audit + 6 gitnexus).
//   4. Restore 1790 row 119821 from backup JSONL.
//   5. UPDATE 3 existing 3710 rows: revert data jsonb to pre-UP form (use backup).
//   6. DELETE 18 new columns from 3710 + revert status enum.
//
// All inside one transaction. Idempotent re-runs allowed.

import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import readline from 'node:readline';

const { Client } = pg;

const HOST = process.env.POSTGRES_HOST || 'localhost';
const PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10);
const DB   = process.env.POSTGRES_DB   || 'godcrm_prod';
const USER = process.env.POSTGRES_USER || 'godcrm';
const PASS = process.env.POSTGRES_PASSWORD;

if (!PASS) {
  console.error('[rollback] POSTGRES_PASSWORD not set');
  process.exit(1);
}

const SKILLS_TABLE_ID = 3710;
const TOOLS_TABLE_ID  = 1790;
const KNOWLEDGE_PIPELINE_PROJECT = 244;
const SKILLS_PROMPTS_PROJECT     = 245;

const ROWS_BACKUP = '/root/backups/adr-0029-p1-pre-2026-05-16-rows.jsonl';
const COLS_BACKUP = '/root/backups/adr-0029-p1-pre-2026-05-16-cols.jsonl';

const NEW_3710_COLUMN_NAMES = [
  'source_id','source_slug','source_url','upstream_sha256','upstream_version',
  'original_prompt','adapted','adapted_by','adapted_at','license','license_url',
  'release_gate','attribution_text','tags','requires_connectors',
  'last_imported_at','last_drift_check_at','drift_detected',
];

const NEW_3710_DATA_KEYS = [
  'source_id','source_slug','source_url','upstream_sha256','upstream_version',
  'original_prompt','adapted','adapted_by','adapted_at','license','license_url',
  'release_gate','attribution_text','tags','requires_connectors',
  'last_imported_at','last_drift_check_at','drift_detected',
];

function unescapePgCopy(line) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      const next = line[i + 1];
      if (next === '\\') { out += '\\'; i++; continue; }
      if (next === 'n')  { out += '\n'; i++; continue; }
      if (next === 't')  { out += '\t'; i++; continue; }
      if (next === 'r')  { out += '\r'; i++; continue; }
      if (next === 'b')  { out += '\b'; i++; continue; }
      if (next === 'f')  { out += '\f'; i++; continue; }
      if (next === 'v')  { out += '\v'; i++; continue; }
    }
    out += ch;
  }
  return out;
}

async function readJsonl(filePath) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    out.push(JSON.parse(unescapePgCopy(line)));
  }
  return out;
}

async function run() {
  if (!fs.existsSync(ROWS_BACKUP) || !fs.existsSync(COLS_BACKUP)) {
    console.error(`[rollback] backup files missing — refuse to run`);
    console.error(`  expected: ${ROWS_BACKUP}`);
    console.error(`  expected: ${COLS_BACKUP}`);
    process.exit(1);
  }

  const backupRows = await readJsonl(ROWS_BACKUP);
  const backupCols = await readJsonl(COLS_BACKUP);
  console.log(`[rollback] loaded ${backupRows.length} backup rows, ${backupCols.length} backup cols`);

  const client = new Client({ host: HOST, port: PORT, database: DB, user: USER, password: PASS });
  await client.connect();
  console.log(`[rollback] connected: ${USER}@${HOST}:${PORT}/${DB}`);

  await client.query('BEGIN');
  try {
    // ─── 1. skill_adoptions table teardown ────────────────────────────────
    const adoptions = await client.query(
      'SELECT id FROM universal_tables WHERE project_id=$1 AND name=$2',
      [SKILLS_PROMPTS_PROJECT, 'skill_adoptions']
    );
    if (adoptions.rowCount > 0) {
      const id = adoptions.rows[0].id;
      // Best-effort drop of optional partial index (if a DBA added it post-P1)
      try { await client.query('DROP INDEX IF EXISTS skill_adoptions_unique_idx'); } catch (_) {}
      const rowsDel = await client.query('DELETE FROM table_rows WHERE table_id=$1', [id]);
      const colsDel = await client.query('DELETE FROM table_columns WHERE table_id=$1', [id]);
      const utDel = await client.query('DELETE FROM universal_tables WHERE id=$1', [id]);
      console.log(`[1] skill_adoptions: -${rowsDel.rowCount} rows, -${colsDel.rowCount} cols, -${utDel.rowCount} table`);
    } else {
      console.log('[1] skill_adoptions: already gone');
    }

    // ─── 2. skill_sources table teardown ──────────────────────────────────
    const sources = await client.query(
      'SELECT id FROM universal_tables WHERE project_id=$1 AND name=$2',
      [KNOWLEDGE_PIPELINE_PROJECT, 'skill_sources']
    );
    if (sources.rowCount > 0) {
      const id = sources.rows[0].id;
      const rowsDel = await client.query('DELETE FROM table_rows WHERE table_id=$1', [id]);
      const colsDel = await client.query('DELETE FROM table_columns WHERE table_id=$1', [id]);
      const utDel = await client.query('DELETE FROM universal_tables WHERE id=$1', [id]);
      console.log(`[2] skill_sources: -${rowsDel.rowCount} rows, -${colsDel.rowCount} cols, -${utDel.rowCount} table`);
    } else {
      console.log('[2] skill_sources: already gone');
    }

    // ─── 3. Delete 7 new rows in 3710 (NOT the original 3) ───────────────
    const origIds = [115385, 115386, 115387];
    const newDel = await client.query(
      'DELETE FROM table_rows WHERE table_id=$1 AND id NOT IN (115385, 115386, 115387)',
      [SKILLS_TABLE_ID]
    );
    console.log(`[3] 3710: -${newDel.rowCount} new rows (kept 3 originals)`);

    // ─── 4. Restore 1790 row 119821 from backup ──────────────────────────
    const oldStray = backupRows.find(r => r.id === 119821 && r.table_id === TOOLS_TABLE_ID);
    if (!oldStray) {
      console.log('[4] backup has no row 119821 — skipping');
    } else {
      const exists = await client.query('SELECT 1 FROM table_rows WHERE id=$1', [119821]);
      if (exists.rowCount === 0) {
        await client.query(
          `INSERT INTO table_rows (id, table_id, base_id, data, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [oldStray.id, oldStray.table_id, oldStray.base_id,
           JSON.stringify(oldStray.data), oldStray.created_by,
           oldStray.created_at, oldStray.updated_at]
        );
        console.log('[4] restored 1790 row 119821 from backup');
      } else {
        console.log('[4] 1790 row 119821 already present — no-op');
      }
    }

    // ─── 5. Revert 3 existing rows to backup data ────────────────────────
    let reverted = 0;
    for (const origId of origIds) {
      const orig = backupRows.find(r => r.id === origId);
      if (!orig) continue;
      await client.query(
        'UPDATE table_rows SET data=$2::jsonb WHERE id=$1 AND table_id=$3',
        [origId, JSON.stringify(orig.data), SKILLS_TABLE_ID]
      );
      reverted++;
    }
    console.log(`[5] reverted ${reverted} original Skills rows to backup state`);

    // ─── 6. Drop 18 new columns + revert status enum ─────────────────────
    const colDel = await client.query(
      `DELETE FROM table_columns WHERE table_id=$1 AND column_name = ANY($2::text[])`,
      [SKILLS_TABLE_ID, NEW_3710_COLUMN_NAMES]
    );
    console.log(`[6a] dropped ${colDel.rowCount} new columns from 3710`);

    // Restore original status column config from backup
    const statusBackup = backupCols.find(c => c.table_id === SKILLS_TABLE_ID && c.column_name === 'status');
    if (statusBackup) {
      await client.query(
        'UPDATE table_columns SET config=$1 WHERE table_id=$2 AND column_name=$3',
        [statusBackup.config, SKILLS_TABLE_ID, 'status']
      );
      console.log('[6b] restored status column config from backup');
    }

    await client.query('COMMIT');
    console.log('\n[rollback] COMMIT — DOWN complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[rollback] ROLLBACK due to:', err);
    process.exit(2);
  } finally {
    await client.end();
  }
}

run();
