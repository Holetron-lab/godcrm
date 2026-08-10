// Migration 061: ADR-0057 WP-C revision — drop active-agent partial unique.
//
// Founder directive 2026-05-12: "разрешены два одинаковых агента в чате".
// Conversations are now allowed to host N concurrent jobs per (conv, name).
// Migration 060 enforced "one active per (conv, name, invocation_type)" at
// the DB level; we relax that to "anything goes" so that two @-mentions of
// the same agent in rapid succession both produce live jobs (and live
// badges in the chat presence row).
//
// What we keep:
//   - `invocation_type_norm` generated column — still useful for filtering
//     active_agents[] by mention/command and for analytics.
//   - `idx_agent_jobs_active_per_conv` partial index — supports the
//     `WHERE status IN ('pending','processing')` aggregation in
//     messageController without scanning the full table.
//   - WP-A `idx_agent_jobs_recovery_chain` — recovery idempotency is
//     orthogonal (keyed on recovered_from_job_id) and stays put.
//
// Companion code change: `create.js:76-111` skip-guard removed in the same
// commit. Recovery still skips on 23505 against the chain-unique.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 061] Non-PG dialect — skipping (PG-only).');
    return;
  }

  await knex.raw(`DROP INDEX IF EXISTS uq_agent_jobs_active_per_name`);
  console.log('[Migration 061] uq_agent_jobs_active_per_name dropped — two identical agents per conversation now allowed');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  // Restore mig 060's index (idempotent via IF NOT EXISTS — safe even if
  // someone replayed up() multiple times). Note: rebuild may fail if N>1
  // active jobs per (conv, name, invocation_type_norm) currently exist —
  // operator must dedupe before rolling back.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_jobs_active_per_name
      ON agent_jobs (conversation_id, agent_name, invocation_type_norm)
      WHERE status IN ('pending', 'processing')
  `);
  console.log('[Migration 061] rollback: uq_agent_jobs_active_per_name restored');
}
