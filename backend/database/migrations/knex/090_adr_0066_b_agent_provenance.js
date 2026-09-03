// Migration 090: ADR-0066-B — delegated-identity provenance on `audit_log`.
//
// Numbered 090, not 088: slots 088 (ADR-0041R type ratchet) and 089 (ADR-198
// mail boxes) are held by in-flight branches and are ALREADY recorded in
// godcrm_test's knex_migrations. Parallel worktrees mint numbers independently,
// so a slot that looks free in this tree is not necessarily free in the DB.
//
// WHY: `acting_as` (migration 066) is FK→users(id) and belongs to ADR-0065
// user-impersonation. It cannot hold an agent identity: agents are rows in a
// logical table, not `users`. So an agent acting under a person's credential
// is currently indistinguishable from that person — the audit trail records
// the credential, not the actor.
//
// One nullable column, no FK. Deliberate, and consistent with the existing
// `messages.agent_id` / `conversations.agent_id` convention: agent ids are
// logical-table row ids, so a physical FK has nothing to point at.
//
// Chain note (ADR-0066-A): `agent_id` is NOT in the frozen CANONICAL_FIELDS
// hash preimage, and adding it there would require a CHAIN_VERSION bump that
// invalidates every existing entry_hash. Instead `writeAudit()` stamps the
// same fact into `details` — which IS hashed — so the delegated identity is
// tamper-evident, and this column is the queryable index over it. Verify with
// `verifyAuditChain`: existing hashes stay valid across this migration.
//
// Idempotent (ADD COLUMN / CREATE INDEX ... IF NOT EXISTS). PG-only: dialect
// guard mirrors 066/086.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 090] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS agent_id INTEGER
  `);

  // Read path this serves: "what did agent X do, most recent first" — the
  // per-agent action record. Sparse (NULL for all human/system traffic), so
  // a partial index stays small.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_agent_created
      ON audit_log (agent_id, created_at DESC) WHERE agent_id IS NOT NULL
  `);
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_audit_log_agent_created`);
  await knex.raw(`ALTER TABLE audit_log DROP COLUMN IF EXISTS agent_id`);
}
