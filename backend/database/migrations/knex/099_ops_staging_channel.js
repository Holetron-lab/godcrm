// Authenticated staging channel (conversation 3660, CHANNEL-RUNBOOK /
// QUIET-WINDOW contracts): grants, run receipts and the maintenance lease.
//
// Separate from ops_grants on purpose — the diagnostics / local-qa profiles
// never gain staging privileges by sharing a table, and the CHECK constraints
// here pin the contract numbers (grant TTL <= 1 h, lease TTL <= 30 min).
//
//  - ops_staging_grants: ONE sysadmin agent, ONE job, ONE exact candidate SHA,
//    the executor digest it was issued against, revocable, expiring.
//  - ops_staging_runs: every decision the broker takes once the caller's
//    identity is known — allow and deny alike — with the sanitized result.
//  - ops_staging_leases: the staging maintenance lease (preflight run or
//    quiet window). At most one live lease exists; shell entry points
//    (dev-operation / dev-refresh / make) refuse to run while one is held.
//
// Idempotent: godcrm_test is a copy of master A and the suite applies this
// file itself before running.

export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ops_staging_grants (
      id              SERIAL PRIMARY KEY,
      job_id          TEXT        NOT NULL,
      agent_id        INTEGER     NOT NULL,
      space_id        INTEGER     NOT NULL,
      role            TEXT        NOT NULL,
      actions         JSONB       NOT NULL,
      target          JSONB       NOT NULL,
      repo            TEXT        NOT NULL,
      candidate_sha   CHAR(40)    NOT NULL,
      executor_sha256 TEXT        NOT NULL,
      issued_by       INTEGER     NOT NULL,
      issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      revoked_at      TIMESTAMPTZ,
      revoked_by      INTEGER,
      CONSTRAINT ops_staging_grants_ttl_chk CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '1 hour')
    )
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ops_staging_grants_live_idx
      ON ops_staging_grants (agent_id, job_id, space_id) WHERE revoked_at IS NULL
  `);
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ops_staging_runs (
      id              SERIAL PRIMARY KEY,
      grant_id        INTEGER     REFERENCES ops_staging_grants(id) ON DELETE CASCADE,
      agent_id        INTEGER     NOT NULL,
      space_id        INTEGER     NOT NULL,
      job_id          TEXT,
      action          TEXT,
      request         JSONB       NOT NULL,
      decision        TEXT        NOT NULL CHECK (decision IN ('allow','deny')),
      reason          TEXT,
      status          TEXT        NOT NULL CHECK (status IN ('running','finished','failed','denied','reaped')),
      exit_code       INTEGER,
      candidate_sha   CHAR(40),
      executor_sha256 TEXT,
      log_sha256      TEXT,
      result          JSONB,
      broker_pid      INTEGER,
      started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at     TIMESTAMPTZ
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS ops_staging_runs_space_idx ON ops_staging_runs (space_id, id)`);
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ops_staging_leases (
      id              SERIAL PRIMARY KEY,
      grant_id        INTEGER     REFERENCES ops_staging_grants(id) ON DELETE SET NULL,
      run_id          INTEGER     REFERENCES ops_staging_runs(id) ON DELETE SET NULL,
      job_id          TEXT        NOT NULL,
      agent_id        INTEGER     NOT NULL,
      space_id        INTEGER     NOT NULL,
      purpose         TEXT        NOT NULL CHECK (purpose IN ('preflight','quiet-window')),
      holder_pid      INTEGER     NOT NULL,
      holder_token    TEXT        NOT NULL,
      writers         JSONB       NOT NULL DEFAULT '{}'::jsonb,
      acquired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      heartbeat_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      released_at     TIMESTAMPTZ,
      release_reason  TEXT,
      CONSTRAINT ops_staging_leases_ttl_chk CHECK (expires_at > acquired_at AND expires_at <= acquired_at + interval '30 minutes')
    )
  `);
  // The target is a single staging box: one live lease at a time, whoever holds it.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ops_staging_leases_one_live
      ON ops_staging_leases ((1)) WHERE released_at IS NULL
  `);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS ops_staging_leases`);
  await knex.raw(`DROP TABLE IF EXISTS ops_staging_runs`);
  await knex.raw(`DROP TABLE IF EXISTS ops_staging_grants`);
}
