// ADR-0011 · Phase C · shared hash helper for method proofs.
//
// Storage format (ADR §Storage): methods_used[].code_hash = "sha256:<hex>" of
// the tuple (code + row_id + verified_at). Per the ADR risk table, this hash
// is a presence proof, not a secret-recovery vector — the same code hashed
// with a different row_id or timestamp yields a different digest.

import crypto from 'node:crypto';

export function hashCode(code, rowId, verifiedAt) {
  const input = `${String(code)}${String(rowId)}${String(verifiedAt)}`;
  const h = crypto.createHash('sha256').update(input).digest('hex');
  return `sha256:${h}`;
}
