// Migration 063: ADR-0063 P0-A — `_inflight_runs` universal pause registry.
//
// Renumbered from 062 to break the alphabetical-prefix collision with
// 062_adr_0060a_spaces_main_project_id.js — knex applied 0060a first and the
// second 062_* was never picked up by migrate:latest. Migration has never been
// applied to a runtime DB, so renaming is a clean fix-forward (no follow-up
// ALTER). Schema and behaviour are unchanged from eea15cc6 + afc1888f.
//
// Generalized from the original ADR-0063 P0 (rate-limit-only) per ADR-0063-A
// (doc 155106). One row per active agent-run dispatcher call. The dispatcher
// upserts the row on entry, marks it `paused` on Anthropic 429 (or any other
// pause cause) with `resume_at` derived from the trigger context, and the
// watchdog reads paused rows to fan out resume messages after the cause clears.
//
// `status` is the lifecycle (4 values, CHECK-enforced). `reason` is the
// open-ended discriminator — no CHECK, taxonomy lives in ADR-0063-A §1 and
// in markPaused.js JSDoc. Watchdog in alpha only acts on `paused-rate-limit`;
// other reasons are schema-ready, runtime-narrow.
//
// Taxonomy (open — no DB constraint, document-only):
//   paused-rate-limit, paused-awaiting-input, paused-awaiting-dependency,
//   paused-awaiting-tool, paused-scheduled, paused-manual,
//   failed-crashed, failed-killed, failed-timeout, failed-superseded
//
// Indexes target the read paths:
//   - watchdog scan:    (status, resume_at)  → WHERE status='paused' AND resume_at <= NOW()
//   - per-agent gauge:  (agent_slug, status) → "is this agent in flight?"
//   - chat back-ref:    (conversation_id)    → resume-message fan-out + per-space view JOIN
//   - reason analytics: (reason) WHERE reason IS NOT NULL → ad-hoc reason breakdown
//
// Cleanup of `status IN ('done','failed')` older than 7 days is a follow-up:
// the ADR-0019 background-jobs framework that ADR-0063 references is drafted
// but not yet built (see `backend/services/connectors/refreshScheduler.js`
// header — same TODO). When ADR-0019 lands, the cleanup job definition goes
// there. Alpha-safe: rows are ~140 bytes, bounded by pause-frequency × runs.
//
// Space-1 placement (ADR-0063-A §2 + §3-rev): the migration registers
// `_inflight_runs` as a system table in project_id=1 ("System Management",
// space_id=1). At read time, SystemTableService.getSystemTableData(...) hits
// the native PG table; the per-space projection from §3-rev is done in the
// service via WHERE (metadata->>'space_id')::int = $spaceId (Option A — no
// join through 1784). markPaused() stamps metadata.space_id from
// conversations.space_id so non-owner spaces see only their own paused runs.
//
// PG-only: dialect guard mirrors migrations 057/059.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 063] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS _inflight_runs (
      id               BIGSERIAL PRIMARY KEY,
      ticket_id        BIGINT,
      agent_slug       TEXT NOT NULL,
      conversation_id  BIGINT,
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_step_id     BIGINT,
      status           TEXT NOT NULL DEFAULT 'running',
      reason           TEXT,
      resume_at        TIMESTAMPTZ,
      resume_attempts  INT NOT NULL DEFAULT 0,
      metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT _inflight_runs_status_chk
        CHECK (status IN ('running','paused','done','failed')),
      CONSTRAINT _inflight_runs_resume_attempts_chk
        CHECK (resume_attempts >= 0 AND resume_attempts <= 5)
    )
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inflight_runs_status_resume_at
      ON _inflight_runs (status, resume_at)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inflight_runs_agent_slug_status
      ON _inflight_runs (agent_slug, status)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inflight_runs_conversation_id
      ON _inflight_runs (conversation_id)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_inflight_runs_reason
      ON _inflight_runs (reason) WHERE reason IS NOT NULL
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION _inflight_runs_touch_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`DROP TRIGGER IF EXISTS _inflight_runs_touch_updated_at_trg ON _inflight_runs`);
  await knex.raw(`
    CREATE TRIGGER _inflight_runs_touch_updated_at_trg
    BEFORE UPDATE ON _inflight_runs
    FOR EACH ROW EXECUTE FUNCTION _inflight_runs_touch_updated_at()
  `);

  // ADR-0063-A §3-rev P0-A3 — surface as system table in space 1 (project 1,
  // "System Management"). Idempotent via WHERE NOT EXISTS — universal_tables
  // has no unique constraint on (project_id, sync_target). Skip silently if
  // project 1 is missing (fresh install before SystemTablesCreator runs).
  await knex.raw(`
    INSERT INTO universal_tables (project_id, name, description, icon, is_system, sync_target)
    SELECT 1,
           '_inflight_runs',
           'Universal pause registry — agent runs waiting to resume (ADR-0063-A)',
           '⏸️',
           1,
           '_inflight_runs'
    WHERE EXISTS (SELECT 1 FROM projects WHERE id = 1)
      AND NOT EXISTS (
        SELECT 1 FROM universal_tables
        WHERE project_id = 1 AND sync_target = '_inflight_runs'
      )
  `);

  console.log('[Migration 063] _inflight_runs universal pause registry created (ADR-0063-A P0-A)');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`
    DELETE FROM universal_tables
    WHERE project_id = 1 AND sync_target = '_inflight_runs'
  `);
  await knex.raw(`DROP TRIGGER IF EXISTS _inflight_runs_touch_updated_at_trg ON _inflight_runs`);
  await knex.raw(`DROP FUNCTION IF EXISTS _inflight_runs_touch_updated_at()`);
  await knex.raw(`DROP INDEX IF EXISTS idx_inflight_runs_reason`);
  await knex.raw(`DROP INDEX IF EXISTS idx_inflight_runs_conversation_id`);
  await knex.raw(`DROP INDEX IF EXISTS idx_inflight_runs_agent_slug_status`);
  await knex.raw(`DROP INDEX IF EXISTS idx_inflight_runs_status_resume_at`);
  await knex.raw(`DROP TABLE IF EXISTS _inflight_runs`);
}
