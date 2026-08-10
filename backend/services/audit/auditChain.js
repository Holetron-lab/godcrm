// backend/services/audit/auditChain.js
//
// ADR-0066-A — Tamper-evident hash chain over `public.audit_log`.
//
// This module is the FROZEN core of the chain: the canonical
// serialization and the digest function. It is pure (no DB, no I/O) so
// it can be exercised by a golden-vector unit test (Risk R5).
//
// ⚠️  DO NOT change `canonicalizeAuditRow`, `computeEntryHash`, the field
//     list, the domain-separation prefix, or the normalization rules
//     without bumping CHAIN_VERSION. Any change silently invalidates
//     every previously-written `entry_hash`. The golden-vector test
//     pins the current format; if you must change it, bump the version,
//     regenerate the vector, and document a re-hash/cutover plan.

import crypto from 'crypto';

/**
 * Hash-format version. Folded into the digest as a domain-separation
 * prefix (see computeEntryHash) so a format change produces different
 * hashes on purpose rather than a silent break (Risk R5).
 */
export const CHAIN_VERSION = 1;

/**
 * Advisory-lock key that serializes chain appends so concurrent audit
 * writes cannot fork the chain (ADR-0066-A §B). Transaction-scoped
 * (`pg_advisory_xact_lock`), released on COMMIT/ROLLBACK. Arbitrary but
 * fixed 63-bit constant; unique to the audit chain.
 */
export const AUDIT_CHAIN_LOCK = 660066n;

// Semantic columns hashed into each entry, in the FROZEN order from
// ADR-0066-A §A. The two hash columns are intentionally excluded from
// their own input. `id` and `created_at` are DB-assigned and therefore
// only known after INSERT ... RETURNING (see writeAudit).
const CANONICAL_FIELDS = [
  'id',
  'user_id',
  'acting_as',
  'action',
  'entity_type',
  'entity_id',
  'details',
  'request_id',
  'space_id',
  'ip_addr',
  'created_at',
];

/**
 * Normalize `created_at` (a pg Date, an ISO string, or epoch) to epoch
 * milliseconds. This drops sub-millisecond precision on BOTH the write
 * and verify paths identically, so it cannot cause a Date-vs-string /
 * micro-vs-milli mismatch between hashing and re-hashing.
 */
function toEpochMs(value) {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function normNum(value) {
  return value == null ? null : Number(value);
}

function normStr(value) {
  return value == null ? null : String(value);
}

/**
 * Deterministic, byte-stable serialization of an audit row's semantic
 * columns. Fixed field order, primitive-only values, no incidental
 * whitespace. `details` is kept as its stored JSON text (or null) — we
 * hash exactly what is persisted, not a re-serialized object.
 *
 * @param {object} row - keys: id, user_id, acting_as, action,
 *   entity_type, entity_id, details (string|null), request_id,
 *   space_id, ip_addr, created_at (Date|string|null)
 * @returns {string} canonical JSON string
 */
export function canonicalizeAuditRow(row) {
  const out = {};
  for (const f of CANONICAL_FIELDS) {
    switch (f) {
      case 'id':
      case 'user_id':
      case 'acting_as':
      case 'space_id':
        out[f] = normNum(row[f]);
        break;
      case 'created_at':
        out[f] = toEpochMs(row[f]);
        break;
      default:
        // action, entity_type, entity_id, details, request_id, ip_addr
        out[f] = normStr(row[f]);
    }
  }
  return JSON.stringify(out);
}

/**
 * entry_hash = sha256( versionPrefix ‖ prev_hash ‖ canonical(row) ).
 *
 * @param {Buffer|null} prevHash - predecessor row's entry_hash (Buffer),
 *   or null for the genesis row.
 * @param {object} row - the row to hash (see canonicalizeAuditRow).
 * @returns {Buffer} 32-byte sha256 digest.
 */
export function computeEntryHash(prevHash, row) {
  const h = crypto.createHash('sha256');
  // Domain separation + version marker (Risk R5): bumping CHAIN_VERSION
  // changes every digest on purpose.
  h.update(`adr0066a:v${CHAIN_VERSION}\n`, 'utf8');
  h.update(prevHash && prevHash.length ? prevHash : Buffer.alloc(0));
  h.update(canonicalizeAuditRow(row), 'utf8');
  return h.digest();
}

/**
 * Buffer/null-safe equality for two hash values.
 * @param {Buffer|null} a
 * @param {Buffer|null} b
 * @returns {boolean}
 */
export function hashEquals(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Buffer.isBuffer(a) && Buffer.isBuffer(b) && Buffer.compare(a, b) === 0;
}

/**
 * Pure verifier over an already-fetched, ascending-by-id slice of the
 * CHAINED subsequence (rows with a non-null entry_hash, id > cutover_id).
 * Factored out of DB access so the tamper logic is unit-testable with
 * golden vectors (the DB wrapper is verifyAuditChain.js).
 *
 * IMPORTANT: callers MUST pass only chained rows (`entry_hash IS NOT
 * NULL`). Legacy producers still INSERT into audit_log directly and
 * carry a NULL hash until ADR-0066 P5; feeding those here would compare
 * a recomputed digest against NULL and read as a false tamper. The chain
 * is defined over the hashed subsequence, not every raw id.
 *
 * Two independent checks per row (ADR-0066-A §C):
 *   1. Self-consistency — recompute entry_hash from the row's OWN stored
 *      prev_hash + canonical(row); must equal the stored entry_hash.
 *      Catches any edit to the row's semantic content.
 *   2. Linkage — the stored prev_hash must equal the previous walked
 *      row's entry_hash (or the anchor, or NULL at genesis). Catches
 *      deletion, reordering, and re-linking.
 *
 * @param {Array<object>} rows - ascending by id; each carries the
 *   canonical fields plus prev_hash (Buffer|null) and entry_hash (Buffer).
 * @param {object} [opts]
 * @param {Buffer} [opts.anchorHash] - entry_hash of the chained row
 *   immediately preceding this window (partial verify). Omit for a
 *   full-from-genesis verify, where the first row must have prev_hash NULL.
 * @returns {{ok: boolean, checked: number, break_at_id: (number|null)}}
 */
export function verifyChainRows(rows, opts = {}) {
  const hasAnchor = Object.prototype.hasOwnProperty.call(opts, 'anchorHash');
  let prevWalkedHash = hasAnchor ? opts.anchorHash : null;
  let checked = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Check 1 — self-consistency of this row's digest.
    const expected = computeEntryHash(row.prev_hash, row);
    if (!hashEquals(expected, row.entry_hash)) {
      return { ok: false, checked, break_at_id: row.id };
    }

    // Check 2 — linkage to the predecessor.
    if (i === 0 && !hasAnchor) {
      // Full verify: first chained row is genesis → prev_hash must be NULL.
      if (row.prev_hash != null) {
        return { ok: false, checked, break_at_id: row.id };
      }
    } else if (!hashEquals(row.prev_hash, prevWalkedHash)) {
      return { ok: false, checked, break_at_id: row.id };
    }

    prevWalkedHash = row.entry_hash;
    checked++;
  }

  return { ok: true, checked, break_at_id: null };
}
