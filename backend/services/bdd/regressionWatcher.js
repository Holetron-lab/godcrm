// ADR-0003 §C-3 — Regression detection watcher.
//
// When a ticket leaves the `done` state (→ anything non-done), sweep all
// bdd_criteria linked to that ticket via bdd_links. For each criterion
// currently in state `verified`, transition it to `regressed`, write an
// append-only entry to `bdd_audit_log`, and emit
// `pg_notify('bdd.criterion.regressed', …)`.
//
// Re-verify is NOT automatic when the ticket returns to done (per AC §2):
// a human must re-issue a TOTP-signed /verify.
//
// The hook is fire-and-forget — failures are logged, never thrown. It
// runs inside tableRowMutateController.js after the tickets row has been
// committed.

import { dbGet, dbAll, dbRun, sqlNow } from '../../database/connection.js';
import { generateBaseId } from '../../utils/baseId.js';
import { apiLogger } from '../../utils/logger.js';
import { maybeTransitionDocumentStatus } from './releaseGate.js';

// Hard-pinned to the Development space tickets table (see CLAUDE.md table
// registry). If/when tickets live in multiple spaces, resolve dynamically
// by checking the table's state-column FK to 1706.
const TICKETS_TABLE_ID = 1708;
const DONE_STATE_ID = 24278; // Ticket States row 24278 "done" (is_final=true)
const BDD_SPACE_ID = 11;

const tableIdCache = new Map();
async function bddTableId(name) {
  if (tableIdCache.has(name)) return tableIdCache.get(name);
  const row = await dbGet(`
    SELECT ut.id
    FROM universal_tables ut
    JOIN projects p ON p.id = ut.project_id
    WHERE p.space_id = ? AND ut.name = ?
    LIMIT 1
  `, [BDD_SPACE_ID, name]);
  if (row?.id) tableIdCache.set(name, row.id);
  return row?.id || null;
}

async function findLinkedCriteriaForTicket(ticketId) {
  const linksTid = await bddTableId('bdd_links');
  if (!linksTid) return [];
  // bdd_links stores (from_kind, from_id) ↔ (to_kind, to_id). We accept both
  // orientations — the convention is `from=criterion, to=ticket` but
  // defensive lookup catches legacy rows.
  const rows = await dbAll(`
    SELECT
      CASE
        WHEN data->>'from_kind' = 'criterion' THEN (data->>'from_id')::bigint
        ELSE                                         (data->>'to_id')::bigint
      END AS crit_id,
      data->>'relation' AS relation
    FROM table_rows
    WHERE table_id = ?
      AND (
        (data->>'from_kind' = 'criterion' AND data->>'to_kind'   = 'ticket' AND data->>'to_id'   = ?)
        OR
        (data->>'to_kind'   = 'criterion' AND data->>'from_kind' = 'ticket' AND data->>'from_id' = ?)
      )
  `, [linksTid, String(ticketId), String(ticketId)]);
  const ids = rows
    .map(r => Number(r.crit_id))
    .filter(n => Number.isFinite(n) && n > 0);
  return Array.from(new Set(ids));
}

async function regressCriterion(critId, ticketId) {
  const critTid = await bddTableId('bdd_criteria');
  if (!critTid) return { skipped: 'no bdd_criteria table' };

  const crit = await dbGet(
    `SELECT id, data FROM table_rows WHERE table_id = ? AND id = ?`,
    [critTid, critId]
  );
  if (!crit) return { skipped: 'criterion row not found' };

  const data = typeof crit.data === 'string' ? JSON.parse(crit.data) : (crit.data || {});
  // AC §1 — only regress criteria that were actually verified. Pending /
  // failed / orphaned are left alone; reopening a ticket linked to an
  // unverified criterion is a no-op.
  if (data.status !== 'verified') return { skipped: `status=${data.status || 'unset'}` };

  const now = new Date().toISOString();
  const patch = {
    status: 'regressed',
    regressed_at: now,
    regressed_by_ticket_id: ticketId,
  };
  await dbRun(
    `UPDATE table_rows
     SET data = COALESCE(data,'{}'::jsonb) || ?::jsonb,
         updated_at = ${sqlNow()}
     WHERE table_id = ? AND id = ?`,
    [JSON.stringify(patch), critTid, critId]
  );

  const auditTid = await bddTableId('bdd_audit_log');
  if (auditTid) {
    await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES (?, ?, ?::jsonb, ${sqlNow()}, ${sqlNow()})`,
      [auditTid, generateBaseId(), JSON.stringify({
        criterion_id: critId,
        spec_id:      data.spec_id ?? null,
        doc_id:       data.source_doc_id ?? null,
        action:       'regress',
        from_status:  'verified',
        to_status:    'regressed',
        user_id:      null,
        actor_kind:   'system',
        totp_hash:    null,
        reason:       null,
        caused_by:    `ticket:${ticketId}:reopen`,
        ip:           null,
        ts:           now,
      })]
    );
  }

  await dbRun(
    `SELECT pg_notify(?, ?)`,
    ['bdd.criterion.regressed', JSON.stringify({
      event: 'bdd.criterion.regressed',
      criterion_id: critId,
      spec_id: data.spec_id ?? null,
      doc_id: data.source_doc_id ?? null,
      caused_by_ticket_id: ticketId,
      at: now,
    })]
  );

  // ADR-0003 §C-5: if the regressed criterion belongs to a published doc and
  // is Must-priority, the document demotes to `regressed-published`. Safe to
  // call on any regression — no-op when the gate stays green.
  const docId = Number(data.source_doc_id);
  if (Number.isFinite(docId) && docId > 0) {
    maybeTransitionDocumentStatus(docId, {
      causedBy: `bdd.criterion.regressed:${critId}:ticket:${ticketId}`,
    }).catch((err) => {
      apiLogger.error({ err: err.message, docId, critId }, 'release gate demote hook failed (non-fatal)');
    });
  }

  return { regressed: true };
}

/**
 * Fire-and-forget hook for tableRowMutateController PUT handler. Detects
 * `done → non-done` ticket transitions and regresses linked verified
 * criteria. No-op for every other table / transition.
 */
export function onTicketStateTransition(tableId, rowId, oldData = {}, newData = {}) {
  if (Number(tableId) !== TICKETS_TABLE_ID) return;
  const oldState = Number(oldData?.state);
  const newState = Number(newData?.state);
  if (oldState !== DONE_STATE_ID) return;
  if (newState === DONE_STATE_ID) return;
  // Reject-state (43438) is also a final state — AC explicitly targets the
  // `done → in-progress/backlog/review/…` reopen flow. Going `done → rejected`
  // is a semantic close, not a regression. Ignore.
  const REJECTED_STATE_ID = 43438;
  if (newState === REJECTED_STATE_ID) return;

  (async () => {
    try {
      const critIds = await findLinkedCriteriaForTicket(Number(rowId));
      if (!critIds.length) return;
      const results = [];
      for (const cid of critIds) {
        const r = await regressCriterion(cid, Number(rowId));
        results.push({ criterion_id: cid, ...r });
      }
      const regressed = results.filter(r => r.regressed).length;
      if (regressed > 0) {
        apiLogger.info(
          { ticketId: rowId, oldState, newState, regressed, total: results.length },
          'BDD regression sweep fired'
        );
      }
    } catch (err) {
      apiLogger.error(
        { err: err.message, ticketId: rowId, oldState, newState },
        'onTicketStateTransition sweep failed'
      );
    }
  })();
}

// Exported for smoke tests that want deterministic semantics.
export const __test__ = {
  findLinkedCriteriaForTicket,
  regressCriterion,
  TICKETS_TABLE_ID,
  DONE_STATE_ID,
};
