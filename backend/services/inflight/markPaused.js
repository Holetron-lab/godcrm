// ADR-0063-A · P0-A — Universal pause registry write contract.
//
// Inserts a `_inflight_runs` row with status='paused'. The dispatcher (P1) and
// watchdog (P3) call this when an in-flight agent run can no longer make
// progress and should be resumed later by an external trigger
// (scheduled message wake-up for rate-limit, callback for awaiting-input, etc).
//
// Taxonomy of `reason` (open — no DB CHECK; documented here so future callers
// pick from a known set instead of inventing strings):
//
//   paused-rate-limit         Anthropic 429 / quota exhaustion. resume_at = Date(now + retry-after).
//   paused-awaiting-input     Blocked on human reply in a chat. resume_at usually NULL.
//   paused-awaiting-dependency Blocked on another agent's output / ticket transition.
//   paused-awaiting-tool      Blocked on long-running tool / external service call.
//   paused-scheduled          Voluntary pause until a known wall-clock time (e.g. ScheduleWakeup).
//   paused-manual             Operator-initiated pause (debug, ticket re-route).
//
// Watchdog in alpha only fans out resumes for `paused-rate-limit`; other
// reasons are schema-ready, runtime-narrow (ADR-0063-A §1).

import { dbGet, isPostgres } from '../../database/connection.js';

// ADR-0063-A §3-rev P0-A2: stamp metadata.space_id so SystemTableService can
// project rows into per-space views via WHERE (metadata->>'space_id')::int = $1
// (Option A — no join through 1784, see [[project_agent_slug_routing]]).
async function resolveSpaceIdFromConv(conversation_id) {
  if (conversation_id == null) return null;
  try {
    const row = await dbGet('SELECT space_id FROM conversations WHERE id = ?', [conversation_id]);
    return row?.space_id ?? null;
  } catch {
    return null;
  }
}

const VALID_REASON_PREFIXES = ['paused-'];

function assertReasonShape(reason) {
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new TypeError('markPaused: reason must be a non-empty string');
  }
  const ok = VALID_REASON_PREFIXES.some((p) => reason.startsWith(p));
  if (!ok) {
    throw new TypeError(`markPaused: reason "${reason}" must start with paused-`);
  }
}

/**
 * Insert a `_inflight_runs` row marking an agent run as paused.
 *
 * @param {object} opts
 * @param {string} opts.agent_slug       Slug from the `1784` agents table (e.g. "developer-ralph").
 * @param {string} opts.reason           Taxonomy code; see file header.
 * @param {Date|string|null} [opts.resume_at]   When the cause is expected to clear. NULL = no scheduled wake-up.
 * @param {number|null} [opts.conversation_id]  Chat conversation the run belongs to.
 * @param {number|null} [opts.ticket_id]        Ticket the run is working on, if any.
 * @param {number|null} [opts.last_step_id]     Last `agent_steps` row id observed before pause.
 * @param {object} [opts.metadata]              Free-form JSONB blob (retry-after header, error code, etc).
 *                                              `metadata.space_id` is auto-filled from `conversations.space_id`
 *                                              when `conversation_id` is set and the caller didn't override.
 * @returns {Promise<{id: number}>} Inserted row id.
 */
export async function markPaused({
  agent_slug,
  reason,
  resume_at = null,
  conversation_id = null,
  ticket_id = null,
  last_step_id = null,
  metadata = {},
} = {}) {
  if (typeof agent_slug !== 'string' || agent_slug.length === 0) {
    throw new TypeError('markPaused: agent_slug is required');
  }
  assertReasonShape(reason);
  if (!isPostgres()) {
    throw new Error('markPaused: _inflight_runs is PG-only (see migration 062 dialect guard)');
  }

  const resumeAtParam = resume_at instanceof Date ? resume_at.toISOString() : resume_at;

  // Stamp metadata.space_id from the conversation's home space unless the
  // caller already set it. Lets the per-space projection in
  // SystemTableService filter without a join (ADR-0063-A §3-rev Option A).
  const mergedMetadata = { ...(metadata ?? {}) };
  if (mergedMetadata.space_id == null) {
    const resolved = await resolveSpaceIdFromConv(conversation_id);
    if (resolved != null) mergedMetadata.space_id = resolved;
  }
  const metadataJson = JSON.stringify(mergedMetadata);

  // ADR-0057-A WP-B — pg_notify in the SAME statement as the INSERT so the
  // notification is queued under the same transaction. If the INSERT rolls
  // back (kill -9 mid-tx, constraint violation), nothing is emitted; if it
  // commits, every `LISTEN chat_inflight` subscriber receives the delta.
  // SSE fan-out lives in streamController.js (chat stream).
  //
  // Future ADR-0042 FSM writers (markRunning / markDone / markFailed) MUST
  // mirror this same-statement pattern — see TODO at the bottom of this file.
  const row = await dbGet(
    `WITH ins AS (
       INSERT INTO _inflight_runs
         (ticket_id, agent_slug, conversation_id, last_step_id, status, reason, resume_at, metadata)
       VALUES (?, ?, ?, ?, 'paused', ?, ?, ?::jsonb)
       RETURNING id, ticket_id, agent_slug, conversation_id, status, reason, resume_at, started_at, updated_at, metadata
     )
     SELECT ins.id,
            pg_notify(
              'chat_inflight',
              json_build_object(
                'inflight_id',     ins.id,
                'conversation_id', ins.conversation_id,
                'ticket_id',       ins.ticket_id,
                'agent_slug',      ins.agent_slug,
                'status',          ins.status,
                'reason',          ins.reason,
                'resume_at',       ins.resume_at,
                'started_at',      ins.started_at,
                'paused_at',       ins.updated_at,
                'metadata',        ins.metadata,
                'source',          'markPaused'
              )::text
            ) AS notified
       FROM ins`,
    [ticket_id, agent_slug, conversation_id, last_step_id, reason, resumeAtParam, metadataJson]
  );

  return { id: row?.id };
}

// ADR-0042 FSM TODO — when `markRunning` / `markDone` / `markFailed` land,
// each MUST emit `pg_notify('chat_inflight', json_build_object(...))` inside
// the same statement that writes `_inflight_runs`. Payload shape (above) is
// the contract consumed by streamController.js SSE fan-out and by
// useInflightAgents.ts on the frontend (deferred WP-B frontend handoff).
//
// Channel name: 'chat_inflight'. Required keys: inflight_id, conversation_id,
// agent_slug, status. Optional but recommended: reason, resume_at, started_at,
// paused_at (when status='paused'), ticket_id, source (writer identity).
