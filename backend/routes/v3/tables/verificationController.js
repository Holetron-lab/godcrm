// ADR-0011 · Verification column API — verify / unverify endpoints.
//
// POST /api/v3/tables/:tableId/rows/:rowId/columns/:columnId/verify
// POST /api/v3/tables/:tableId/rows/:rowId/columns/:columnId/unverify
//
// Phase A  — scaffold + flag-gate + cooldown + agent-reject (stub response).
// Phase C  — real method dispatch (TOTP / CAPTCHA plugins wired; SMS/email
//            stubs return method_not_implemented and bubble up as 401).
//
// Storage format on success (per ADR-0011 §Storage):
//   {
//     verified: true,                       // bool kept for guards.js
//     verified_at: iso,
//     verified_by_user_id: <userId>,
//     methods_used: [ { method, at, code_hash } ],
//     jti: uuid,
//     audit_log: [ { at, actor, event: 'verified', reason } ]
//   }
// On unverify the same shape is written with verified=false and a
// { event: 'unverified', ... } entry appended to audit_log.

import express from 'express';
import crypto from 'node:crypto';
import { dbGet, dbRun } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import {
  success,
  notFound,
  badRequest,
  forbidden,
  error,
} from '../../../utils/response.js';
import { verifyTableAccess } from '../columns/helpers.js';
import { validateVerificationConfig } from '../../../services/verification/validateConfig.js';
import { getMethod } from '../../../services/verification/methods/index.js';

const router = express.Router();

function isEnabled() {
  return process.env.VERIFICATION_COLUMN_ENABLED === 'true';
}

async function recordAttempt({ columnId, rowId, userId, method, success: ok, errorCode, clientIp }) {
  try {
    await dbRun(
      `INSERT INTO _verification_attempts
       (column_id, row_id, user_id, method, success, error_code, client_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [columnId, rowId, userId || null, method || null, ok ? 1 : 0, errorCode || null, clientIp || null]
    );
  } catch (err) {
    apiLogger.error({ err, columnId, rowId }, 'Failed to record verification attempt');
  }
}

async function loadVerificationColumn(tableId, columnId) {
  const column = await dbGet(
    `SELECT id, table_id, column_name AS name, type, config
       FROM table_columns
      WHERE id = ? AND table_id = ?`,
    [columnId, tableId]
  );
  if (!column) return null;
  if (column.type !== 'verification') return { error: 'not_verification_column' };

  let cfg = column.config;
  if (typeof cfg === 'string') {
    try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
  }
  cfg = cfg || {};
  return { column, config: cfg };
}

// ADR-0011 C-5: human-ownership chain — only a human user_ref may sign.
// Rejects 'agent' (Claude/Ralph), 'bot' (external integrations) and
// 'service' (service accounts). NULL user_type is treated as human
// because migration 018 back-fills existing rows to 'human' and we don't
// want legacy data to get locked out.
async function isAgentUser(userId) {
  if (!userId) return true;
  const u = await dbGet(`SELECT user_type FROM users WHERE id = ?`, [userId]);
  if (!u) return true;
  return u.user_type === 'agent' || u.user_type === 'bot' || u.user_type === 'service';
}

function isSafeIdentifier(name) {
  return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Normalize submissions. Accepts the ADR-0011 shape
 *   { methods: [ { method, code?, token? }, ... ], reason? }
 * or the Phase-A single-method shape
 *   { token, method? }
 * (with `code` as a synonym of `token` for back-compat).
 */
function parseSubmissions(body, defaultMethod) {
  if (body && Array.isArray(body.methods)) {
    return body.methods.map((s) => ({
      method: s?.method,
      code: s?.code ?? s?.token,
      token: s?.token ?? s?.code,
    }));
  }
  // Single-method legacy shape
  if (body && (body.token || body.code)) {
    return [{
      method: body.method || defaultMethod,
      code: body.code ?? body.token,
      token: body.token ?? body.code,
    }];
  }
  return [];
}

// ------------------------------------------------------------------
// POST /tables/:tableId/rows/:rowId/columns/:columnId/verify
// ------------------------------------------------------------------
router.post(
  '/tables/:tableId/rows/:rowId/columns/:columnId/verify',
  verifyTableAccess,
  async (req, res) => {
    if (!isEnabled()) {
      return error(res, 'VERIFICATION_DISABLED', 'Verification column feature is disabled', 503);
    }

    const { tableId, rowId, columnId } = req.params;
    const userId = req.user?.id;
    const clientIp = req.ip || req.connection?.remoteAddress || null;
    const reason = req.body?.reason || null;
    // ADR-0011: optional { column, from, to } snapshot of the mutation that
    // triggered the gate. Stored verbatim on the audit_log entry so the UI
    // timeline can show "status: draft → published".
    const rawTransition = req.body?.transition;
    const transition =
      rawTransition && typeof rawTransition === 'object' && typeof rawTransition.column === 'string'
        ? {
            column: rawTransition.column,
            from: rawTransition.from ?? null,
            to: rawTransition.to ?? null,
          }
        : null;

    // C-5: reject agent JWTs
    if (await isAgentUser(userId)) {
      await recordAttempt({ columnId, rowId, userId, method: null, success: false, errorCode: 'agent_forbidden', clientIp });
      return error(res, 'AGENT_CANNOT_SELF_SIGN', 'Agent accounts cannot perform verification', 403);
    }

    const loaded = await loadVerificationColumn(tableId, columnId);
    if (!loaded) return notFound(res, 'Column');
    if (loaded.error === 'not_verification_column') {
      return badRequest(res, 'Column is not of type verification');
    }
    const { column, config } = loaded;

    const cfgCheck = validateVerificationConfig(config);
    if (!cfgCheck.ok) {
      await recordAttempt({ columnId, rowId, userId, method: null, success: false, errorCode: 'config_invalid', clientIp });
      return error(res, 'VERIFICATION_CONFIG_INVALID', `Invalid verification config: ${cfgCheck.error}`, 500);
    }
    const normalized = cfgCheck.normalized;

    if (!isSafeIdentifier(column.name)) {
      return error(res, 'VERIFICATION_BAD_COLUMN_NAME', 'Column name is not a safe identifier', 500);
    }

    // C-10: per-user × per-column sliding-window rate limit.
    // Counts all attempts (success + failure) this user made against this
    // column across every row in the window. Applies BEFORE cooldown so a
    // caller burning quota across different rows is rejected early.
    if (normalized.rate_limit && userId) {
      const { window_seconds: windowSec, max_attempts: maxAttempts } = normalized.rate_limit;
      const countRow = await dbGet(
        `SELECT COUNT(*)::int AS n FROM _verification_attempts
          WHERE column_id = ? AND user_id = ?
            AND attempted_at > NOW() - (? || ' seconds')::interval`,
        [columnId, userId, String(windowSec)]
      );
      const used = countRow?.n || 0;
      if (used >= maxAttempts) {
        await recordAttempt({ columnId, rowId, userId, method: null, success: false, errorCode: 'rate_limited', clientIp });
        res.set('Retry-After', String(windowSec));
        return error(res, 'VERIFICATION_RATE_LIMITED',
          `Rate limit: ${used}/${maxAttempts} attempts in last ${windowSec}s for this column`,
          429,
          { used, max: maxAttempts, window_seconds: windowSec, retry_in: windowSec }
        );
      }
    }

    // C-3: cooldown (per-user, per-cell) — per ADR §Config cooldown_seconds.
    // Only failed code-submission attempts count: a successful verify should
    // not block the next legitimate verify, and rejection markers (cooldown /
    // rate_limited / agent_forbidden / config_invalid) must not extend their
    // own window — otherwise impatient clicking during cooldown resets the
    // clock forever.
    const cooldownMs = normalized.cooldown_ms;
    if (cooldownMs > 0) {
      const lastAttempt = await dbGet(
        `SELECT attempted_at FROM _verification_attempts
          WHERE column_id = ? AND row_id = ? AND user_id = ?
            AND success = false
            AND (error_code IS NULL
                 OR error_code NOT IN ('cooldown', 'rate_limited', 'agent_forbidden', 'config_invalid'))
          ORDER BY attempted_at DESC
          LIMIT 1`,
        [columnId, rowId, userId]
      );
      if (lastAttempt?.attempted_at) {
        const elapsedMs = Date.now() - new Date(lastAttempt.attempted_at).getTime();
        if (elapsedMs < cooldownMs) {
          const retryAfterSec = Math.ceil((cooldownMs - elapsedMs) / 1000);
          await recordAttempt({ columnId, rowId, userId, method: null, success: false, errorCode: 'cooldown', clientIp });
          res.set('Retry-After', String(retryAfterSec));
          return error(res, 'VERIFICATION_COOLDOWN_ACTIVE', 'Cooldown active, try again later', 429, { retry_in: retryAfterSec });
        }
      }
    }

    const submissions = parseSubmissions(req.body, normalized.method);
    if (submissions.length === 0) {
      return badRequest(res, 'Request body must include `methods` array or legacy `{token, method}`');
    }

    // Run each submission through its plugin. Duplicate methods in the same
    // request are collapsed — only the first successful pass per method counts
    // toward required_methods (prevents "submit totp twice" bypass).
    const ctx = {
      userId,
      tableId: Number(tableId),
      rowId: Number(rowId),
      columnId: Number(columnId),
      column,
      config: normalized,
    };

    const methodsUsed = [];
    const passedMethods = new Set();
    const failures = [];

    for (const submission of submissions) {
      const mname = submission.method;
      if (!mname || typeof mname !== 'string') {
        failures.push({ method: mname || null, code: 'method_missing', message: 'Submission missing method name' });
        continue;
      }
      if (!normalized.available_methods.includes(mname)) {
        failures.push({ method: mname, code: 'method_not_available', message: `Method '${mname}' is not in available_methods` });
        continue;
      }
      const plugin = getMethod(mname);
      if (!plugin) {
        failures.push({ method: mname, code: 'method_unknown', message: `Method '${mname}' is not registered` });
        continue;
      }

      let result;
      try {
        result = await plugin.verify({ context: ctx, submission });
      } catch (err) {
        apiLogger.error({ err, method: mname, rowId, columnId }, 'Method plugin threw');
        result = { ok: false, code: 'method_plugin_error', message: err.message || 'Plugin error' };
      }

      if (result?.ok) {
        if (!passedMethods.has(mname)) {
          passedMethods.add(mname);
          methodsUsed.push({
            method: mname,
            at: result.at,
            code_hash: result.code_hash,
          });
        }
        await recordAttempt({ columnId, rowId, userId, method: mname, success: true, errorCode: null, clientIp });
      } else {
        failures.push({ method: mname, code: result?.code || 'method_failed', message: result?.message || 'Method failed' });
        await recordAttempt({ columnId, rowId, userId, method: mname, success: false, errorCode: result?.code || 'method_failed', clientIp });
      }
    }

    // C-2: enforce N-of-M
    if (passedMethods.size < normalized.required_methods) {
      return error(
        res,
        'VERIFICATION_FAILED',
        `Verification failed — ${passedMethods.size}/${normalized.required_methods} method(s) passed`,
        401,
        { passed: Array.from(passedMethods), required: normalized.required_methods, failures }
      );
    }

    // Success — load current cell, stamp, persist.
    const row = await dbGet(
      `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`,
      [rowId, tableId]
    );
    if (!row) {
      return notFound(res, 'Row');
    }

    const existingData = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    const prevCell = existingData?.[column.name] || {};
    const prevAudit = Array.isArray(prevCell.audit_log) ? prevCell.audit_log : [];

    const verifiedAt = new Date().toISOString();
    const jti = crypto.randomUUID();

    const newCell = {
      verified: true,
      verified_at: verifiedAt,
      verified_by_user_id: userId,
      methods_used: methodsUsed,
      jti,
      audit_log: [
        ...prevAudit,
        {
          at: verifiedAt,
          actor: userId,
          event: 'verified',
          reason,
          ...(transition ? { transition } : {}),
        },
      ],
    };

    await dbRun(
      `UPDATE table_rows
         SET data = jsonb_set(data, '{${column.name}}', ?::jsonb),
             updated_at = NOW()
       WHERE id = ? AND table_id = ?`,
      [JSON.stringify(newCell), rowId, tableId]
    );

    apiLogger.info(
      { tableId, rowId, columnId, userId, jti, methods: Array.from(passedMethods) },
      'Cell verified'
    );
    return success(res, {
      column_id: Number(columnId),
      row_id: Number(rowId),
      verified: true,
      verified_at: verifiedAt,
      jti,
    });
  }
);

// ------------------------------------------------------------------
// POST /tables/:tableId/rows/:rowId/columns/:columnId/unverify
// ------------------------------------------------------------------
router.post(
  '/tables/:tableId/rows/:rowId/columns/:columnId/unverify',
  verifyTableAccess,
  async (req, res) => {
    if (!isEnabled()) {
      return error(res, 'VERIFICATION_DISABLED', 'Verification column feature is disabled', 503);
    }

    const { tableId, rowId, columnId } = req.params;
    const userId = req.user?.id;
    const clientIp = req.ip || req.connection?.remoteAddress || null;
    const reason = req.body?.reason || null;

    if (await isAgentUser(userId)) {
      await recordAttempt({ columnId, rowId, userId, method: 'unverify', success: false, errorCode: 'agent_forbidden', clientIp });
      return forbidden(res, 'Agent accounts cannot perform verification');
    }

    const loaded = await loadVerificationColumn(tableId, columnId);
    if (!loaded) return notFound(res, 'Column');
    if (loaded.error === 'not_verification_column') {
      return badRequest(res, 'Column is not of type verification');
    }
    const { column } = loaded;

    if (!isSafeIdentifier(column.name)) {
      return error(res, 'VERIFICATION_BAD_COLUMN_NAME', 'Column name is not a safe identifier', 500);
    }

    const row = await dbGet(
      `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`,
      [rowId, tableId]
    );
    if (!row) {
      await recordAttempt({ columnId, rowId, userId, method: 'unverify', success: false, errorCode: 'row_not_found', clientIp });
      return notFound(res, 'Row');
    }

    const existingData = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    const prevCell = existingData?.[column.name] || {};
    const prevAudit = Array.isArray(prevCell.audit_log) ? prevCell.audit_log : [];
    const at = new Date().toISOString();

    const cell = {
      verified: false,
      verified_at: null,
      verified_by_user_id: null,
      methods_used: [],
      jti: null,
      audit_log: [
        ...prevAudit,
        { at, actor: userId, event: 'unverified', reason },
      ],
    };

    await dbRun(
      `UPDATE table_rows
         SET data = jsonb_set(data, '{${column.name}}', ?::jsonb),
             updated_at = NOW()
       WHERE id = ? AND table_id = ?`,
      [JSON.stringify(cell), rowId, tableId]
    );

    await recordAttempt({ columnId, rowId, userId, method: 'unverify', success: true, errorCode: null, clientIp });
    apiLogger.info({ tableId, rowId, columnId, userId }, 'Cell unverified');
    return success(res, { column_id: Number(columnId), row_id: Number(rowId), verified: false });
  }
);

export default router;
