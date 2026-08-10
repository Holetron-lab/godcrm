// Migration 086: ADR-0066-A — Tamper-evident hash chain over `audit_log`.
//
// Additive follow-on to ADR-0066 P0 (migration 066). Two more nullable
// BYTEA columns on `audit_log` + a tiny `audit_chain_meta` table holding
// the cutover id. Existing rows are untouched; both columns start NULL.
//
// Chain semantics (ADR-0066-A §A/§E):
//   - prev_hash  : entry_hash of the immediately preceding CHAINED row.
//                  NULL on the genesis row (first row written post-cutover).
//   - entry_hash : sha256(version ‖ prev_hash ‖ canonical(row)) — see
//                  backend/services/audit/auditChain.js.
//   - cutover_id : COALESCE(MAX(id),0) at migration time. Rows with
//                  id <= cutover_id predate the chain and are excluded
//                  from verification (re-hashing history proves nothing).
//                  The chain covers strictly id > cutover_id.
//
// Idempotent (ADD COLUMN / CREATE ... IF NOT EXISTS, INSERT ... ON
// CONFLICT DO NOTHING) so a retried partial apply is safe — and the
// cutover id is recorded exactly once, never overwritten on re-run.
//
// PG-only: dialect guard mirrors 066.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 086] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS prev_hash  BYTEA,
      ADD COLUMN IF NOT EXISTS entry_hash BYTEA
  `);

  // Hot-path append reads the current chain head:
  //   SELECT entry_hash ... WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1
  // A tiny partial index makes that O(1) regardless of table size.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_chain_head
      ON audit_log (id DESC) WHERE entry_hash IS NOT NULL
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS audit_chain_meta (
      key        TEXT PRIMARY KEY,
      value      BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Record cutover once. ON CONFLICT DO NOTHING keeps a re-run from
  // moving the cutover forward over already-chained rows.
  await knex.raw(`
    INSERT INTO audit_chain_meta (key, value)
    VALUES ('cutover_id', (SELECT COALESCE(MAX(id), 0) FROM audit_log))
    ON CONFLICT (key) DO NOTHING
  `);

  const row = await knex.raw(
    `SELECT value FROM audit_chain_meta WHERE key = 'cutover_id'`
  );
  const cutover = row?.rows?.[0]?.value;
  console.log(
    `[Migration 086] audit_log hash chain ready: +2 nullable BYTEA columns, ` +
      `+1 partial index, audit_chain_meta.cutover_id=${cutover} (ADR-0066-A)`
  );
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP TABLE IF EXISTS audit_chain_meta`);
  await knex.raw(`DROP INDEX IF EXISTS idx_audit_log_chain_head`);
  await knex.raw(`
    ALTER TABLE audit_log
      DROP COLUMN IF EXISTS entry_hash,
      DROP COLUMN IF EXISTS prev_hash
  `);
}
