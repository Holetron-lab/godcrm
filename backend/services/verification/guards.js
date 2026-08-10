// ADR-0011 · Phase B · row-update guards for verification columns.
//
// Call from any row-update path (PUT /rows/:id, batch updates) BEFORE writing.
// Loads all verification-type columns for the table and enforces:
//
//   C-4 — guard-violation auto-invalidation: if an UPDATE touches any column
//         listed in `config.guards` AND the cell currently has verified=true,
//         the returned cellOverride clears the stamp and appends an audit entry
//         `{ event: 'regressed', reason: 'guard_violation:<col>',
//            transition: { column, from, to } }`. The `transition` snapshot
//         mirrors the shape written on `verified` events by /verify so the UI
//         timeline can render both sides symmetrically.
//
//   C-6 — status lock: if any incoming column value resolves to a string in
//         `config.locks_on_statuses` AND the cell is NOT verified, we reject
//         with { ok: false, status: 409, code: 'VERIFICATION_REQUIRED' }.
//
//         The guarded column may be either:
//           - text/select  → incoming value is the slug itself (string)
//           - relation     → incoming value is a row_id (int/string); we
//                            resolve it to the target row's `slug` column
//                            (cached per call). Slug column name is hard-
//                            coded as `slug` — matches `_doc_statuses` and
//                            ADR-0013 status-table convention.
//
//   Direct-write rejection: verification cells CANNOT be written via row PUT
//         (only via /verify | /unverify endpoints). Any key in incomingData
//         matching a verification column name → 403 VERIFICATION_IMMUTABLE.
//
// The helper does NOT touch the DB beyond reads — it returns structured intent;
// the caller merges `cellOverrides` into outgoing row data or short-circuits on
// reject.

import { dbAll, dbGet, safeJsonParse } from '../../database/connection.js';

function parseConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    const parsed = safeJsonParse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }
  return typeof raw === 'object' ? raw : {};
}

function isStampedVerified(cell) {
  return !!(cell && typeof cell === 'object' && cell.verified === true && cell.verified_at);
}

/**
 * Resolve a row reference (int or string row_id) on a relation-typed column
 * to the target row's `slug` value. Returns the resolved slug or null if the
 * target row / slug is missing.
 *
 * For non-relation columns, returns the input cast to string (so callers can
 * compare against locks_on_statuses uniformly).
 *
 * @param {object} args
 * @param {Map} args.cache — per-call cache: key = `${tableId}:${columnName}`
 * @param {Map<number,object>} args.colMetaByName — table_columns rows by name
 * @param {string} args.columnName
 * @param {*} args.value
 * @returns {Promise<string|null>}
 */
async function resolveSlugForGuardValue({ cache, colMetaByName, columnName, value }) {
  if (value === null || value === undefined) return null;

  const meta = colMetaByName.get(columnName);
  // Unknown column or non-relation → value is already its own slug.
  if (!meta || meta.type !== 'relation') {
    return typeof value === 'string' ? value : String(value);
  }

  const cfg = parseConfig(meta.config);
  const targetTableId = cfg.target_table_id || cfg.target_table || cfg.tableId;
  if (!targetTableId) return null;

  const cacheKey = `${targetTableId}:${value}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const row = await dbGet(
    `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
    [value, targetTableId]
  );
  if (!row) {
    cache.set(cacheKey, null);
    return null;
  }
  const data = safeJsonParse(row.data) || (typeof row.data === 'object' ? row.data : {});
  const slug = data && typeof data === 'object' ? (data.slug ?? null) : null;
  const result = slug != null ? String(slug) : null;
  cache.set(cacheKey, result);
  return result;
}

/**
 * @param {object} args
 * @param {number|string} args.tableId
 * @param {object} args.existingData  — current row.data (pre-merge)
 * @param {object} args.incomingData  — user-submitted delta, keys are COLUMN NAMES
 * @param {number|null} args.userId
 * @returns {Promise<
 *   | { ok: true, cellOverrides: Record<string, object> }
 *   | { ok: false, status: number, code: string, message: string, meta?: object }
 * >}
 */
export async function enforceVerificationGuards({ tableId, existingData, incomingData, userId = null }) {
  // Load metadata for ALL columns once (cheap; needed for both verification
  // discovery and relation-type detection of guard keys).
  const allCols = await dbAll(
    `SELECT id, column_name, type, config
       FROM table_columns
      WHERE table_id = ?`,
    [tableId]
  );
  const verCols = allCols.filter((c) => c.type === 'verification');

  if (!verCols.length) return { ok: true, cellOverrides: {} };

  const incomingKeys = new Set(Object.keys(incomingData || {}));

  const colMetaByName = new Map();
  for (const c of allCols) colMetaByName.set(c.column_name, c);

  // Per-call cache for relation→slug resolution (key = `${targetTableId}:${rowId}`).
  const slugCache = new Map();

  const cellOverrides = {};

  for (const col of verCols) {
    // Direct-write rejection: /verify or /unverify endpoints only.
    if (incomingKeys.has(col.column_name)) {
      return {
        ok: false,
        status: 403,
        code: 'VERIFICATION_IMMUTABLE',
        message: `Column '${col.column_name}' is a verification cell and cannot be written via row update — use POST /columns/${col.id}/verify or /unverify`,
        meta: {
          verification_column_id: col.id,
          verification_column_name: col.column_name,
        },
      };
    }

    const cfg = parseConfig(col.config);
    const locks = Array.isArray(cfg.locks_on_statuses) ? cfg.locks_on_statuses : [];
    const guards = Array.isArray(cfg.guards) ? cfg.guards : [];
    const cell = existingData?.[col.column_name] ?? null;
    const verified = isStampedVerified(cell);

    // C-6: block status transition to a locked value while unverified.
    // For each incoming key:
    //  - if the column is type=relation, resolve row_id → slug (cached) and
    //    compare against locks_on_statuses.
    //  - otherwise (legacy text/select), compare the raw string value.
    if (locks.length > 0 && !verified) {
      for (const [k, v] of Object.entries(incomingData || {})) {
        const meta = colMetaByName.get(k);
        let candidate = null;
        if (meta && meta.type === 'relation') {
          candidate = await resolveSlugForGuardValue({
            cache: slugCache,
            colMetaByName,
            columnName: k,
            value: v,
          });
        } else if (typeof v === 'string') {
          candidate = v;
        }
        if (candidate != null && locks.includes(candidate)) {
          return {
            ok: false,
            status: 409,
            code: 'VERIFICATION_REQUIRED',
            message: `Cannot transition to status '${candidate}': verification column '${col.column_name}' is not verified`,
            meta: {
              verification_column_id: col.id,
              verification_column_name: col.column_name,
              offending_column: k,
              offending_value: v,
              resolved_slug: candidate,
            },
          };
        }
      }
    }

    // C-4: guard-violation auto-invalidation.
    // Comparison is on the raw incoming vs existing value (row_id vs row_id
    // is a valid identity check for relation columns — no slug resolution
    // needed for "did the field change?").
    if (guards.length > 0 && verified) {
      const violated = guards.find(
        (g) => incomingKeys.has(g) && incomingData[g] !== existingData?.[g]
      );
      if (violated) {
        const prevAudit = Array.isArray(cell.audit_log)
          ? cell.audit_log
          : Array.isArray(cell.audit) ? cell.audit : []; // legacy audit[] fallback
        cellOverrides[col.column_name] = {
          verified: false,
          verified_at: null,
          verified_by_user_id: null,
          methods_used: [],
          jti: null,
          audit_log: [
            ...prevAudit,
            {
              at: new Date().toISOString(),
              actor: userId,
              event: 'regressed',
              reason: `guard_violation:${violated}`,
              transition: {
                column: violated,
                from: existingData?.[violated] ?? null,
                to: incomingData[violated] ?? null,
              },
            },
          ],
        };
      }
    }
  }

  return { ok: true, cellOverrides };
}
