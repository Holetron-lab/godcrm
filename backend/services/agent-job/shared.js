/**
 * AgentJobService — Shared helpers, constants, and internal status update functions.
 *
 * Used by create.js, query.js, webhook.js, and lifecycle.js.
 */

import { dbRun, isPostgres } from '../../database/connection.js';

// ─── TodoWrite → Plan Bridge (Ticket #81861) ────────────────────
// Claude Code agents use TodoWrite instead of manage_plan.
// Map TodoWrite status values to manage_plan status values.
export function mapTodoStatus(status) {
  if (!status) return 'pending';
  const s = String(status).toLowerCase().trim();
  if (s === 'in-progress' || s === 'in_progress') return 'in_progress';
  if (s === 'completed') return 'completed';
  if (s === 'blocked') return 'blocked';
  return 'pending';
}

// ─── CONSTANTS ───────────────────────────────────────────────────

export const JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes (matches Claude CLI timeout)
export const MAX_ATTEMPTS = 3;
export const MAX_JOB_RESTART_RETRIES = 3; // Max auto-restarts for a single conversation after server restarts
export const MAX_RECOVERY_REDISPATCH = 2;  // Max CLI processes to spawn during startup recovery (prevents server overload)

export const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// Ticket table & state constants (mirror ChainHandoffService to avoid circular import)
export const TICKETS_TABLE_ID = 1708;
export const TICKET_STATE = {
  BACKLOG: 24275,
  IN_PROGRESS: 24276,
  REVIEW: 24277,
};
export const MAX_RESTART_RETRIES = 3;

// ─── HELPERS ─────────────────────────────────────────────────────

export function safeParse(val, fallback = {}) {
  if (typeof val === 'object' && val !== null) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return fallback;
}

// ─── JOB STATUS UPDATES ─────────────────────────────────────────

/**
 * Update job status
 */
export async function updateJobStatus(jobId, status) {
  if (status === JOB_STATUS.PROCESSING) {
    await dbRun(
      isPostgres()
        ? `UPDATE agent_jobs SET status = $1, started_at = NOW(), attempts = attempts + 1 WHERE id = $2`
        : `UPDATE agent_jobs SET status = ?, started_at = datetime('now'), attempts = attempts + 1 WHERE id = ?`,
      [status, jobId]
    );
  } else {
    await dbRun(
      isPostgres()
        ? `UPDATE agent_jobs SET status = $1 WHERE id = $2`
        : `UPDATE agent_jobs SET status = ? WHERE id = ?`,
      [status, jobId]
    );
  }
}

/**
 * Mark job as completed with result
 */
export async function completeJob(jobId, resultMessage, metadata = {}) {
  await dbRun(
    isPostgres()
      ? `UPDATE agent_jobs SET status = $1, result_message = $2, result_metadata = $3, completed_at = NOW() WHERE id = $4`
      : `UPDATE agent_jobs SET status = ?, result_message = ?, result_metadata = ?, completed_at = datetime('now') WHERE id = ?`,
    [JOB_STATUS.COMPLETED, resultMessage, JSON.stringify(metadata), jobId]
  );
}

/**
 * Mark job as failed
 */
export async function failJob(jobId, errorMessage) {
  await dbRun(
    isPostgres()
      ? `UPDATE agent_jobs SET status = $1, error_message = $2, completed_at = NOW() WHERE id = $3`
      : `UPDATE agent_jobs SET status = ?, error_message = ?, completed_at = datetime('now') WHERE id = ?`,
    [JOB_STATUS.FAILED, errorMessage, jobId]
  );
}

/**
 * Update attempt count
 */
export async function updateJobAttempts(jobId, attempts) {
  await dbRun(
    isPostgres()
      ? `UPDATE agent_jobs SET attempts = $1, status = 'pending' WHERE id = $2`
      : `UPDATE agent_jobs SET attempts = ?, status = 'pending' WHERE id = ?`,
    [attempts, jobId]
  );
}
