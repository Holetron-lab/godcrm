// backend/services/audit/verifyAuditChain.js
//
// ADR-0066-A §C — walk the audit_log hash chain and detect tampering.
//
// Recompute each post-cutover row's entry_hash and assert it matches the
// stored value AND that its prev_hash links to the predecessor's
// entry_hash. First mismatch is the tamper point.
//
// A row that predates the chain (id <= cutover_id) is skipped: re-hashing
// history it never carried proves nothing (ADR-0066-A §E).

import { dbAll, dbGet } from '../../database/connection.js';
import { verifyChainRows } from './auditChain.js';

const CANONICAL_SELECT = `
  id, user_id, acting_as, action, entity_type, entity_id, details,
  request_id, space_id, ip_addr, created_at, prev_hash, entry_hash
`;

/**
 * Cutover id: chain covers strictly id > cutover_id. 0 if the meta row is
 * absent (chain never initialized — treat everything as pre-chain).
 * @returns {Promise<number>}
 */
export async function getCutoverId() {
  const row = await dbGet(
    `SELECT value FROM audit_chain_meta WHERE key = 'cutover_id'`
  );
  return row?.value != null ? Number(row.value) : 0;
}

function toHex(buf) {
  return buf && Buffer.isBuffer(buf) ? buf.toString('hex') : null;
}

/**
 * Verify the chain.
 *
 * @param {number} [fromId] - optional: only re-check rows with id >=
 *   fromId (seeded from the predecessor's entry_hash). Defaults to the
 *   full post-cutover chain. Never verifies below cutover.
 * @returns {Promise<{ok:boolean, checked:number, break_at_id:number|null,
 *   cutover_id:number, head:{max_id:number, entry_hash:string}|null}>}
 */
export async function verifyAuditChain(fromId) {
  const cutover = await getCutoverId();
  // First row id to (re)check. Chain is id > cutover; from_id can start a
  // suffix but never dips at/below cutover.
  const start =
    fromId != null && Number(fromId) > cutover ? Number(fromId) : cutover + 1;

  // Seed prev with the last chained row strictly before `start`. Genesis
  // (start = cutover+1, nothing chained below) → null.
  const seedRow = await dbGet(
    `SELECT entry_hash FROM audit_log
      WHERE id < ? AND entry_hash IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [start]
  );
  let prev = seedRow?.entry_hash ?? null; // Buffer | null

  const rows = await dbAll(
    `SELECT ${CANONICAL_SELECT} FROM audit_log
      WHERE id >= ? ORDER BY id ASC`,
    [start]
  );

  // Delegate the tamper logic to the pure, golden-vector-tested verifier.
  // Full-from-genesis omits the anchor (first row must have prev_hash
  // NULL); a partial verify seeds the anchor from the predecessor's
  // entry_hash so the first checked row's linkage is still validated.
  const isPartial = start > cutover + 1;
  const result = isPartial
    ? verifyChainRows(rows, { anchorHash: prev })
    : verifyChainRows(rows);

  // Head is the true chain head (max id row), regardless of the window.
  const last = rows.length ? rows[rows.length - 1] : null;
  const head =
    last && last.entry_hash
      ? { max_id: Number(last.id), entry_hash: toHex(last.entry_hash) }
      : null;

  return {
    ok: result.ok,
    checked: result.checked,
    break_at_id: result.break_at_id != null ? Number(result.break_at_id) : null,
    cutover_id: cutover,
    head,
  };
}

export default verifyAuditChain;
