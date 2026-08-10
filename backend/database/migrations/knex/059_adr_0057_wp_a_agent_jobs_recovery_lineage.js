// Migration 059: ADR-0057 WP-A — Idempotent redispatch chain on agent_jobs.
//
// Adds:
//   recovered_from_job_id INTEGER REFERENCES agent_jobs(id) NULL
//   restart_attempt       INTEGER NOT NULL DEFAULT 0
//
// + UNIQUE partial index (recovered_from_job_id, restart_attempt) WHERE not null.
// The lineage column + uniqueness lets the recovery path call
// pg_try_advisory_xact_lock around an INSERT and have the DB reject a
// concurrent duplicate cleanly instead of producing twin redispatches
// (see jobs 11022 → 11023 + 11024 incident on 2026-05-12).
//
// `_job_restart_count` / `_last_restart` in conversations.settings JSONB
// stays (lifecycle.js still reads it for the per-conversation rate limit).
// `restart_attempt` is per-chain and decoupled from per-conversation counts.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 059] Non-PG dialect — skipping (PG-only, agent_jobs is PG).');
    return;
  }

  await knex.raw(`
    ALTER TABLE agent_jobs
      ADD COLUMN IF NOT EXISTS recovered_from_job_id INTEGER REFERENCES agent_jobs(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS restart_attempt INTEGER NOT NULL DEFAULT 0
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_recovery_chain
      ON agent_jobs (recovered_from_job_id, restart_attempt)
      WHERE recovered_from_job_id IS NOT NULL
  `);

  console.log('[Migration 059] agent_jobs.recovered_from_job_id + restart_attempt + unique chain index created');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_agent_jobs_recovery_chain`);
  await knex.raw(`ALTER TABLE agent_jobs DROP COLUMN IF EXISTS restart_attempt`);
  await knex.raw(`ALTER TABLE agent_jobs DROP COLUMN IF EXISTS recovered_from_job_id`);
}
