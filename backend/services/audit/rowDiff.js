// backend/services/audit/rowDiff.js
//
// ADR-0066 P1 — Diff helper for row.update audit details.
//
// computeRowDiff(before, after) returns a { changed_columns, before, after }
// shape containing ONLY the keys whose values differ between the two
// objects. Keys present in only one side are treated as changes
// (added → before:null, removed → after:null).
//
// Used by tableRowMutateController.js to satisfy ADR-0066 §4 (P1 AC):
// "PUT writes diff — only changed columns, before/after — not the entire
// row" so the 8 KiB cap on writeAudit() details has headroom even for
// fat rows (p99 row size = 12 KiB on PROD).

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  // Cheap deep-eq via JSON. Strings/numbers/bools fall through the
  // reference check above; for nested objects this is good enough for
  // change detection without pulling lodash.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Compute per-column diff between two row.data objects.
 * Returns `null` when there are no changes — callers should skip
 * writing an audit row in that case.
 *
 * @param {object|null} before
 * @param {object|null} after
 * @returns {{ changed_columns: string[], before: object, after: object } | null}
 */
export function computeRowDiff(before, after) {
  const a = isPlainObject(before) ? before : {};
  const b = isPlainObject(after) ? after : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

  const changed = [];
  const beforeOut = {};
  const afterOut = {};
  for (const key of keys) {
    if (!valuesEqual(a[key], b[key])) {
      changed.push(key);
      beforeOut[key] = a[key] === undefined ? null : a[key];
      afterOut[key] = b[key] === undefined ? null : b[key];
    }
  }
  if (changed.length === 0) return null;
  return { changed_columns: changed, before: beforeOut, after: afterOut };
}

export default computeRowDiff;
