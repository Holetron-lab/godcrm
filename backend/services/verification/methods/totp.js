// ADR-0011 · Phase C · TOTP method plugin.
//
// Per-user TOTP: reuses `users.totp_secret` / `users.totp_enabled` (set via
// POST /api/v2/auth/2fa/setup + /verify). The verification column does NOT
// provision its own secrets — the user enrolls once in account settings and
// the same authenticator covers every verification call.
//
// If the user has no TOTP enrolled → 412 `totp_not_enrolled` (surfaced as
// method-level failure, verify endpoint aggregates into 401 overall).

import speakeasy from 'speakeasy';
import { dbGet } from '../../../database/connection.js';
import { hashCode } from './hash.js';

export const totpMethod = {
  name: 'totp',

  /**
   * @param {object} args
   * @param {{userId:number, rowId:number|string, columnId:number|string}} args.context
   * @param {{code?:string}} args.submission
   * @returns {Promise<{ok:true, at:string, code_hash:string} | {ok:false, code:string, message:string}>}
   */
  async verify({ context, submission }) {
    const code = submission?.code;
    if (!code || typeof code !== 'string') {
      return { ok: false, code: 'totp_code_missing', message: 'TOTP code is required' };
    }

    const user = await dbGet(
      `SELECT totp_secret, totp_enabled FROM users WHERE id = ?`,
      [context.userId]
    );
    if (!user) {
      return { ok: false, code: 'user_not_found', message: 'User not found' };
    }
    if (!user.totp_enabled || !user.totp_secret) {
      return {
        ok: false,
        code: 'totp_not_enrolled',
        message: 'TOTP is not enabled on this account — enroll via /2fa/setup first',
      };
    }

    const ok = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: String(code).trim(),
      window: 1,
    });
    if (!ok) {
      return { ok: false, code: 'totp_invalid', message: 'Invalid TOTP code' };
    }

    const at = new Date().toISOString();
    return {
      ok: true,
      at,
      code_hash: hashCode(code, context.rowId, at),
    };
  },
};
