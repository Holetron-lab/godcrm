// Migration 060: ADR-0057 WP-C — Multi-agent presence partial unique index.
//
// Founder framing: a conversation is a runtime container for agents — only
// one job per (conversation, agent_name) may be active at once. Existing
// `create.js:72-89` already implements this skip-guard at the application
// level branched on invocation_type (e.g. @-mention vs /command). Here we
// enforce it at the DB level with a partial unique index, which:
//
//   1. Closes the duplicate-INSERT race that produced jobs 11023+11024
//      (already mitigated by ADR-0057 WP-A advisory lock, but defense in depth).
//   2. Lets messageController build active_agents[] from a single
//      `WHERE status IN ('pending','processing')` query without dedup logic.
//
// Decision A (chosen): include `invocation_type` (NULL → 'default') in the
// unique key. Honors the existing create.js contract — @ and / can run in
// parallel for the same agent. Collision check on 2026-05-12 showed only 3
// historical pairs in 30 days where this matters; behavior change is minimal.
// Decision B (deferred to post-alpha) would tighten the key to
// (conv, agent_name) and force a dedup pre-pass.
//
// Reads from agent_jobs already include agent_name + an `invocation_type`
// hidden inside the `context` JSONB. We materialize that into a normalized
// generated column to keep the index small and fast.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 060] Non-PG dialect — skipping (PG-only, agent_jobs is PG).');
    return;
  }

  // Generated column: `invocation_type` from JSONB context, default 'default'.
  // STORED so the partial unique index can use it directly.
  await knex.raw(`
    ALTER TABLE agent_jobs
      ADD COLUMN IF NOT EXISTS invocation_type_norm TEXT
        GENERATED ALWAYS AS (COALESCE(context::jsonb ->> 'invocation_type', 'default')) STORED
  `);

  // Partial unique index. The WHERE clause is conservative — only active jobs
  // are considered. Cancelled/failed/completed rows can coexist freely.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_jobs_active_per_name
      ON agent_jobs (conversation_id, agent_name, invocation_type_norm)
      WHERE status IN ('pending', 'processing')
  `);

  // Supports the active_agents[] aggregation query in messageController.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_active_per_conv
      ON agent_jobs (conversation_id, status)
      WHERE status IN ('pending', 'processing')
  `);

  console.log('[Migration 060] agent_jobs.invocation_type_norm + uq_agent_jobs_active_per_name + idx_agent_jobs_active_per_conv created');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_agent_jobs_active_per_conv`);
  await knex.raw(`DROP INDEX IF EXISTS uq_agent_jobs_active_per_name`);
  await knex.raw(`ALTER TABLE agent_jobs DROP COLUMN IF EXISTS invocation_type_norm`);
}
