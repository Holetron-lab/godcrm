/**
 * ADR-175 P1 §drift-guard — single source of truth for which optional
 * mail_messages columns exist on THIS database.
 *
 * A copied DB (`make sync-db` → godcrm_test on .72) can land on base mig-075
 * WITHOUT the later mail migs — the known "DB-copy wipes mail migs" landmine:
 * mig-079 adds linkage (linked_table_id / linked_row_id), mig-080 adds `starred`.
 * When those are missing the B2 facade must degrade gracefully, not hard-500 with
 * `column "starred" does not exist` — on BOTH the read projection and the write.
 *
 * We probe information_schema once and cache for the process lifetime. A live
 * migration that adds a column takes effect on the next process restart (deploy
 * restarts PM2). That's acceptable: a stale cache only ever UNDER-reports a
 * column, which is safe (NULL projection / rejected write with a clear 400) —
 * never a 500. Call _resetMailColumnsCache() right after applying migrations if
 * you need it live without a restart.
 */
import { dbAll } from '../../database/connection.js';

// Optional columns added AFTER base mig-075: linkage (079) + starred (080).
// Everything else in the projection — id / folder / from_* / subject / preview /
// date / is_read / ticket_id / space_id — is base and always present.
export const MAIL_OPTIONAL_COLS = ['starred', 'linked_table_id', 'linked_row_id'];

let _cache = null;

export async function getMailColumns() {
  if (_cache) return _cache;
  const rows = await dbAll(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'mail_messages' AND table_schema = current_schema()`
  );
  _cache = new Set(rows.map((r) => r.column_name));
  return _cache;
}

// Test seam / post-migration reset — clears the cached probe.
export function _resetMailColumnsCache() { _cache = null; }
