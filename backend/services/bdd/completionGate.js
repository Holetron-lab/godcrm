// ADR-0002 §8 Phase 3 — Completion gate (G4) + computed progress (G6).
//
// Centralizes two concerns:
//   1. checkCompletionGate(ticketId) — fail-fast guard before transitioning a
//      ticket to `done`. Returns the list of unverified Must criteria so the
//      caller can return HTTP 409 with a useful body.
//   2. computeCriteriaProgress(ticketId) / recomputeAndPersistProgress —
//      derived `must_verified/must_total` for a single ticket, persisted on
//      `Tickets.data.criteria_progress` (string "M/N") so the kanban / list
//      preset can render the badge without re-aggregating in the client.
//
// Storage shape (existing convention):
//   `bdd_criteria` row data (table 7256) — `{ ticket_id, priority, status, ... }`
//   `Tickets`      row data (table 1708) — `{ state, criteria_progress, ... }`
//
// Progress is stored as the string `"<must_verified>/<must_total>"` to match
// the column type already on Tickets (text). Empty → no Must criteria linked.
//
// All reads are single SQL aggregate queries; no JS-side filter loop. The
// recompute helper is fire-and-forget when called from the table-row mutation
// hook — failures are logged but do not block writes.

import { dbGet, dbAll, dbRun, isPostgres, safeJsonParse } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

const TICKETS_TABLE_ID = 1708;
const BDD_CRITERIA_TABLE_ID = 7256;
const DONE_STATE_ID = 24278; // matches STATE.DONE in pipeline-config

/**
 * Read a single criterion row's parsed data + id.
 */
async function loadCriterion(critId) {
  const row = await dbGet(
    isPostgres()
      ? `SELECT id, data FROM table_rows WHERE id = $1 AND table_id = $2`
      : `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`,
    [critId, BDD_CRITERIA_TABLE_ID]
  );
  if (!row) return null;
  const data = safeJsonParse(row.data, {}) || {};
  return { id: row.id, data };
}

/**
 * Aggregate Must criteria for a ticket.
 *
 * Returns `{ must_total, must_verified, blockers }` where `blockers` is the
 * list of Must rows whose `status !== 'verified'`. Each blocker carries
 * `{ id, code, title }` so the API can echo them in the 409 body.
 */
export async function aggregateMustCriteria(ticketId) {
  if (ticketId == null) {
    return { must_total: 0, must_verified: 0, blockers: [] };
  }
  const ticketIdStr = String(ticketId);

  // Single SELECT, JS-side filter — keeps the SQLite path simple.
  const rows = (await dbAll(
    isPostgres()
      ? `SELECT id, data FROM table_rows
           WHERE table_id = $1
             AND data->>'ticket_id' = $2
             AND data->>'priority' = 'must'`
      : `SELECT id, data FROM table_rows
           WHERE table_id = ?
             AND json_extract(data, '$.ticket_id') = ?
             AND json_extract(data, '$.priority') = 'must'`,
    [BDD_CRITERIA_TABLE_ID, ticketIdStr]
  )) || [];

  let must_total = 0;
  let must_verified = 0;
  const blockers = [];

  for (const row of rows) {
    const data = safeJsonParse(row.data, {}) || {};
    must_total += 1;
    if (data.status === 'verified') {
      must_verified += 1;
    } else {
      blockers.push({
        id: row.id,
        code: data.code || null,
        title: data.title || null,
        status: data.status || 'pending',
      });
    }
  }

  return { must_total, must_verified, blockers };
}

/**
 * G4 — Completion gate.
 *
 * Returns `{ ok, blockers }`:
 *   ok=true  → no Must criteria OR all verified → caller proceeds
 *   ok=false → at least one Must criterion is not 'verified' → caller returns
 *              HTTP 409 with the blockers list.
 *
 * No-op for tickets without any Must criteria (must_total === 0).
 */
export async function checkCompletionGate(ticketId) {
  const { must_total, must_verified, blockers } = await aggregateMustCriteria(ticketId);
  if (must_total === 0) return { ok: true, must_total, must_verified, blockers: [] };
  if (blockers.length === 0) return { ok: true, must_total, must_verified, blockers: [] };
  return { ok: false, must_total, must_verified, blockers };
}

/**
 * G6 — Compute the progress string for a ticket. Returns an empty string when
 * no Must criteria are linked (caller may then leave the field unset).
 */
export async function computeCriteriaProgress(ticketId) {
  const { must_total, must_verified } = await aggregateMustCriteria(ticketId);
  return {
    must_total,
    must_verified,
    progress: must_total > 0 ? `${must_verified}/${must_total}` : '',
  };
}

/**
 * Persist the progress string into Tickets.data.criteria_progress, and the
 * raw numerator/denominator into `must_verified` / `must_total` so the
 * ticket-card UI can paint the badge without re-aggregating client-side.
 *
 * Idempotent: if all three values match what's already on the row, the
 * UPDATE is skipped. Failures are logged at warn level and re-thrown so the
 * caller can decide whether to swallow them (fire-and-forget) or surface.
 */
export async function recomputeAndPersistProgress(ticketId) {
  if (ticketId == null) return null;
  const ticketRow = await dbGet(
    isPostgres()
      ? `SELECT id, data FROM table_rows WHERE id = $1 AND table_id = $2`
      : `SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?`,
    [ticketId, TICKETS_TABLE_ID]
  );
  if (!ticketRow) return null;

  const data = safeJsonParse(ticketRow.data, {}) || {};
  const { progress, must_total, must_verified } = await computeCriteriaProgress(ticketId);

  // Storage convention: empty string means "no Must criteria" — we still
  // overwrite so a previously-set value clears when criteria were removed.
  // Numbers are persisted alongside the string so the UI can render badges
  // (green when must_verified === must_total > 0, amber otherwise).
  const sameProgress = data.criteria_progress === progress;
  const sameTotal = Number(data.must_total ?? 0) === must_total;
  const sameVerified = Number(data.must_verified ?? 0) === must_verified;
  if (sameProgress && sameTotal && sameVerified) {
    return { changed: false, progress, must_total, must_verified };
  }
  data.criteria_progress = progress;
  data.must_total = must_total;
  data.must_verified = must_verified;

  await dbRun(
    isPostgres()
      ? `UPDATE table_rows SET data = $1::jsonb, updated_at = NOW() WHERE id = $2`
      : `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(data), ticketRow.id]
  );

  return { changed: true, progress, must_total, must_verified };
}

/**
 * Fire-and-forget hook called from the bdd_criteria mutation path. Recomputes
 * progress for the ticket(s) referenced by an old/new criterion data pair so
 * INSERT, UPDATE (incl. ticket reassignment), and DELETE all converge.
 *
 * `oldData` may be null (INSERT), `newData` may be null (DELETE).
 */
export async function onCriterionChange(oldData, newData) {
  try {
    const oldTicket = oldData?.ticket_id;
    const newTicket = newData?.ticket_id;
    const targets = new Set();
    if (oldTicket != null && oldTicket !== '') targets.add(Number(oldTicket));
    if (newTicket != null && newTicket !== '') targets.add(Number(newTicket));
    for (const tid of targets) {
      if (!Number.isFinite(tid) || tid <= 0) continue;
      try {
        await recomputeAndPersistProgress(tid);
      } catch (err) {
        apiLogger.warn(
          { err: err.message, ticket_id: tid },
          'completionGate: recompute failed (per-ticket)'
        );
      }
    }
  } catch (err) {
    apiLogger.warn({ err: err.message }, 'completionGate.onCriterionChange swallowed');
  }
}

/**
 * Format the 409 body for the API layer.
 */
export function formatGateError(gateResult) {
  return {
    code: 'MUST_CRITERIA_INCOMPLETE',
    must_total: gateResult.must_total,
    must_verified: gateResult.must_verified,
    failed: gateResult.blockers,
  };
}

export const COMPLETION_GATE_DONE_STATE = DONE_STATE_ID;

// Re-exported helper for test reuse — accepts an already-loaded criterion id
// and returns its data without forcing the caller to know the storage shape.
export async function _internalLoadCriterion(critId) {
  return loadCriterion(critId);
}
