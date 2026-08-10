// base_id Generation Utilities
//
// This generator emits the CANONICAL form: 8 characters [A-Z0-9] (e.g. "ABC12DEF").
// Note that base_ids ALREADY STORED in `table_rows` are NOT all of this form —
// large swaths use prefixed lineages such as `doc-*`, `skill-*`, `ext_*`,
// `op-*`, `agent-*`, `ticket-*` produced by other generators (see ADR-0156).
// Any check over stored base_ids must tolerate those forms (see isValidBaseId).

// Constants
const UPPERCASE_ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BASE_ID_LENGTH = 8;

/**
 * Generate a base_id for a row.
 *
 * Returns a random 8-character [A-Z0-9] string. This is NOT guaranteed unique:
 * it performs no existence pre-check and no retry, so collisions (while rare —
 * 36^8 ≈ 2.8e12 space) are possible. Callers that need a uniqueness guarantee
 * must enforce it at the storage layer (see ADR-0156 / hardening ticket).
 *
 * @returns {string} base_id - 8 characters [A-Z0-9]
 * @example "ABC12DEF", "XYZ789QW"
 */
export function generateBaseId() {
  let result = '';
  
  for (let i = 0; i < BASE_ID_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * UPPERCASE_ALPHANUMERIC.length);
    result += UPPERCASE_ALPHANUMERIC[randomIndex];
  }
  
  return result;
}

// Canonical generator output: exactly 8 chars of [A-Z0-9].
const CANONICAL_BASE_ID = /^[A-Z0-9]{8}$/;
// Documented prefixed lineages: lowercase prefix token + `-`/`_` separator +
// non-empty body. Matches doc-*, skill-*, ext_*, op-*, ticket-*, prefix-ts-rnd, …
const PREFIXED_BASE_ID = /^[a-z][a-z0-9]*[-_][A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Advisory check that a base_id has a recognised shape.
 *
 * ⚠️ NON-GATING: this MUST NOT be used to gate writes/inserts. ~32% of live
 * base_ids are legitimate prefixed forms (doc-*, ext_*, …) that the old strict
 * `^[A-Z0-9]{8}$` regex wrongly rejected (ADR-0156 §Decision.3). It is a
 * best-effort sanity helper for diagnostics/logging only — accept both the
 * canonical 8-char form and the documented prefixed lineages.
 *
 * @param {string} baseId - base_id to inspect
 * @returns {boolean} true if it matches a recognised base_id shape
 */
export function isValidBaseId(baseId) {
  if (!baseId || typeof baseId !== 'string') return false;
  return CANONICAL_BASE_ID.test(baseId) || PREFIXED_BASE_ID.test(baseId);
}
