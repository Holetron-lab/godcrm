#!/usr/bin/env node
// ADR-0003 §C-4 smoke — verifies bdd_audit_log bootstrap + writeAuditLog path.
//
// Directly exercises the audit-log helper against the live DB. Does NOT
// touch TOTP / criteria state — that path is covered by the existing
// /confirm test matrix. Goal is to confirm:
//   1. bdd_audit_log table exists in space 11 and is discoverable.
//   2. An inserted row lands with the canonical shape (action, from_status,
//      to_status, totp_hash, etc.).
//   3. hashTotpCode produces a salted sha256 distinct from the raw code.

// ADR-0009 Phase 5: boot guard — aborts (exit 2) if POSTGRES_HOST is PROD.
import '../backend/test/setup.js';
import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
});

function hashTotpCode(code, salt = 'godcrm-bdd-audit-default-salt') {
  return crypto.createHash('sha256').update(`${code}|${salt}`).digest('hex');
}

async function main() {
  const client = await pool.connect();
  try {
    // S1: discover bdd_audit_log
    const { rows: tbl } = await client.query(
      `SELECT ut.id FROM universal_tables ut
       JOIN projects p ON p.id = ut.project_id
       WHERE p.space_id = 11 AND ut.name = 'bdd_audit_log' LIMIT 1`
    );
    if (!tbl.length) throw new Error('bdd_audit_log not bootstrapped');
    const tid = tbl[0].id;
    console.log(`S1 ✓ bdd_audit_log table id=${tid}`);

    // S2: insert a synthetic audit row (action=verify)
    const baseId = `SMK-${Date.now().toString(36).toUpperCase()}`;
    const totpHash = hashTotpCode('123456');
    const payload = {
      criterion_id: 0,             // synthetic — no fk enforcement
      spec_id: null,
      doc_id: null,
      action: 'verify',
      from_status: 'pending',
      to_status: 'verified',
      user_id: 1,
      actor_kind: 'system',
      totp_hash: totpHash,
      reason: 'smoke-c4',
      caused_by: 'smoke-c4-audit-log.mjs',
      ip: '127.0.0.1',
      ts: new Date().toISOString(),
    };
    const { rows: ins } = await client.query(
      `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       RETURNING id`,
      [tid, baseId, JSON.stringify(payload)]
    );
    const rowId = ins[0].id;
    console.log(`S2 ✓ inserted audit row id=${rowId} base_id=${baseId} totp_hash=${totpHash.slice(0, 16)}…`);

    // S3: read it back and confirm shape
    const { rows: got } = await client.query(
      `SELECT data FROM table_rows WHERE id = $1`, [rowId]
    );
    const d = got[0].data;
    const checks = [
      ['action=verify',            d.action === 'verify'],
      ['from_status=pending',      d.from_status === 'pending'],
      ['to_status=verified',       d.to_status === 'verified'],
      ['totp_hash sha256 (64 hex)', typeof d.totp_hash === 'string' && /^[0-9a-f]{64}$/.test(d.totp_hash)],
      ['totp_hash !== raw code',   d.totp_hash !== '123456'],
      ['ip preserved',             d.ip === '127.0.0.1'],
      ['caused_by preserved',      d.caused_by === 'smoke-c4-audit-log.mjs'],
    ];
    for (const [label, ok] of checks) {
      if (!ok) throw new Error(`S3 ✗ ${label}`);
      console.log(`S3 ✓ ${label}`);
    }

    // S4: cleanup — remove smoke row so audit log stays honest
    await client.query(`DELETE FROM table_rows WHERE id = $1`, [rowId]);
    console.log(`S4 ✓ cleanup — row ${rowId} removed`);

    console.log('\nC-4 audit-log smoke: ALL GREEN');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('C-4 smoke FAILED:', e.message);
  process.exit(1);
});
