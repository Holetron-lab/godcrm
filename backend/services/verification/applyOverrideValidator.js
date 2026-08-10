// ADR-0011 · Phase E2 · Override-atom write-path hook (C-8 enforcement)
//
// When a `verification_settings` atom is written into atoms_v2 (table 3574),
// load the referenced verification column's config (`base`) and run
// `validateVerificationOverride(base, override)`. Reject the write on any
// loosening violation.
//
// Atom shape (writer contract):
//   {
//     semantic_type: 'verification_settings',
//     doc_id:        <int>      // owning document
//     column_id:     <int>      // FK → table_columns.id (must be type=verification)
//     override:      <object>   // partial config (any of cooldown_seconds,
//                                  required_methods, available_methods,
//                                  guards, ttl_seconds, rate_limit, policy, ...)
//   }
//
// Feature-flagged on VERIFICATION_COLUMN_ENABLED (Phase A flag): when off,
// the column type can't even be created → no matching column_id can exist,
// so we short-circuit to `ok: true`.
//
// Returns shape mirrors validateVerificationOverride:
//   { ok: true } | { ok: false, error: string, field?: string, status?: number }
//
// Status codes:
//   400 — schema-level (missing column_id, base column not found, base
//          config not normalized) OR validator rejection.
//   403 — column_id refers to a non-verification column.

import { dbGet } from '../../database/connection.js';
import { validateVerificationOverride } from './validateOverride.js';
import { ATOMS_V2_TABLE_ID } from '../atoms-archive.js';

const VERIFICATION_SETTINGS_SEMANTIC_TYPE = 'verification_settings';

function parseConfig(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Inspect a candidate atoms_v2 row payload. Returns ok:true for any payload
 * that ISN'T a verification_settings atom (no-op for unrelated atoms).
 *
 * @param {object} args
 * @param {number|string} args.tableId
 * @param {object} args.data           — row data being written (post-merge)
 * @returns {Promise<{ok:true} | {ok:false, error:string, field?:string, status:number}>}
 */
export async function validateVerificationSettingsAtom({ tableId, data }) {
  if (Number(tableId) !== ATOMS_V2_TABLE_ID) return { ok: true };
  if (!data || typeof data !== 'object') return { ok: true };
  if (data.semantic_type !== VERIFICATION_SETTINGS_SEMANTIC_TYPE) return { ok: true };

  // Feature flag — when off, validator is a no-op (no verification columns
  // exist in this env, so nothing to override anyway).
  if (process.env.VERIFICATION_COLUMN_ENABLED !== 'true') return { ok: true };

  const columnId = Number(data.column_id);
  if (!Number.isInteger(columnId) || columnId <= 0) {
    return { ok: false, status: 400, field: 'column_id',
      error: 'verification_settings.column_id must be a positive integer' };
  }

  const override = data.override;
  if (override === undefined || override === null) {
    // Empty override is degenerate but not malformed — nothing to tighten.
    return { ok: true };
  }
  if (typeof override !== 'object' || Array.isArray(override)) {
    return { ok: false, status: 400, field: 'override',
      error: 'verification_settings.override must be an object' };
  }

  const column = await dbGet(
    'SELECT id, type, config FROM table_columns WHERE id = ?',
    [columnId]
  );
  if (!column) {
    return { ok: false, status: 400, field: 'column_id',
      error: `column ${columnId} not found` };
  }
  if (column.type !== 'verification') {
    return { ok: false, status: 403, field: 'column_id',
      error: `column ${columnId} is not a verification column (type=${column.type})` };
  }

  const base = parseConfig(column.config);
  if (!base || typeof base !== 'object') {
    return { ok: false, status: 400, field: 'column.config',
      error: `column ${columnId} has malformed config — cannot validate override` };
  }

  const result = validateVerificationOverride(base, override);
  if (!result.ok) {
    return { ok: false, status: 400, error: result.error, field: result.field };
  }
  return { ok: true };
}

export { VERIFICATION_SETTINGS_SEMANTIC_TYPE };
