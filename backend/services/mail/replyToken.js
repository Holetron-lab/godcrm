/**
 * Reply-token helpers — ADR-158 §P2 (CRM linkage).
 *
 * A linked outbound message gets a short URL-safe token minted here and embedded
 * in its subject as `[crm:<token>]`. When the recipient replies, their client
 * keeps the marker in the (`Re: …`) subject; the inbound sync scans it back out
 * with `extractReplyToken` and copies the outbound row's linkage onto the reply.
 *
 * The token is the only join key — the prefix `crm:` is generic on purpose:
 * linkage is a (table_id, row_id) pair (deal / lead / ticket / any table), not a
 * ticket-only relation, so the ADR's illustrative `[ticket:token]` is realized
 * here as `[crm:token]`. Pure/stateless: no DB, no crypto secrets — the token is
 * an opaque random handle, the trust boundary is the DB uniqueness lookup.
 */

import { randomBytes } from 'node:crypto';

// 8 bytes → 11 base64url chars, charset [A-Za-z0-9_-]. Enough entropy that a
// guessed token still has to match a row in the sender's own space to link.
const TOKEN_BYTES = 8;
const MARKER_RE = /\[crm:([A-Za-z0-9_-]{6,})\]/i;

/** @returns {string} a fresh URL-safe reply token (no padding). */
export function generateReplyToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Append the `[crm:<token>]` marker to a subject if not already present.
 * Idempotent: re-embedding the same token is a no-op (survives Re:/Fwd: too).
 * @param {string} subject
 * @param {string} token
 * @returns {string}
 */
export function embedReplyToken(subject, token) {
  const base = String(subject || '').trim();
  if (!token) return base;
  if (base.includes(`[crm:${token}]`)) return base;
  return base ? `${base} [crm:${token}]` : `[crm:${token}]`;
}

/**
 * Extract a reply token from a subject, or null if none.
 * @param {string} subject
 * @returns {string | null}
 */
export function extractReplyToken(subject) {
  const m = MARKER_RE.exec(String(subject || ''));
  return m ? m[1] : null;
}

export default { generateReplyToken, embedReplyToken, extractReplyToken };
