#!/usr/bin/env node
/**
 * ADR-204 Stage 2a — dry-run / apply / undo for legacy → content|contact.
 *
 *   node backend/scripts/adr204-stage2-dryrun.mjs --scope                 # every image/audio/email/phone/user/person column, preflight only
 *   node backend/scripts/adr204-stage2-dryrun.mjs --column=123 [--column=124]
 *   node backend/scripts/adr204-stage2-dryrun.mjs --table=100846
 *   node backend/scripts/adr204-stage2-dryrun.mjs --column=123 --apply --confirm-db=godcrm_test [--backup-dir=DIR]
 *   node backend/scripts/adr204-stage2-dryrun.mjs --undo=/path/adr204-column-123-....json --confirm-db=godcrm_test
 *
 * Default is READ ONLY. `--apply` / `--undo` additionally require
 * `--confirm-db=<name>` equal to `current_database()` — the script never
 * infers the target from localhost. Output is counts and reasons only; no
 * cell payload, no address, no backup path content is printed.
 *
 * Connection comes from POSTGRES_* in the environment (no .env autoload —
 * a worktree has none, and an inherited PM2 env on .128 points at the master).
 */
import path from 'node:path';
import { dbAll, dbGet, closeDatabase } from '../database/connection.js';
import { preflightColumn, applyColumn, undoColumn } from '../services/column-adapters/runner.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const columnArgs = process.argv.slice(2).filter((a) => a.startsWith('--column=')).map((a) => Number(a.split('=')[1]));
const SCOPE_TYPES = ['image', 'audio', 'email', 'phone', 'user', 'person'];

const db = (await dbGet('SELECT current_database() AS name')).name;
console.log(`[adr204] current_database() = ${db}`);

const mutating = args.apply || args.undo;
if (mutating && args['confirm-db'] !== db) {
  console.error(`[adr204] refusing to write: pass --confirm-db=${db} to confirm the target database`);
  await closeDatabase();
  process.exit(2);
}

try {
  if (args.undo) {
    await undoColumn(String(args.undo));
    console.log('[adr204] undo complete');
  } else {
    let ids = columnArgs;
    if (args.scope || args.table) {
      const rows = await dbAll(
        `SELECT c.id FROM table_columns c JOIN universal_tables t ON t.id = c.table_id
          WHERE c.type = ANY (?) ${args.table ? 'AND c.table_id = ?' : ''} ORDER BY c.type, c.id`,
        args.table ? [SCOPE_TYPES, Number(args.table)] : [SCOPE_TYPES]
      );
      ids = rows.map((r) => r.id);
    }
    if (!ids.length) throw new Error('nothing selected: use --scope, --table=<id> or --column=<id>');

    // Fixture rows leaked by earlier test runs share the test DB; flag them so
    // the scope numbers are honest, without printing anything from the rows.
    const fixtureTables = new Set((await dbAll(
      "SELECT id FROM universal_tables WHERE name LIKE 'Test Table %' OR name LIKE 'Imported%' OR name = 'compatible'"
    )).map((r) => r.id));

    const totals = {};
    for (const id of ids) {
      const pre = await preflightColumn(id);
      const key = `${pre.column.type}→${pre.column.target}`;
      const t = totals[key] ??= { columns: 0, fixture_columns: 0, rows: 0, ok: 0, convertible: 0, empty: 0, already: 0, ambiguous: 0, unsupported: 0, reasons: {} };
      t.columns++; t.rows += pre.rows; if (pre.ok) t.ok++;
      if (fixtureTables.has(pre.column.table_id)) t.fixture_columns++;
      for (const s of ['convertible', 'empty', 'already', 'ambiguous', 'unsupported']) t[s] += pre.counts[s] ?? 0;
      for (const [reason, n] of Object.entries(pre.reasons)) t.reasons[reason] = (t.reasons[reason] ?? 0) + n;
      console.log(`[adr204] column ${id} table ${pre.column.table_id} ${key} rows=${pre.rows} ok=${pre.ok}${fixtureTables.has(pre.column.table_id) ? ' fixture' : ''} ` +
        JSON.stringify(pre.counts));

      if (args.apply) {
        const artifact = await applyColumn(id, { backupDir: String(args['backup-dir'] ?? '/root/backups/adr204') });
        console.log(`[adr204] column ${id} applied; artifact in ${path.dirname(artifact)}`);
      }
    }
    console.log('[adr204] summary by class:');
    console.log(JSON.stringify(totals, null, 2));
  }
} finally {
  await closeDatabase();
}
