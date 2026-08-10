/**
 * ADR-0030 Phase 5 — TOTP Approval Gate.
 *
 * Pure module. Generates a 6-digit one-time approval code, stores its sha256
 * hash + expiry on the ticket row at `data.run_approval`, and exposes a
 * polling helper that blocks until the approval state resolves.
 *
 * Single source of truth = the ticket row. No new table.
 *
 * Security:
 *   - Codes are generated with `crypto.randomInt(100000, 1000000)` —
 *     cryptographically strong; ~20 bits of entropy. Combined with 5-attempt
 *     auto-deny + 10-min TTL this is acceptable for a chat-confirmation flow.
 *   - We NEVER store or log the plaintext. Only sha256 hash (hex).
 *   - Hash comparison is timing-safe via `crypto.timingSafeEqual` on
 *     identically-sized Buffers.
 *
 * Stored shape on `data.run_approval` (JSONB object):
 *   {
 *     code_hash:     "<sha256 hex>",        // never the plaintext
 *     expires_at:    "<ISO+10min>",
 *     generated_at:  "<ISO>",
 *     attempts:      0,                      // max 5 → auto-deny
 *     state:         "pending"|"approved"|"denied"|"expired",
 *     resolved_at:   "<ISO>"|null,
 *     resolved_by:   <user_id>|null
 *   }
 *
 * Companion field on ticket: `data.run_state` flips to 'awaiting_approval'
 * when persistApprovalRequest runs, and is restored to 'preparing' on
 * approve / 'failed' on deny|expired by resolveApproval.
 *
 * @see ADR-0030 §6 Phase 5 deliverables.
 */

import { randomInt, createHash, timingSafeEqual } from 'node:crypto';

import { dbGet, dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'approval_gate' });

const TICKETS_TABLE_ID = 1708;
const APPROVAL_TTL_MS = 10 * 60 * 1000;        // 10 minutes
const MAX_ATTEMPTS = 5;
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;     // 10 min — matches TTL

// Public terminal outcomes for awaitApproval. Anything else is a bug.
export const APPROVAL_OUTCOMES = Object.freeze({
  APPROVED: 'approved',
  DENIED: 'denied',
  EXPIRED: 'expired',
});

/**
 * Generate a fresh 6-digit code + its sha256 hash + expiry timestamp.
 * Returned `code` is the ONLY plaintext that ever exists — it must be
 * forwarded immediately to the chat post and then dropped from memory.
 *
 * @returns {{ code: string, code_hash: string, expires_at: string, generated_at: string }}
 */
export function generateApprovalCode() {
  // randomInt is half-open: [min, max). Range 100000..999999 inclusive.
  const num = randomInt(100000, 1_000_000);
  // Defensive padStart in case future ranges include leading zeros.
  const code = String(num).padStart(6, '0');
  const generated_at = new Date().toISOString();
  const expires_at = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  return {
    code,
    code_hash: hashCode(code),
    expires_at,
    generated_at,
  };
}

/**
 * sha256 hex of input string. Used both at generate-time and at
 * verification-time; equality is checked via timingSafeEqual on Buffers.
 */
export function hashCode(code) {
  return createHash('sha256').update(String(code), 'utf8').digest('hex');
}

/**
 * Constant-time equality of two sha256 hex strings.
 * Caller must ensure both are 64-char hex; otherwise we return false
 * without comparing (timingSafeEqual throws on length mismatch).
 */
export function timingSafeHashEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== 64 || b.length !== 64) return false;
  let bufA;
  let bufB;
  try {
    bufA = Buffer.from(a, 'hex');
    bufB = Buffer.from(b, 'hex');
  } catch {
    return false;
  }
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Persist the approval request on the ticket row and flip run_state to
 * 'awaiting_approval'. Atomic: single jsonb-merge UPDATE.
 *
 * Caller already holds the ticket via the dispatcher claim — no extra lock
 * required. On other invocations we'd want SELECT … FOR UPDATE first.
 *
 * NOTE: never accepts the plaintext code — only the hash + metadata.
 */
export async function persistApprovalRequest(ticketId, { code_hash, expires_at, generated_at }) {
  if (!ticketId) throw new Error('persistApprovalRequest: ticketId required');
  if (!code_hash || code_hash.length !== 64) {
    throw new Error('persistApprovalRequest: code_hash must be 64-char sha256 hex');
  }
  if (!expires_at) throw new Error('persistApprovalRequest: expires_at required');
  if (!generated_at) throw new Error('persistApprovalRequest: generated_at required');

  const approval = {
    code_hash,
    expires_at,
    generated_at,
    attempts: 0,
    state: 'pending',
    resolved_at: null,
    resolved_by: null,
  };

  await dbRun(
    `UPDATE table_rows
        SET data = data
                   || jsonb_build_object(
                        'run_approval', $2::jsonb,
                        'run_state',    'awaiting_approval',
                        'run_last_event_at', $3::text
                      ),
            updated_at = NOW()
      WHERE table_id = $1 AND id = $4`,
    [TICKETS_TABLE_ID, JSON.stringify(approval), new Date().toISOString(), ticketId]
  );

  log.info(
    { ticket_id: ticketId, expires_at, code_hash: '<redacted>' },
    'approval request persisted'
  );
}

/**
 * Read current approval state for the ticket. Returns a normalised view:
 *
 *   {
 *     present: boolean,            // false if data.run_approval is missing
 *     state: string,               // 'pending'|'approved'|'denied'|'expired'
 *     attempts: number,
 *     expires_at: string|null,
 *     code_hash: string|null,      // present so route handler can compare
 *     run_state: string|null,
 *     expired: boolean             // true if expires_at < now and state==='pending'
 *   }
 */
export async function readApprovalState(ticketId) {
  const row = await dbGet(
    `SELECT data->'run_approval' AS approval,
            data->>'run_state'   AS run_state
       FROM table_rows
      WHERE table_id = $1 AND id = $2`,
    [TICKETS_TABLE_ID, ticketId]
  );
  const raw = row?.approval;
  const approval = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!approval) {
    return {
      present: false,
      state: null,
      attempts: 0,
      expires_at: null,
      code_hash: null,
      run_state: row?.run_state || null,
      expired: false,
    };
  }
  const now = Date.now();
  const expMs = approval.expires_at ? Date.parse(approval.expires_at) : NaN;
  const expired =
    approval.state === 'pending' &&
    Number.isFinite(expMs) &&
    expMs <= now;
  return {
    present: true,
    state: approval.state || 'pending',
    attempts: Number(approval.attempts) || 0,
    expires_at: approval.expires_at || null,
    code_hash: approval.code_hash || null,
    run_state: row?.run_state || null,
    expired,
  };
}

/**
 * Increment the attempts counter. If `success` is false AND attempts reach
 * MAX_ATTEMPTS, also flip state to 'denied' (and run_state to 'failed') so
 * the dispatcher's awaitApproval poll resolves with 'denied'.
 *
 * Returns the post-update view (attempts, state, attempts_remaining).
 */
export async function recordAttempt(ticketId, success) {
  // Increment then check via single round-trip.
  const incRow = await dbGet(
    `UPDATE table_rows
        SET data = jsonb_set(
                     data,
                     '{run_approval,attempts}',
                     to_jsonb(COALESCE((data->'run_approval'->>'attempts')::int, 0) + 1),
                     true
                   ),
            updated_at = NOW()
      WHERE table_id = $1 AND id = $2
      RETURNING (data->'run_approval'->>'attempts')::int AS attempts,
                data->'run_approval'->>'state'           AS state`,
    [TICKETS_TABLE_ID, ticketId]
  );
  const attempts = Number(incRow?.attempts) || 0;
  let state = incRow?.state || 'pending';

  if (!success && attempts >= MAX_ATTEMPTS && state === 'pending') {
    // Auto-deny after too many wrong attempts.
    await resolveApproval(ticketId, { state: 'denied', resolved_by: null, reason: 'max_attempts' });
    state = 'denied';
    log.warn(
      { ticket_id: ticketId, attempts },
      'approval auto-denied after max attempts'
    );
  }

  return {
    attempts,
    state,
    attempts_remaining: Math.max(0, MAX_ATTEMPTS - attempts),
  };
}

/**
 * Mark approval as approved/denied/expired and flip ticket run_state
 * accordingly:
 *   - approved → run_state = 'preparing' (dispatcher will continue to running)
 *   - denied   → run_state = 'failed', run_terminal_reason = 'approval_denied'
 *   - expired  → run_state = 'failed', run_terminal_reason = 'approval_timeout'
 *
 * Idempotent: calling twice with the same state is a no-op (the second
 * resolved_at simply overwrites — that's fine for this flow).
 */
export async function resolveApproval(ticketId, { state, resolved_by = null, reason = null } = {}) {
  if (!['approved', 'denied', 'expired'].includes(state)) {
    throw new Error(`resolveApproval: invalid state ${state}`);
  }
  const now = new Date().toISOString();

  // Update run_approval sub-object first.
  await dbRun(
    `UPDATE table_rows
        SET data = jsonb_set(
                     jsonb_set(
                       jsonb_set(
                         data,
                         '{run_approval,state}',
                         to_jsonb($2::text),
                         true
                       ),
                       '{run_approval,resolved_at}',
                       to_jsonb($3::text),
                       true
                     ),
                     '{run_approval,resolved_by}',
                     COALESCE(to_jsonb($4::int), 'null'::jsonb),
                     true
                   ),
            updated_at = NOW()
      WHERE table_id = $1 AND id = $5`,
    [TICKETS_TABLE_ID, state, now, resolved_by, ticketId]
  );

  // Flip ticket run_state in a second write — keeps the SQL readable, and
  // run_state lives at the top level so we can't merge it inline cleanly.
  if (state === 'approved') {
    await dbRun(
      `UPDATE table_rows
          SET data = data || jsonb_build_object(
                       'run_state', 'preparing',
                       'run_last_event_at', $2::text
                     ),
              updated_at = NOW()
        WHERE table_id = $1 AND id = $3`,
      [TICKETS_TABLE_ID, now, ticketId]
    );
  } else {
    const terminalReason = state === 'expired' ? 'approval_timeout' : 'approval_denied';
    await dbRun(
      `UPDATE table_rows
          SET data = data || jsonb_build_object(
                       'run_state', 'failed',
                       'run_terminal_reason', $2::text,
                       'run_finished_at', $3::text,
                       'run_last_event_at', $3::text
                     ),
              updated_at = NOW()
        WHERE table_id = $1 AND id = $4`,
      [TICKETS_TABLE_ID, terminalReason, now, ticketId]
    );
  }

  log.info(
    { ticket_id: ticketId, state, reason, resolved_by },
    'approval resolved'
  );
}

/**
 * Block until the approval state resolves to approved / denied / expired.
 * Polls every `pollMs` ms; returns immediately if state is already terminal
 * or the stored expires_at is in the past (in which case we self-resolve to
 * 'expired' so the ticket reflects reality).
 *
 * Hard ceiling: `timeoutMs`. If we hit it before any state resolution, we
 * resolve as 'expired' and return.
 *
 * Returns: { outcome: 'approved'|'denied'|'expired', attempts: number }
 */
export async function awaitApproval(ticketId, { pollMs = DEFAULT_POLL_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  let lastAttempts = 0;

  while (true) {
    const view = await readApprovalState(ticketId);
    lastAttempts = view.attempts;

    if (!view.present) {
      // Approval row missing — treat as expired (someone wiped it externally).
      log.warn({ ticket_id: ticketId }, 'awaitApproval: run_approval missing — resolving as expired');
      await resolveApproval(ticketId, { state: 'expired', reason: 'missing_state' }).catch(() => {});
      return { outcome: APPROVAL_OUTCOMES.EXPIRED, attempts: lastAttempts };
    }

    if (view.state === 'approved') {
      return { outcome: APPROVAL_OUTCOMES.APPROVED, attempts: lastAttempts };
    }
    if (view.state === 'denied') {
      return { outcome: APPROVAL_OUTCOMES.DENIED, attempts: lastAttempts };
    }
    if (view.state === 'expired' || view.expired) {
      // Persist the 'expired' state if it's still nominally 'pending'.
      if (view.state === 'pending') {
        await resolveApproval(ticketId, { state: 'expired', reason: 'ttl_elapsed' }).catch(() => {});
      }
      return { outcome: APPROVAL_OUTCOMES.EXPIRED, attempts: lastAttempts };
    }

    // Hard timeout safety net (should normally fire via expires_at first).
    if (Date.now() - startedAt >= timeoutMs) {
      log.warn(
        { ticket_id: ticketId, timeoutMs },
        'awaitApproval: hard timeoutMs reached — resolving expired'
      );
      await resolveApproval(ticketId, { state: 'expired', reason: 'hard_timeout' }).catch(() => {});
      return { outcome: APPROVAL_OUTCOMES.EXPIRED, attempts: lastAttempts };
    }

    await new Promise((r) => setTimeout(r, pollMs).unref?.());
  }
}

export const APPROVAL_CONSTANTS = Object.freeze({
  TTL_MS: APPROVAL_TTL_MS,
  MAX_ATTEMPTS,
});

export default {
  generateApprovalCode,
  hashCode,
  timingSafeHashEqual,
  persistApprovalRequest,
  readApprovalState,
  recordAttempt,
  resolveApproval,
  awaitApproval,
  APPROVAL_OUTCOMES,
  APPROVAL_CONSTANTS,
};
