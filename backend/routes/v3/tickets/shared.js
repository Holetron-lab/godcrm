/**
 * Tickets Shared — State machine constants, helpers, and cascade logic
 * Used by crud.js, dispatch.js, execution.js, chains.js
 */

import ChainHandoffService from '../../../services/ChainHandoffService.js';
import { dbGet, dbAll, dbRun, isPostgres, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';

// ===== STATE MACHINE (Phase 1 — 7 states) =====

/**
 * Full 7-state workflow (ADR-098 Phase 1):
 *   backlog → assigned → in_progress → review → control → done
 *                                                  ↓
 *                                              rejected → in_progress (rework)
 */
export const STATE_MAP = {
  'backlog':     24275,
  'assigned':    43436,   // orchestrator assigns
  'in_progress': 24276,   // agent picks up
  'review':      24277,   // agent submits for review
  'control':     43437,   // QA passed, awaiting human approval
  'rejected':    43438,   // human rejected
  'done':        24278,   // human approved (terminal)
};

/** Reverse lookup: state ID → name */
export const STATE_NAMES = Object.fromEntries(
  Object.entries(STATE_MAP).map(([k, v]) => [v, k])
);

/**
 * Allowed transitions (Phase 1 — 7 states):
 *   backlog     → assigned                        (orchestrator dispatches)
 *   assigned    → in_progress, backlog            (agent picks up, or return)
 *   in_progress → review, backlog                 (agent submits, or pause)
 *   review      → control, in_progress            (QA ok, or rework)
 *   control     → done, rejected                  (HUMAN ONLY!)
 *   rejected    → in_progress                     (agent reworks)
 *   done        → (terminal)
 */
export const TRANSITIONS = {
  [STATE_MAP.backlog]:     [STATE_MAP.assigned, STATE_MAP.in_progress],  // in_progress allowed for backward compat
  [STATE_MAP.assigned]:    [STATE_MAP.in_progress, STATE_MAP.backlog],
  [STATE_MAP.in_progress]: [STATE_MAP.review, STATE_MAP.backlog],
  [STATE_MAP.review]:      [STATE_MAP.control, STATE_MAP.in_progress],
  [STATE_MAP.control]:     [STATE_MAP.done, STATE_MAP.rejected],         // HUMAN ONLY
  [STATE_MAP.rejected]:    [STATE_MAP.in_progress],
  [STATE_MAP.done]:        [], // terminal
};

/**
 * States that require human user_type OR supervisor to transition FROM.
 * Control gate: only user_type='human' or supervisor agents can move tickets from 'control' state.
 * ADR-109: Supervisor bypass — Nikich (user_id=53) can approve/reject at control gate.
 */
export const HUMAN_ONLY_STATES = new Set([STATE_MAP.control]);

/** ADR-109: Supervisor agent IDs allowed to bypass control gate */
export const SUPERVISOR_AGENT_IDS = new Set([53]); // Nikich — from SUPERVISOR_CONFIG

export const TICKETS_TABLE_ID = 1708;

// ===== HELPERS =====

/**
 * Resolve state: accept name (string) or ID (number).
 * @returns {{ stateId: number, error: string|null }}
 */
export function resolveState(newState) {
  if (typeof newState === 'string') {
    const stateId = STATE_MAP[newState.toLowerCase()];
    if (!stateId) {
      return {
        stateId: null,
        error: `Unknown state: '${newState}'. Valid: ${Object.keys(STATE_MAP).join(', ')}`,
      };
    }
    return { stateId, error: null };
  }

  if (typeof newState === 'number') {
    if (!STATE_NAMES[newState]) {
      return {
        stateId: null,
        error: `Unknown state ID: ${newState}. Valid: ${Object.values(STATE_MAP).join(', ')}`,
      };
    }
    return { stateId: newState, error: null };
  }

  return { stateId: null, error: 'new_state must be a string (state name) or number (state ID)' };
}

// ===== ADR-077 Task #7: STATUS DIRECTIVE PARSER =====

/**
 * Parse agent message content for a status directive.
 *
 * Recognized patterns:
 *   "Status: Done"       → { targetState: 'review', rawStatus: 'done' }
 *   "Status: Review"     → { targetState: 'review', rawStatus: 'review' }
 *   "Status: In Progress"→ { targetState: 'in_progress', rawStatus: 'in progress' }
 *   "Status: Backlog"    → { targetState: 'backlog', rawStatus: 'backlog' }
 *   <promise>COMPLETE</promise>           → { targetState: 'review', rawStatus: 'complete' }
 *   <promise>ADR IMPLEMENTATION COMPLETE</promise> → { targetState: 'review', rawStatus: 'complete' }
 *
 * Case-insensitive. Returns null if no directive found.
 *
 * @param {string|null|undefined} content - Message content
 * @returns {{ targetState: string, rawStatus: string }|null}
 */
export function parseStatusDirective(content) {
  if (!content) return null;

  // Check for <promise>...</promise> tag (COMPLETE variants)
  const promiseMatch = content.match(/<promise>([\s\S]*?)<\/promise>/i);
  if (promiseMatch) {
    const inner = promiseMatch[1].trim().toUpperCase();
    if (inner === 'COMPLETE' || inner.includes('COMPLETE')) {
      return { targetState: 'review', rawStatus: 'complete' };
    }
  }

  // Check for "Status: <value>" directive
  const statusMatch = content.match(/\bstatus\s*:\s*(.+?)(?:\n|$)/i);
  if (!statusMatch) return null;

  const rawStatus = statusMatch[1].trim().toLowerCase();

  const STATUS_TO_STATE = {
    'done':        'review',       // agent marks done → submit for human review
    'review':      'review',
    'in progress': 'in_progress',
    'in_progress': 'in_progress',
    'backlog':     'backlog',
    'rejected':    'rejected',
  };

  const targetState = STATUS_TO_STATE[rawStatus];
  if (!targetState) return null;

  return { targetState, rawStatus };
}

// ===== CASCADE UPDATES (Phase 1 — ADR-098) =====

/**
 * Execute cascade updates when ticket status changes.
 * 5 levels: ticket → chain → ADR → notification → audit
 */
export async function executeCascade({ ticketId, oldState, newState, agentId, ticket }) {
  const cascadeResults = { levels: [] };

  try {
    // Level 1: Ticket-level — set dates and progress
    if (newState === STATE_MAP.in_progress) {
      await setTicketField(ticketId, 'scheduled_date', new Date().toISOString());
      cascadeResults.levels.push({ level: 1, action: 'scheduled_date_set' });
    }
    if (newState === STATE_MAP.done) {
      await setTicketField(ticketId, 'progress', 100);
      cascadeResults.levels.push({ level: 1, action: 'progress_set_100' });
    }
    if (newState === STATE_MAP.rejected) {
      await setTicketField(ticketId, 'progress', 0);
      cascadeResults.levels.push({ level: 1, action: 'progress_reset_0' });
    }

    // Level 2: Chain-level — recalculate chain progress
    const chainId = ticket?._chain?.chain_id;
    if (chainId) {
      try {
        const chainStatus = await ChainHandoffService.getChainStatus(chainId);
        cascadeResults.levels.push({
          level: 2,
          action: 'chain_progress_recalculated',
          chain_id: chainId,
          progress_pct: chainStatus.progress?.percent_complete,
        });
      } catch (err) {
        apiLogger.warn({ err, chainId }, 'Cascade: Chain progress recalc failed');
      }
    }

    // Level 3: ADR-level — recalculate ADR status from tickets
    const adrRef = ticket?.adr_ref;
    if (adrRef) {
      try {
        await recalcADRStatus(adrRef, ticketId);
        cascadeResults.levels.push({
          level: 3,
          action: 'adr_status_recalculated',
          adr_ref: adrRef,
        });
      } catch (err) {
        apiLogger.warn({ err, adrRef }, 'Cascade: ADR status recalc failed');
      }
    }

    // Level 4: Cross-chat notification — notify parent planning chat
    const notifyStates = [STATE_MAP.review, STATE_MAP.control, STATE_MAP.done, STATE_MAP.rejected];
    if (notifyStates.includes(newState)) {
      try {
        await postCrossChatNotification({ ticketId, oldState, newState, agentId, ticket });
        cascadeResults.levels.push({ level: 4, action: 'cross_chat_notification_sent' });
      } catch (err) {
        apiLogger.warn({ err, ticketId }, 'Cascade: Cross-chat notification failed');
      }
    }

    // Level 5: Audit — already handled by ChainHandoffService.updateTicketStatus → logActivity
    cascadeResults.levels.push({ level: 5, action: 'activity_logged' });

  } catch (err) {
    apiLogger.error({ err, ticketId }, 'Cascade: Execution error');
  }

  return cascadeResults;
}

/**
 * Update a single field in ticket data JSON.
 */
async function setTicketField(ticketId, field, value) {
  const row = await dbGet(
    isPostgres()
      ? `SELECT data FROM table_rows WHERE id = $1 AND table_id = $2`
      : `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
    [ticketId, TICKETS_TABLE_ID]
  );
  if (!row) return;

  const data = safeJsonParse(row.data, {});
  data[field] = value;

  await dbRun(
    isPostgres()
      ? `UPDATE table_rows SET data = $1::jsonb, updated_at = NOW() WHERE id = $2`
      : `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(data), ticketId]
  );
}

/**
 * Post a notification to the parent planning chat (bound conversation of the dispatching ticket).
 * ADR-098 Phase 1: Cross-chat notifications.
 */
async function postCrossChatNotification({ ticketId, oldState, newState, agentId, ticket }) {
  const parentTicketId = ticket?._chain?.parent_ticket_id;
  const targetTableId = TICKETS_TABLE_ID;

  const searchId = parentTicketId || ticketId;
  const conversation = await dbGet(
    isPostgres()
      ? `SELECT id FROM conversations WHERE bound_table_id = $1 AND bound_row_id = $2 LIMIT 1`
      : `SELECT id FROM conversations WHERE bound_table_id = ? AND bound_row_id = ? LIMIT 1`,
    [targetTableId, searchId]
  );

  if (!conversation) return;

  const oldName = STATE_NAMES[oldState] || String(oldState);
  const newName = STATE_NAMES[newState] || String(newState);
  const what = ticket?.what || `Ticket #${ticketId}`;

  const emoji = {
    [STATE_MAP.review]: '\u{1F4CB}',
    [STATE_MAP.control]: '\u{1F512}',
    [STATE_MAP.done]: '\u{2705}',
    [STATE_MAP.rejected]: '\u{274C}',
  };

  const content = `${emoji[newState] || '\u{1F514}'} **Status Update**: Ticket #${ticketId}\n` +
    `**${what}**\n` +
    `${oldName} \u{2192} **${newName}**` +
    (newState === STATE_MAP.control ? '\n\n\u{26A0}\u{FE0F} **Human approval required** \u{2014} only a human user can approve or reject this ticket.' : '');

  await dbRun(
    isPostgres()
      ? `INSERT INTO messages (conversation_id, user_id, content, content_type, created_at)
         VALUES ($1, $2, $3, 'system', NOW())`
      : `INSERT INTO messages (conversation_id, user_id, content, content_type, created_at)
         VALUES (?, ?, ?, 'system', datetime('now'))`,
    [conversation.id, agentId || 1, content]
  );
}

/**
 * Recalculate ADR document status based on linked tickets.
 */
async function recalcADRStatus(adrRef, triggeredByTicketId) {
  const allTickets = await dbAll(
    isPostgres()
      ? `SELECT id, data FROM table_rows WHERE table_id = $1 AND data::text LIKE $2`
      : `SELECT id, data FROM table_rows WHERE table_id = ? AND data LIKE ?`,
    [TICKETS_TABLE_ID, `%"adr_ref":${adrRef}%`]
  );

  if (allTickets.length === 0) return;

  let totalTickets = 0;
  let doneTickets = 0;
  let inProgressTickets = 0;

  for (const row of allTickets) {
    const data = safeJsonParse(row.data, {});
    if (String(data.adr_ref) !== String(adrRef)) continue;
    totalTickets++;
    if (data.state === STATE_MAP.done) doneTickets++;
    else if ([STATE_MAP.in_progress, STATE_MAP.assigned, STATE_MAP.review, STATE_MAP.control].includes(data.state)) inProgressTickets++;
  }

  if (totalTickets === 0) return;

  let adrStatus;
  if (doneTickets === totalTickets) {
    adrStatus = 'IMPLEMENTED';
  } else if (inProgressTickets > 0 || doneTickets > 0) {
    adrStatus = 'IN_PROGRESS';
  } else {
    adrStatus = 'PROPOSED';
  }

  const DOCUMENTS_TABLE_ID = 2197;
  const adrDoc = await dbGet(
    isPostgres()
      ? `SELECT id, data FROM table_rows WHERE table_id = $1 AND id = $2`
      : `SELECT id, data FROM table_rows WHERE table_id = ? AND id = ?`,
    [DOCUMENTS_TABLE_ID, adrRef]
  );

  if (adrDoc) {
    const docData = safeJsonParse(adrDoc.data, {});
    const oldStatus = docData.status;
    if (oldStatus !== adrStatus) {
      docData.status = adrStatus;
      docData.implementation_progress = {
        total: totalTickets,
        done: doneTickets,
        percent: Math.round((doneTickets / totalTickets) * 100),
        updated_at: new Date().toISOString(),
        triggered_by: triggeredByTicketId,
      };

      await dbRun(
        isPostgres()
          ? `UPDATE table_rows SET data = $1::jsonb, updated_at = NOW() WHERE id = $2`
          : `UPDATE table_rows SET data = ?, updated_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(docData), adrDoc.id]
      );

      apiLogger.info({ adrRef, oldStatus, newStatus: adrStatus, progress: `${doneTickets}/${totalTickets}` },
        'ADR status cascade: updated');
    }
  }
}
