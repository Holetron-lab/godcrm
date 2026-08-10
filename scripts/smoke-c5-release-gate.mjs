#!/usr/bin/env node
// ADR-0003 §C-5 smoke — BDD release gate auto-publish / demote.
//
// Scenarios (all against PROD DB, inside space 11):
//   S1 bootstrap — create a throwaway documents_registry table in the BDD
//       project (marked `smoke_c5=true`) + seed a draft doc row there.
//   S2 seed BDD — one bdd_specs + two Must bdd_criteria (status=pending).
//   S3 gate red — maybeTransitionDocumentStatus returns {noop}.
//   S4 verify one — still {noop}, ready=false.
//   S5 verify both — {published: true}, registry.status flips to 'published',
//       bdd_audit_log gets action='document_publish', pg_notify emitted.
//   S6 idempotent — second call → {noop}.
//   S7 regress one — {demoted: true}, registry.status → 'regressed-published',
//       bdd_audit_log gets action='document_regress'.
//   S8 cleanup — drop the throwaway table + rows + audit entries.

// ADR-0009 Phase 5: boot guard — aborts (exit 2) if POSTGRES_HOST is PROD.
import '../backend/test/setup.js';
import pg from 'pg';
import { maybeTransitionDocumentStatus } from '../backend/services/bdd/releaseGate.js';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
});

async function bddTableId(client, name) {
  const { rows } = await client.query(`
    SELECT ut.id FROM universal_tables ut
    JOIN projects p ON p.id = ut.project_id
    WHERE p.space_id = 11 AND ut.name = $1 LIMIT 1
  `, [name]);
  return rows[0]?.id;
}

async function insert(client, tid, data, { createdBy = 1 } = {}) {
  const baseId = `SMK-C5-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
  const { rows } = await client.query(
    `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW(), NOW()) RETURNING id`,
    [tid, baseId, JSON.stringify(data), createdBy]
  );
  return rows[0].id;
}

async function patch(client, rowId, patchObj) {
  await client.query(
    `UPDATE table_rows SET data = data || $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(patchObj), rowId]
  );
}

async function main() {
  const client = await pool.connect();
  const created = {
    registryTableId: null,
    registryProjectId: null,
    docRowId: null,
    specRowId: null,
    crit1Id: null,
    crit2Id: null,
    auditRowIds: [],
  };
  try {
    // --- S1: bootstrap throwaway documents_registry table ---------------
    const { rows: projectRows } = await client.query(
      `SELECT id FROM projects WHERE space_id = 11 AND name = 'BDD / ADR-156' LIMIT 1`
    );
    const projectId = projectRows[0]?.id;
    if (!projectId) throw new Error('BDD project not found');
    created.registryProjectId = projectId;

    const throwawayName = `_smoke_c5_registry_${Date.now()}`;
    const { rows: utRows } = await client.query(`
      INSERT INTO universal_tables (project_id, name, description, icon, table_type, is_system, created_at, updated_at)
      VALUES ($1, $2, 'smoke-c5 registry', '🧪', 'documents_registry', 0, NOW(), NOW())
      RETURNING id
    `, [projectId, throwawayName]);
    created.registryTableId = utRows[0].id;
    console.log(`S1 ✓ throwaway registry table id=${created.registryTableId} name=${throwawayName}`);

    // Seed a draft doc row
    created.docRowId = await insert(client, created.registryTableId, {
      name: 'SMK-C5 draft doc',
      slug: 'smk-c5-draft',
      status: 'draft',
    });
    console.log(`S1 ✓ draft doc row id=${created.docRowId}`);

    // --- S2: seed BDD spec + two must criteria --------------------------
    const specTid  = await bddTableId(client, 'bdd_specs');
    const critTid  = await bddTableId(client, 'bdd_criteria');
    const auditTid = await bddTableId(client, 'bdd_audit_log');
    if (!specTid || !critTid || !auditTid) throw new Error('BDD tables missing');

    created.specRowId = await insert(client, specTid, {
      title: 'SMK-C5 spec',
      source_doc_id: created.docRowId,
      status: 'active',
    });
    created.crit1Id = await insert(client, critTid, {
      code: 'SMK-C5-AC1',
      title: 'must AC 1',
      spec_id: created.specRowId,
      source_doc_id: created.docRowId,
      priority: 'must',
      status: 'pending',
    });
    created.crit2Id = await insert(client, critTid, {
      code: 'SMK-C5-AC2',
      title: 'must AC 2',
      spec_id: created.specRowId,
      source_doc_id: created.docRowId,
      priority: 'must',
      status: 'pending',
    });
    console.log(`S2 ✓ spec=${created.specRowId} crit1=${created.crit1Id} crit2=${created.crit2Id}`);

    // --- S3: gate red → noop --------------------------------------------
    let r = await maybeTransitionDocumentStatus(created.docRowId, { causedBy: 'smoke:S3' });
    if (!r.noop) throw new Error(`S3 ✗ expected noop, got ${JSON.stringify(r)}`);
    console.log(`S3 ✓ gate red: ${JSON.stringify(r)}`);

    // --- S4: verify one must → still red --------------------------------
    await patch(client, created.crit1Id, { status: 'verified' });
    r = await maybeTransitionDocumentStatus(created.docRowId, { causedBy: 'smoke:S4' });
    if (!r.noop) throw new Error(`S4 ✗ expected noop, got ${JSON.stringify(r)}`);
    console.log(`S4 ✓ 1/2 verified — still ${JSON.stringify(r)}`);

    // --- S5: verify both → published ------------------------------------
    await patch(client, created.crit2Id, { status: 'verified' });
    r = await maybeTransitionDocumentStatus(created.docRowId, { causedBy: 'smoke:S5' });
    if (!r.published) throw new Error(`S5 ✗ expected published, got ${JSON.stringify(r)}`);
    console.log(`S5 ✓ gate green → published: ${JSON.stringify(r)}`);

    const { rows: regRows } = await client.query(
      `SELECT data FROM table_rows WHERE id = $1`, [created.docRowId]
    );
    const regData = regRows[0].data;
    if (regData.status !== 'published') throw new Error(`S5 ✗ registry.status=${regData.status}`);
    if (!regData.published_at) throw new Error('S5 ✗ registry.published_at not set');
    console.log(`S5 ✓ registry.status=published at ${regData.published_at}`);

    const { rows: pubAudit } = await client.query(
      `SELECT id, data FROM table_rows WHERE table_id = $1 AND data->>'action' = 'document_publish' AND (data->>'doc_id')::int = $2 ORDER BY id DESC LIMIT 1`,
      [auditTid, created.docRowId]
    );
    if (!pubAudit.length) throw new Error('S5 ✗ no document_publish audit row');
    created.auditRowIds.push(pubAudit[0].id);
    console.log(`S5 ✓ audit row id=${pubAudit[0].id} caused_by=${pubAudit[0].data.caused_by}`);

    // --- S6: idempotent — second call → noop ----------------------------
    r = await maybeTransitionDocumentStatus(created.docRowId, { causedBy: 'smoke:S6' });
    if (!r.noop) throw new Error(`S6 ✗ expected noop on re-publish, got ${JSON.stringify(r)}`);
    console.log(`S6 ✓ second call idempotent: ${JSON.stringify(r)}`);

    // --- S7: regress one must → demoted to regressed-published ----------
    await patch(client, created.crit1Id, { status: 'regressed' });
    r = await maybeTransitionDocumentStatus(created.docRowId, { causedBy: 'smoke:S7' });
    if (!r.demoted) throw new Error(`S7 ✗ expected demoted, got ${JSON.stringify(r)}`);
    const { rows: regAfter } = await client.query(
      `SELECT data FROM table_rows WHERE id = $1`, [created.docRowId]
    );
    if (regAfter[0].data.status !== 'regressed-published') {
      throw new Error(`S7 ✗ status=${regAfter[0].data.status}`);
    }
    console.log(`S7 ✓ demoted to regressed-published: ${JSON.stringify(r)}`);
    const { rows: regAudit } = await client.query(
      `SELECT id FROM table_rows WHERE table_id = $1 AND data->>'action' = 'document_regress' AND (data->>'doc_id')::int = $2 ORDER BY id DESC LIMIT 1`,
      [auditTid, created.docRowId]
    );
    if (!regAudit.length) throw new Error('S7 ✗ no document_regress audit row');
    created.auditRowIds.push(regAudit[0].id);
    console.log(`S7 ✓ audit row id=${regAudit[0].id}`);

    console.log('\nC-5 release-gate smoke: ALL GREEN');
  } finally {
    // --- S8: cleanup ----------------------------------------------------
    try {
      for (const id of created.auditRowIds) {
        await client.query(`DELETE FROM table_rows WHERE id = $1`, [id]);
      }
      for (const id of [created.crit1Id, created.crit2Id, created.specRowId, created.docRowId]) {
        if (id) await client.query(`DELETE FROM table_rows WHERE id = $1`, [id]);
      }
      if (created.registryTableId) {
        // drop columns first (there are none), then table
        await client.query(`DELETE FROM universal_tables WHERE id = $1`, [created.registryTableId]);
      }
      console.log(`cleanup ✓ audit=[${created.auditRowIds.join(',')}] rows doc=${created.docRowId} spec=${created.specRowId} crit1=${created.crit1Id} crit2=${created.crit2Id} ut=${created.registryTableId}`);
    } catch (e) {
      console.error('cleanup error:', e.message);
    }
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('C-5 smoke FAILED:', e.message);
  process.exit(1);
});
