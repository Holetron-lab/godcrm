// Single source of truth for prefix + SHA-256 hash on intake tokens.
// See ADR-0069. Used by:
//   - webhook create / resolver
//   - migration 070 backfill
//   - any future intake-token table (api keys, deploy tokens) per the
//     standing rule in ADR-0069 §"Standing rule".

import crypto from 'node:crypto';

export const TOKEN_PREFIX_LEN = 12;

export function hashToken(plain) {
  if (typeof plain !== 'string') {
    throw new TypeError(`hashToken: plaintext must be a string, got ${typeof plain}`);
  }
  const prefix = plain.slice(0, TOKEN_PREFIX_LEN);
  const hash = crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
  return { prefix, hash };
}
