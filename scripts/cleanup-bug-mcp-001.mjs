#!/usr/bin/env node
// BUG-MCP-001 cleanup: rows where `data` was stored as a JSON-encoded
// *string* in JSONB (jsonb_typeof = 'string') instead of a proper object.
//
// Root cause (fixed separately): MCP/agent callers occasionally pass `data`
// as a stringified JSON. Without an entry guard, `JSON.stringify(string)`
// at the SQL boundary produced a doubly-encoded string — so JSONB stored a
// quoted string and `data->>'field'` operators returned NULL.
//
// Two contamination sub-shapes observed in the wild:
//   A. WELL-FORMED — inner string parses cleanly to an object.
//   B. TRUNCATED   — inner string is missing its closing `}`. Repair by
//                    appending `}` (and `}}}` for nested-object tails) until
//                    JSON.parse succeeds, capped at 4 attempts.
//
// Usage:
//   node scripts/cleanup-bug-mcp-001.mjs --dry-run      (default)
//   node scripts/cleanup-bug-mcp-001.mjs --apply        (writes)
//   node scripts/cleanup-bug-mcp-001.mjs --apply --table-id 7288
//
// Idempotent.

import { dbAll, dbGet, dbRun } from '../backend/database/connection.js';

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;
const tableArgIdx = process.argv.indexOf('--table-id');
const TABLE_FILTER = tableArgIdx >= 0 ? Number(process.argv[tableArgIdx + 1]) : null;

const log = (...a) => console.log('[bug-mcp-001]', ...a);

/**
 * Try to recover an object from a possibly-truncated JSON string.
 * Returns { object, repaired } or null if unrecoverable.
 */
function recoverObject(s) {
  // First: clean parse
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { object: parsed, repaired: false };
    }
    return null;
  } catch {}

  // Second: maybe missing closing braces — try appending up to 4
  for (let n = 1; n <= 4; n++) {
    try {
      const parsed = JSON.parse(s + '}'.repeat(n));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { object: parsed, repaired: true };
      }
    } catch {}
  }
  return null;
}

async function main() {
  log(DRY ? 'DRY-RUN (no writes)' : 'APPLY mode (writes ENABLED)');
  if (TABLE_FILTER) log(`scope: table_id = ${TABLE_FILTER}`);

  const params = TABLE_FILTER ? [TABLE_FILTER] : [];
  const filter = TABLE_FILTER ? 'AND table_id = ?' : '';

  const rows = await dbAll(
    `SELECT id, table_id, data
       FROM table_rows
      WHERE jsonb_typeof(data) = 'string' ${filter}
      ORDER BY table_id, id`,
    params
  );

  if (rows.length === 0) {
    log('no contaminated rows — nothing to do');
    return;
  }

  log(`found ${rows.length} contaminated row(s)`);

  let cleanCount = 0;
  let repairedCount = 0;
  const unrecoverable = [];

  for (const row of rows) {
    // pg returns jsonb-string as a JS string (the inner value, unescaped).
    // SQLite mode would store it as a JSON-encoded text; unwrap one level.
    let innerString;
    if (typeof row.data === 'string') {
      innerString = row.data;
    } else {
      // Defensive: shouldn't happen for jsonb_typeof=string, but unwrap if needed
      innerString = String(row.data);
    }

    const recovered = recoverObject(innerString);
    if (!recovered) {
      unrecoverable.push({ id: row.id, table_id: row.table_id, tail: innerString.slice(-60) });
      continue;
    }

    if (recovered.repaired) repairedCount++;
    else cleanCount++;

    if (!DRY) {
      await dbRun(
        `UPDATE table_rows SET data = ? WHERE id = ? AND table_id = ?`,
        [JSON.stringify(recovered.object), row.id, row.table_id]
      );
    }
  }

  log(`clean   : ${cleanCount} row(s) (string parsed straight to object)`);
  log(`repaired: ${repairedCount} row(s) (truncated tail; appended closing braces)`);
  log(`skipped : ${unrecoverable.length} row(s) (could not recover — manual review)`);
  for (const u of unrecoverable.slice(0, 10)) log(`  skip id=${u.id} table=${u.table_id} tail=${u.tail || u.reason}`);

  if (DRY) {
    log(`DRY-RUN done. would update ${cleanCount + repairedCount} row(s). re-run with --apply to write.`);
    return;
  }

  // Verify
  const remaining = await dbGet(
    `SELECT COUNT(*)::int AS n FROM table_rows
      WHERE jsonb_typeof(data) = 'string' ${filter}`,
    params
  );
  log(`post-fix contaminated rows remaining: ${remaining?.n ?? 0}`);
  if ((remaining?.n ?? 0) === unrecoverable.length) {
    log('SUCCESS: all recoverable rows fixed' + (unrecoverable.length ? ' (skipped rows left as-is)' : ''));
  } else {
    log('WARN: residual count differs from expected — review manually');
  }
}

main()
  .catch((err) => {
    console.error('[bug-mcp-001] FATAL:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
