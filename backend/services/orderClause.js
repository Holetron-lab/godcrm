// ADR-151 — shared ORDER BY builder for the `order` (typed sort position) type.
//
// Single source of truth for sorting rows by a numeric `order` cell, replacing
// the previously-duplicated SQL spread across the generic list controller and
// the document-render controllers. We unify the *implementation*, NOT the
// *behavior* — each caller picks the mode that reproduces its historical sort
// byte-for-byte (see the unit suite, which pins the exact output strings).
//
// Two modes:
//   - 'coalesce' : legacy doc-content sort. Unset/null sorts as 0 (i.e. before
//                  positive positions), tie-broken by id. Document tables write
//                  through the integer floor-guard, so their `order` cells are
//                  always clean — no regex guard needed there.
//   - 'guarded'  : generic-table sort. The numeric cast is regex-guarded so a
//                  dirty/empty cell in an un-floor-guarded table can NEVER throw
//                  and break the hot list query; unset/dirty sorts last.
//
// The returned string is the ORDER BY *body* (no leading "ORDER BY ") — callers
// already prepend it. `key` is validated against an identifier allowlist to keep
// it injection-safe even though every current caller passes a trusted column.

const SAFE_KEY = /^[a-zA-Z0-9_]+$/;

/**
 * @param {string} key - JSON field name to sort by (e.g. 'order'). Must match /^[a-zA-Z0-9_]+$/.
 * @param {object} [opts]
 * @param {'pg'|'sqlite'} [opts.dialect='pg']
 * @param {'guarded'|'coalesce'} [opts.mode='guarded']
 * @param {string|null} [opts.tieBreak='created_at DESC'] - trailing tie-break columns, or null for none.
 * @param {boolean} [opts.coalesce=true] - 'coalesce' mode only: wrap the cast in COALESCE(…, 0). Pass false for a bare cast.
 * @returns {string} ORDER BY body
 */
export function buildOrderClause(key, opts = {}) {
  if (typeof key !== 'string' || !SAFE_KEY.test(key)) {
    throw new Error(`buildOrderClause: unsafe order key ${JSON.stringify(key)}`);
  }
  const { dialect = 'pg', mode = 'guarded', tieBreak = 'created_at DESC', coalesce = true } = opts;
  const tail = tieBreak ? `, ${tieBreak}` : '';

  if (dialect === 'sqlite') {
    // Legacy doc sqlite sort: integer cast of the json field.
    return `CAST(json_extract(data, '$.${key}') AS INTEGER)${tail}`;
  }

  if (mode === 'coalesce') {
    // Canonical doc-content sort. `coalesce` defaults true (unset sorts as 0,
    // before positive positions). `coalesce:false` drops the wrap to reproduce
    // callers whose historical SQL was a bare cast (e.g. the doc-tasks list).
    const expr = `(data->>'${key}')::numeric`;
    return `${coalesce ? `COALESCE(${expr}, 0)` : expr}${tail}`;
  }

  // guarded (generic tables): regex-protected numeric, unset/dirty sorts last.
  const txt = `data::jsonb->>'${key}'`;
  return `(CASE WHEN ${txt} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${txt})::numeric END) ASC NULLS LAST${tail}`;
}
