#!/usr/bin/env node
// ADR-0003 §C-3 smoke — regression watcher.
//
// S1: bootstrap a throwaway verified criterion + bdd_link → ticket.
// S2: fire onTicketStateTransition with oldState=done, newState=in-progress.
// S3: assert criterion.status=='regressed', regressed_by_ticket_id is set,
//     and a bdd_audit_log row exists with action='regress' + caused_by.
// S4: gate check — fire with newState=done (idempotent no-op) and with
//     wrong table id (no-op).
// S5: cleanup everything inserted by this smoke.

// ADR-0009 Phase 5: boot guard — aborts (exit 2) if POSTGRES_HOST is PROD.
import '../backend/test/setup.js';
import pg from 'pg';
import { onTicketStateTransition } from '../backend/services/bdd/regressionWatcher.js';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
});

const TICKETS_TABLE_ID = 1708;
const DONE_STATE_ID = 24278;
const INPROGRESS_STATE_ID = 24276;
const FAKE_TICKET_ID = 999999990; // never collides with a real ticket row

async function tableId(client, name) {
  const { rows } = await client.query(`
    SELECT ut.id FROM universal_tables ut
    JOIN projects p ON p.id = ut.project_id
    WHERE p.space_id = 11 AND ut.name = $1 LIMIT 1
  `, [name]);
  return rows[0]?.id;
}

async function insertRow(client, tid, data) {
  const baseId = `SMK-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
  const { rows } = await client.query(
    `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW()) RETURNING id`,
    [tid, baseId, JSON.stringify(data)]
  );
  return rows[0].id;
}

async function waitFor(predicate, { tries = 20, gapMs = 100 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true;
    await new Promise(r => setTimeout(r, gapMs));
  }
  return false;
}

async function main() {
  const client = await pool.connect();
  const created = { critRowId: null, linkRowId: null, auditRowIds: [] };
  try {
    const critTid  = await tableId(client, 'bdd_criteria');
    const linksTid = await tableId(client, 'bdd_links');
    const auditTid = await tableId(client, 'bdd_audit_log');
    if (!critTid || !linksTid || !auditTid) {
      throw new Error(`missing BDD tables (crit=${critTid}, links=${linksTid}, audit=${auditTid})`);
    }
    console.log(`bootstrap ✓ tables: crit=${critTid} links=${linksTid} audit=${auditTid}`);

    // S1: seed a verified criterion + link to FAKE_TICKET_ID
    created.critRowId = await insertRow(client, critTid, {
      code: 'SMK-C3-AC1',
      title: 'Smoke C-3 regression criterion',
      status: 'verified',
      priority: 'must',
      spec_id: null,
      source_doc_id: null,
      verified_at: new Date().toISOString(),
      totp: { last_verified_at: new Date().toISOString() },
    });
    created.linkRowId = await insertRow(client, linksTid, {
      from_kind: 'criterion',
      from_id:   created.critRowId,
      to_kind:   'ticket',
      to_id:     FAKE_TICKET_ID,
      relation:  'verifies',
    });
    console.log(`S1 ✓ criterion id=${created.critRowId} link id=${created.linkRowId} → ticket ${FAKE_TICKET_ID}`);

    // S2: fire the watcher for done → in-progress
    onTicketStateTransition(
      TICKETS_TABLE_ID,
      FAKE_TICKET_ID,
      { state: DONE_STATE_ID },
      { state: INPROGRESS_STATE_ID }
    );

    // S3: wait until criterion flips to regressed
    const flipped = await waitFor(async () => {
      const { rows } = await client.query(
        `SELECT data FROM table_rows WHERE id = $1`, [created.critRowId]
      );
      const d = rows[0]?.data;
      return d && d.status === 'regressed';
    });
    if (!flipped) throw new Error('criterion did not flip to regressed within 2s');
    const { rows: critRows } = await client.query(
      `SELECT data FROM table_rows WHERE id = $1`, [created.critRowId]
    );
    const critData = critRows[0].data;
    if (critData.regressed_by_ticket_id !== FAKE_TICKET_ID) {
      throw new Error(`regressed_by_ticket_id=${critData.regressed_by_ticket_id}, want ${FAKE_TICKET_ID}`);
    }
    console.log(`S3 ✓ status=regressed, regressed_by_ticket_id=${FAKE_TICKET_ID}, regressed_at=${critData.regressed_at}`);

    // S4: audit-log row for this regression
    const { rows: auditRows } = await client.query(
      `SELECT id, data FROM table_rows
       WHERE table_id = $1 AND data->>'caused_by' = $2
       ORDER BY id DESC LIMIT 1`,
      [auditTid, `ticket:${FAKE_TICKET_ID}:reopen`]
    );
    if (!auditRows.length) throw new Error('no bdd_audit_log row for regression');
    const ad = auditRows[0].data;
    created.auditRowIds.push(auditRows[0].id);
    const auditChecks = [
      ['action=regress',              ad.action === 'regress'],
      ['from_status=verified',        ad.from_status === 'verified'],
      ['to_status=regressed',         ad.to_status === 'regressed'],
      [`criterion_id=${created.critRowId}`, ad.criterion_id === created.critRowId],
      ['actor_kind=system',           ad.actor_kind === 'system'],
    ];
    for (const [lbl, ok] of auditChecks) {
      if (!ok) throw new Error(`S4 ✗ ${lbl}`);
      console.log(`S4 ✓ ${lbl}`);
    }

    // S5: idempotent / guard semantics
    // S5a: another done → done transition should be no-op
    onTicketStateTransition(TICKETS_TABLE_ID, FAKE_TICKET_ID,
      { state: DONE_STATE_ID }, { state: DONE_STATE_ID });
    // S5b: non-tickets table should be no-op
    onTicketStateTransition(9999, FAKE_TICKET_ID,
      { state: DONE_STATE_ID }, { state: INPROGRESS_STATE_ID });
    // S5c: old state wasn't done — no-op
    onTicketStateTransition(TICKETS_TABLE_ID, FAKE_TICKET_ID,
      { state: INPROGRESS_STATE_ID }, { state: 43438 /* rejected */ });
    // Give async handlers a window
    await new Promise(r => setTimeout(r, 300));
    const { rows: auditAfter } = await client.query(
      `SELECT COUNT(*)::int AS n FROM table_rows
       WHERE table_id = $1 AND data->>'caused_by' = $2`,
      [auditTid, `ticket:${FAKE_TICKET_ID}:reopen`]
    );
    if (auditAfter[0].n !== 1) {
      throw new Error(`expected 1 audit row after guard tests, got ${auditAfter[0].n}`);
    }
    console.log('S5 ✓ guards: same-state / non-tickets / old-state-not-done all no-op');

    console.log('\nC-3 regression-watcher smoke: ALL GREEN');
  } finally {
    // S6: cleanup
    for (const auditId of created.auditRowIds) {
      await client.query(`DELETE FROM table_rows WHERE id = $1`, [auditId]);
    }
    if (created.linkRowId) await client.query(`DELETE FROM table_rows WHERE id = $1`, [created.linkRowId]);
    if (created.critRowId) await client.query(`DELETE FROM table_rows WHERE id = $1`, [created.critRowId]);
    console.log(`cleanup ✓ removed crit=${created.critRowId} link=${created.linkRowId} audit=${created.auditRowIds.join(',')}`);
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('C-3 smoke FAILED:', e.message);
  process.exit(1);
});
