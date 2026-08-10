// ADR-0011 · Phase C · CAPTCHA method plugin (hCaptcha).
//
// Requires HCAPTCHA_SECRET env. When unset → returns captcha_not_configured
// (the verify endpoint treats it as method-level failure, which bubbles up to
// 401 if required_methods is not met).
//
// Submission: { token: 'hcap-<...>' }  (client-side hCaptcha widget token).
// Server posts to hCaptcha siteverify; on {success:true} → ok.

import { apiLogger } from '../../../utils/logger.js';
import { getSecret } from '../../secrets/getSecret.js';
import { hashCode } from './hash.js';

const HCAPTCHA_VERIFY_URL = 'https://hcaptcha.com/siteverify';

export const captchaMethod = {
  name: 'captcha',

  async verify({ context, submission }) {
    const token = submission?.token;
    if (!token || typeof token !== 'string') {
      return { ok: false, code: 'captcha_token_missing', message: 'Captcha token is required' };
    }

    // ADR-0040: vault first, env fallback during transition.
    const secret = await getSecret('hcaptcha_secret', 'HCAPTCHA_SECRET');
    if (!secret) {
      return {
        ok: false,
        code: 'captcha_not_configured',
        message: 'Captcha is not configured (hcaptcha_secret missing in vault)',
      };
    }

    try {
      const body = new URLSearchParams({ secret, response: token });
      const resp = await fetch(HCAPTCHA_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const json = await resp.json();
      if (!json?.success) {
        apiLogger.warn({ errors: json?.['error-codes'] }, 'hCaptcha verify failed');
        return { ok: false, code: 'captcha_invalid', message: 'Captcha verification failed' };
      }
    } catch (err) {
      apiLogger.error({ err: err.message }, 'hCaptcha verify request failed');
      return { ok: false, code: 'captcha_network_error', message: 'Captcha verification request failed' };
    }

    const at = new Date().toISOString();
    return {
      ok: true,
      at,
      // Token is one-shot (hCaptcha invalidates on verify) — hash for audit only.
      code_hash: hashCode(token, context.rowId, at),
    };
  },
};
