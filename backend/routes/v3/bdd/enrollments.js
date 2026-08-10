/**
 * ADR-156 Phase 5D — TOTP enrollment routes for bdd_criteria.
 *
 *   POST /bdd/criteria/:id/enroll-start     (generate TOTP secret + QR URI)
 *   POST /bdd/criteria/:id/enroll-confirm   (verify first code, issue recovery)
 *
 * TOTP secrets are stored on the criterion row itself under `data.totp`. During
 * the iter-5 transition window, enroll-confirm writes BOTH secret_enc (new,
 * AES-256-GCM) and active_secret (legacy plaintext). See shared.js.
 */

import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, notFound, badRequest } from '../../../utils/response.js';
import {
  criteriaTableId,
  getCriterionRow,
  patchLogicalRow,
  encryptSecret,
} from './shared.js';

export default function registerEnrollmentRoutes(router) {
  /* ------------------- POST /bdd/criteria/:id/enroll-start ------------------- */
  router.post('/criteria/:id/enroll-start', async (req, res) => {
    try {
      const critId = parseInt(req.params.id, 10);
      if (!Number.isFinite(critId)) return badRequest(res, 'Invalid criterion id');
      const crit = await getCriterionRow(critId);
      if (!crit) return notFound(res, 'bdd_criteria row');

      const label = crit.data?.code || `criterion-${critId}`;
      const secret = speakeasy.generateSecret({
        length: 20,
        name: `GodCRM:${label}`,
        issuer: 'GodCRM-BDD',
      });

      const tid = await criteriaTableId();
      const totpPatch = {
        ...(crit.data?.totp || {}),
        pending_secret: secret.base32,
        pending_at: new Date().toISOString(),
      };
      await patchLogicalRow(tid, critId, { totp: totpPatch });

      let qrDataUrl = null;
      try {
        qrDataUrl = await QRCode.toDataURL(secret.otpauth_url, { margin: 1, width: 240 });
      } catch (e) {
        apiLogger.warn({ err: e.message }, 'QR data URL generation failed (non-fatal)');
      }

      return success(res, {
        criterion_id: critId,
        provisioning_uri: secret.otpauth_url,
        qr_data_url: qrDataUrl,
      });
    } catch (err) {
      apiLogger.error({ err, critId: req.params.id }, 'POST /bdd/criteria/:id/enroll-start failed');
      return error(res, 'BDD_ENROLL_START_FAILED', err.message, 500);
    }
  });

  /* ------------------- POST /bdd/criteria/:id/enroll-confirm ------------------- */
  router.post('/criteria/:id/enroll-confirm', async (req, res) => {
    try {
      const critId = parseInt(req.params.id, 10);
      if (!Number.isFinite(critId)) return badRequest(res, 'Invalid criterion id');
      const { totp_code } = req.body || {};
      if (!totp_code || !/^\d{6}$/.test(String(totp_code))) {
        return badRequest(res, 'totp_code (6 digits) is required');
      }
      const crit = await getCriterionRow(critId);
      if (!crit) return notFound(res, 'bdd_criteria row');

      const totp = crit.data?.totp || {};
      if (!totp.pending_secret) {
        return res.status(412).json({
          success: false,
          error: { code: 'NO_PENDING_ENROLLMENT', message: 'Call enroll-start first' },
        });
      }

      const ok = speakeasy.totp.verify({
        secret: totp.pending_secret,
        encoding: 'base32',
        token: String(totp_code),
        window: 1,
      });
      if (!ok) {
        return res.status(401).json({
          success: false,
          error: { code: 'TOTP_INVALID', message: 'Wrong code' },
        });
      }

      // Issue recovery code (shown once, stored as SHA-256 hash)
      const recoveryCode = crypto.randomBytes(10).toString('hex').toUpperCase().slice(0, 16);
      const recoveryHash = crypto.createHash('sha256').update(recoveryCode).digest('hex');

      const tid = await criteriaTableId();
      // ADR-156 iter-5 Task 1: write encrypted secret_enc AND plaintext
      // active_secret during transition. Migration script will drop plaintext
      // once all rows have secret_enc.
      let secretEnc = null;
      try {
        secretEnc = encryptSecret(totp.pending_secret);
      } catch (e) {
        apiLogger.error({ err: e.message }, 'BDD TOTP: enroll-confirm encrypt failed (falling back to plaintext-only)');
      }
      await patchLogicalRow(tid, critId, {
        totp: {
          secret_enc: secretEnc,
          active_secret: totp.pending_secret,
          recovery_hash: recoveryHash,
          failed_attempts: 0,
          locked_until: null,
          enrolled_at: new Date().toISOString(),
        },
      });

      return success(res, {
        criterion_id: critId,
        success: true,
        recovery_code: recoveryCode,
      });
    } catch (err) {
      apiLogger.error({ err, critId: req.params.id }, 'POST /bdd/criteria/:id/enroll-confirm failed');
      return error(res, 'BDD_ENROLL_CONFIRM_FAILED', err.message, 500);
    }
  });
}
