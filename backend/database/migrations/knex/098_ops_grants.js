// Ops profiles broker (diagnostics / local-qa, Constitution v4.3 profiles):
// server-owned grants and a durable run audit.
//
// A grant is what the owner issues to ONE agent for ONE job: profile, allowed
// actions, registered suites, the pinned repo + committed SHA, an expiry of at
// most one hour and a revocation stamp. The executor library
// (scripts/ops-runner/profiles.py) re-validates every field on every call, so
// nothing here is advisory. `ops_runs` records every accepted call, including
// the container name so a crashed broker can reap its own workers.
//
// Idempotent on purpose: godcrm_test is a copy of master A and the ops suite
// applies this file itself before running.

export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ops_grants (
      id            SERIAL PRIMARY KEY,
      job_id        TEXT        NOT NULL,
      agent_id      INTEGER     NOT NULL,
      space_id      INTEGER     NOT NULL,
      role          TEXT        NOT NULL,
      profile       TEXT        NOT NULL CHECK (profile IN ('diagnostics','local-qa')),
      actions       JSONB       NOT NULL,
      suites        JSONB       NOT NULL DEFAULT '{}'::jsonb,
      repo          TEXT        NOT NULL,
      candidate_sha CHAR(40)    NOT NULL,
      image         TEXT,
      modules       TEXT,
      max_concurrent INTEGER    NOT NULL DEFAULT 1,
      issued_by     INTEGER     NOT NULL,
      issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at    TIMESTAMPTZ NOT NULL,
      revoked_at    TIMESTAMPTZ,
      revoked_by    INTEGER,
      CONSTRAINT ops_grants_ttl_chk CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '1 hour')
    )
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ops_grants_live_idx
      ON ops_grants (agent_id, job_id, space_id) WHERE revoked_at IS NULL
  `);
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ops_runs (
      id              SERIAL PRIMARY KEY,
      grant_id        INTEGER     NOT NULL REFERENCES ops_grants(id) ON DELETE CASCADE,
      agent_id        INTEGER     NOT NULL,
      space_id        INTEGER     NOT NULL,
      job_id          TEXT        NOT NULL,
      action          TEXT        NOT NULL,
      suite_id        TEXT,
      request         JSONB       NOT NULL,
      status          TEXT        NOT NULL CHECK (status IN ('running','finished','denied','failed','reaped')),
      exit_code       INTEGER,
      container       TEXT,
      executor_sha256 TEXT,
      artifacts       TEXT,
      result          JSONB,
      broker_pid      INTEGER,
      started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at     TIMESTAMPTZ
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS ops_runs_grant_idx ON ops_runs (grant_id, status)`);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS ops_runs`);
  await knex.raw(`DROP TABLE IF EXISTS ops_grants`);
}
