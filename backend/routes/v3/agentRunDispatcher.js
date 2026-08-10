/**
 * Agent Run Dispatcher admin API — ADR-0030 Phase 2 + Phase 5.
 *
 * Endpoints (auth required; admin OR ticket assignee for approve/deny):
 *   POST /api/v3/admin/agent-run-dispatcher/tick                  — manual tick (admin only)
 *   GET  /api/v3/admin/agent-run-dispatcher/health                — current worker state (admin)
 *   POST /api/v3/admin/agent-run-dispatcher/approve/:ticketId     — submit 6-digit code (admin or assignee)
 *   POST /api/v3/admin/agent-run-dispatcher/deny/:ticketId        — explicit deny (admin or assignee)
 *   GET  /api/v3/admin/agent-run-dispatcher/pending               — list awaiting_approval tickets (admin)
 *
 * Mount: app.use('/api/v3', authenticate, agentRunDispatcherAdminRouter).
 */

import express from 'express';

import { runTick, health, healthAsync, loadConfig } from '../../services/agent-run-dispatcher/index.js';
import {
  hashCode,
  timingSafeHashEqual,
  readApprovalState,
  recordAttempt,
  resolveApproval,
  APPROVAL_CONSTANTS,
} from '../../services/agent-run-dispatcher/approval-gate.js';
import { dbAll, dbGet } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { success, error, forbidden } from '../../utils/response.js';

const log = apiLogger.child({ module: 'agent_run_dispatcher_api' });

const TICKETS_TABLE_ID = 1708;

const router = express.Router();

router.post('/admin/agent-run-dispatcher/tick', async (req, res) => {
  if (req.user?.role !== 'admin') return forbidden(res, 'admin only');
  try {
    // Force-reload config so test runs pick up paused/limit edits without waiting 5 min.
    await loadConfig({ force: true });
    const stats = await runTick({ source: 'manual_admin' });
    return success(res, stats);
  } catch (err) {
    log.error({ err }, 'admin tick failed');
    return error(res, 'TICK_FAILED', err?.message || 'unknown', 500);
  }
});

router.get('/admin/agent-run-dispatcher/health', async (req, res) => {
  if (req.user?.role !== 'admin') return forbidden(res, 'admin only');
  // Async flavor: also returns awaitingApprovalCount via DB count.
  try {
    return success(res, await healthAsync());
  } catch (err) {
    // Never let health crash — fall back to sync.
    log.warn({ err: err.message }, 'healthAsync failed — returning sync health');
    return success(res, health());
  }
});

// ─── Phase 5 — TOTP approval gate ──────────────────────────────────

/**
 * Resolve the ticket's data → return { ticketId, data } or null if absent.
 * Used to gate approve/deny on assignee.
 */
async function fetchTicketData(ticketId) {
  const row = await dbGet(
    `SELECT data FROM table_rows WHERE table_id = $1 AND id = $2`,
    [TICKETS_TABLE_ID, ticketId]
  );
  if (!row?.data) return null;
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
}

/**
 * Allow when the user is admin OR is the ticket's assignee.
 * `assigned_to` is stored as a string (per Phase 4 brief — agent-id labels
 * are stored as ints OR labels — both are stringified in JSON). We compare
 * loosely on string form.
 */
function isAdminOrAssignee(user, ticketData) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const assignedTo = ticketData?.assigned_to;
  if (assignedTo == null || assignedTo === '') return false;
  return String(assignedTo) === String(user.id);
}

router.post('/admin/agent-run-dispatcher/approve/:ticketId', async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return error(res, 'BAD_TICKET_ID', 'ticketId must be a positive integer', 400);
  }
  const code = req.body?.code;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return error(res, 'BAD_CODE', 'code must be a 6-digit string', 400);
  }

  const data = await fetchTicketData(ticketId);
  if (!data) return error(res, 'TICKET_NOT_FOUND', 'ticket not found', 404);
  if (!isAdminOrAssignee(req.user, data)) return forbidden(res, 'admin or assignee only');

  const view = await readApprovalState(ticketId);
  if (!view.present) {
    return error(res, 'NO_PENDING_APPROVAL', 'no approval pending for this ticket', 410);
  }
  if (view.state !== 'pending') {
    return error(
      res,
      'APPROVAL_ALREADY_RESOLVED',
      `approval already ${view.state}`,
      410,
      { state: view.state }
    );
  }
  if (view.expired) {
    // Self-heal so subsequent calls see 'expired'.
    await resolveApproval(ticketId, { state: 'expired', reason: 'ttl_elapsed' }).catch(() => {});
    return error(res, 'APPROVAL_EXPIRED', 'approval window has expired', 410);
  }

  const submittedHash = hashCode(code);
  const ok = timingSafeHashEqual(submittedHash, view.code_hash || '');
  if (!ok) {
    const after = await recordAttempt(ticketId, false);
    log.info(
      { ticket_id: ticketId, attempts: after.attempts, code_hash: '<redacted>' },
      'approval code mismatch'
    );
    if (after.state === 'denied') {
      return error(
        res,
        'APPROVAL_DENIED',
        'too many failed attempts — auto-denied',
        401,
        { attempts_remaining: 0, state: 'denied' }
      );
    }
    return error(
      res,
      'APPROVAL_CODE_MISMATCH',
      'invalid code',
      401,
      { attempts_remaining: after.attempts_remaining }
    );
  }

  // Match — record attempt (success bumps attempts but does not auto-deny)
  // then resolve as approved.
  await recordAttempt(ticketId, true);
  await resolveApproval(ticketId, { state: 'approved', resolved_by: req.user?.id || null });
  log.info({ ticket_id: ticketId, resolved_by: req.user?.id }, 'approval granted');
  return success(res, { ticketId, state: 'approved' });
});

router.post('/admin/agent-run-dispatcher/deny/:ticketId', async (req, res) => {
  const ticketId = Number(req.params.ticketId);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return error(res, 'BAD_TICKET_ID', 'ticketId must be a positive integer', 400);
  }

  const data = await fetchTicketData(ticketId);
  if (!data) return error(res, 'TICKET_NOT_FOUND', 'ticket not found', 404);
  if (!isAdminOrAssignee(req.user, data)) return forbidden(res, 'admin or assignee only');

  const view = await readApprovalState(ticketId);
  if (!view.present) {
    return error(res, 'NO_PENDING_APPROVAL', 'no approval pending for this ticket', 410);
  }
  if (view.state !== 'pending') {
    return error(
      res,
      'APPROVAL_ALREADY_RESOLVED',
      `approval already ${view.state}`,
      410,
      { state: view.state }
    );
  }

  await resolveApproval(ticketId, { state: 'denied', resolved_by: req.user?.id || null, reason: 'explicit_deny' });
  log.info({ ticket_id: ticketId, resolved_by: req.user?.id }, 'approval denied (explicit)');
  return success(res, { ticketId, state: 'denied' });
});

router.get('/admin/agent-run-dispatcher/pending', async (req, res) => {
  if (req.user?.role !== 'admin') return forbidden(res, 'admin only');
  // Minimal projection — code/code_hash MUST NOT leak.
  const rows = await dbAll(
    `SELECT id,
            data->>'title'                           AS title,
            data->'run_approval'->>'expires_at'     AS expires_at,
            (data->'run_approval'->>'attempts')::int AS attempts,
            data->>'assigned_to'                     AS assigned_to
       FROM table_rows
      WHERE table_id = $1
        AND data->>'run_state' = 'awaiting_approval'
      ORDER BY id ASC
      LIMIT 200`,
    [TICKETS_TABLE_ID]
  );
  return success(res, {
    pending: rows,
    count: rows.length,
    max_attempts: APPROVAL_CONSTANTS.MAX_ATTEMPTS,
    ttl_ms: APPROVAL_CONSTANTS.TTL_MS,
  });
});

export default router;
