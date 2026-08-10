// ADR-0003 §C-5 — Release gate automation.
//
// Reads `bdd_doc_gate` (Phase 5 substrate view, §6.3) after every criterion
// state change and, if all Must-priority criteria for the spec attached to
// a document are `verified`, transitions that document
//   draft → published      (and fires C-14 via onDocumentStatusTransition)
// Reverse: once a Must criterion on a published doc regresses, demote
//   published → regressed-published
// Returning from `regressed-published` to `published` is NOT auto — the AC
// §4 explicitly requires architect approval + manual /verify of every
// regressed row.
//
// Idempotent. Audit-log entries on every transition.

import { dbGet, dbRun, sqlNow } from '../../database/connection.js';
import { generateBaseId } from '../../utils/baseId.js';
import { apiLogger } from '../../utils/logger.js';
import { onDocumentStatusTransition } from '../documents/SnapshotWriter.js';
import { resolveStatusId, hasStatusIdColumn } from '../documents/statusResolver.js';

const BDD_SPACE_ID = 11;

const bddTableIds = new Map();
async function bddTableId(name) {
  if (bddTableIds.has(name)) return bddTableIds.get(name);
  const row = await dbGet(`
    SELECT ut.id FROM universal_tables ut
    JOIN projects p ON p.id = ut.project_id
    WHERE p.space_id = ? AND ut.name = ? LIMIT 1
  `, [BDD_SPACE_ID, name]);
  if (row?.id) bddTableIds.set(name, row.id);
  return row?.id || null;
}

/**
 * Find the documents_registry row that contains `docId`. We don't know the
 * registry table id up-front (there may be several), so we join through
 * universal_tables.table_type. Returns { id, table_id, data } or null.
 */
async function findRegistryRow(docId) {
  const row = await dbGet(`
    SELECT tr.id, tr.table_id, tr.data
    FROM table_rows tr
    JOIN universal_tables ut ON ut.id = tr.table_id
    WHERE ut.table_type = 'documents_registry' AND tr.id = ?
    LIMIT 1
  `, [docId]);
  if (!row) return null;
  row.data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  return row;
}

/**
 * Aggregate gate state for a single document. `bdd_doc_gate` is keyed by
 * (spec_id, source_doc_id) — a document may have >1 spec, so we aggregate.
 * A doc is `ready` iff EVERY row for that source_doc_id is ready.
 */
async function readGate(docId) {
  try {
    const row = await dbGet(`
      SELECT
        COALESCE(SUM(must_total)::int,    0) AS must_total,
        COALESCE(SUM(must_verified)::int, 0) AS must_verified,
        COALESCE(SUM(must_failed)::int,   0) AS must_failed,
        COUNT(*)::int                         AS spec_count,
        COALESCE(BOOL_AND(ready), FALSE)     AS ready
      FROM bdd_doc_gate
      WHERE source_doc_id = ?
    `, [docId]);
    return row || { must_total: 0, must_verified: 0, must_failed: 0, spec_count: 0, ready: false };
  } catch (err) {
    apiLogger.warn({ err: err.message, docId }, 'bdd_doc_gate view unavailable');
    return null;
  }
}

async function writeAuditLog(entry) {
  try {
    const tid = await bddTableId('bdd_audit_log');
    if (!tid) return;
    await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES (?, ?, ?::jsonb, ${sqlNow()}, ${sqlNow()})`,
      [tid, generateBaseId(), JSON.stringify({
        ts: new Date().toISOString(),
        actor_kind: 'system',
        ...entry,
      })]
    );
  } catch (err) {
    apiLogger.error({ err: err.message }, 'releaseGate writeAuditLog failed (non-fatal)');
  }
}

async function updateRegistryStatus(reg, newStatus, extra = {}) {
  const newData = {
    ...reg.data,
    status: newStatus,
    ...extra,
  };
  if (await hasStatusIdColumn(reg.table_id)) {
    const sid = await resolveStatusId(newStatus);
    if (sid) newData.status_id = sid;
  }
  await dbRun(
    `UPDATE table_rows
     SET data = ?::jsonb, updated_at = ${sqlNow()}
     WHERE id = ? AND table_id = ?`,
    [JSON.stringify(newData), reg.id, reg.table_id]
  );
  return newData;
}

/**
 * The entrypoint invoked from the BDD hooks (finalizeCriterion,
 * regressCriterion). Idempotent: running on an already-published doc with
 * a green gate is a no-op; running on an already-regressed-published doc
 * with a red gate is a no-op.
 *
 * @returns {Promise<{published?:boolean, demoted?:boolean, noop?:boolean, skipped?:string}>}
 */
export async function maybeTransitionDocumentStatus(docId, { causedBy = null, userId = null } = {}) {
  if (!Number.isFinite(docId)) return { skipped: 'invalid docId' };
  const reg = await findRegistryRow(docId);
  if (!reg) return { skipped: 'doc not found in documents_registry' };
  const oldStatus = String(reg.data.status || 'draft');
  const gate = await readGate(docId);
  if (!gate) return { skipped: 'bdd_doc_gate unavailable' };
  if (gate.spec_count === 0) return { skipped: 'no bdd_specs for doc', oldStatus };

  // Forward: draft → published
  if (gate.ready && oldStatus === 'draft') {
    const newData = await updateRegistryStatus(reg, 'published', {
      published_at: new Date().toISOString(),
    });
    await writeAuditLog({
      action: 'document_publish',
      doc_id: docId,
      table_id: reg.table_id,
      from_status: oldStatus,
      to_status: 'published',
      user_id: userId,
      caused_by: causedBy || 'bdd_doc_gate.ready',
    });
    onDocumentStatusTransition(reg.table_id, reg.id, reg.data, newData);
    await dbRun(`SELECT pg_notify(?, ?)`, [
      'document.published',
      JSON.stringify({
        event: 'document.published',
        doc_id: docId,
        table_id: reg.table_id,
        caused_by: causedBy || null,
        must_total: gate.must_total,
        must_verified: gate.must_verified,
      }),
    ]);
    apiLogger.info(
      { docId, tableId: reg.table_id, must_total: gate.must_total },
      'BDD release gate: document auto-published'
    );
    return { published: true, must_total: gate.must_total, must_verified: gate.must_verified };
  }

  // Reverse: published → regressed-published when gate flips red
  if (!gate.ready && oldStatus === 'published' && gate.must_total > 0) {
    const newData = await updateRegistryStatus(reg, 'regressed-published', {
      regressed_published_at: new Date().toISOString(),
    });
    await writeAuditLog({
      action: 'document_regress',
      doc_id: docId,
      table_id: reg.table_id,
      from_status: oldStatus,
      to_status: 'regressed-published',
      user_id: userId,
      caused_by: causedBy || 'must_criterion_regressed',
    });
    await dbRun(`SELECT pg_notify(?, ?)`, [
      'document.regressed',
      JSON.stringify({
        event: 'document.regressed',
        doc_id: docId,
        table_id: reg.table_id,
        caused_by: causedBy || null,
        must_total: gate.must_total,
        must_verified: gate.must_verified,
      }),
    ]);
    apiLogger.info(
      { docId, tableId: reg.table_id },
      'BDD release gate: document demoted to regressed-published'
    );
    return { demoted: true, must_total: gate.must_total, must_verified: gate.must_verified };
  }

  return { noop: true, oldStatus, ready: gate.ready };
}

export const __test__ = { findRegistryRow, readGate, updateRegistryStatus };
