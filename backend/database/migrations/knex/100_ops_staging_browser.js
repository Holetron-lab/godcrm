/** Backend storage only. No grants issued; apply only through the deployment process. */
export async function up(knex) {
  await knex.raw(`CREATE TABLE ops_browser_grants (
    id SERIAL PRIMARY KEY, job_id TEXT NOT NULL, agent_id INTEGER NOT NULL, space_id INTEGER NOT NULL CHECK (space_id = 11),
    role TEXT NOT NULL, repo TEXT NOT NULL, candidate_sha CHAR(40) NOT NULL,
    suite_ids JSONB NOT NULL, pins JSONB NOT NULL,
    deadline_seconds INTEGER NOT NULL DEFAULT 180 CHECK (deadline_seconds BETWEEN 1 AND 300),
    issued_by INTEGER NOT NULL, issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
    CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '1 hour')
  )`);
  await knex.raw(`CREATE INDEX ops_browser_grants_job ON ops_browser_grants (job_id, agent_id, space_id)`);
  await knex.raw(`CREATE TABLE ops_browser_runs (
    id UUID PRIMARY KEY, worker_id TEXT UNIQUE NOT NULL,
    grant_id INTEGER NOT NULL REFERENCES ops_browser_grants(id), job_id TEXT NOT NULL,
    suite_id TEXT NOT NULL, candidate_sha CHAR(40) NOT NULL, pins JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('registered','running','finished','failed','cleanup_pending','reaped')),
    deadline_at TIMESTAMPTZ NOT NULL, heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ,
    result JSONB
  )`);
  await knex.raw(`CREATE UNIQUE INDEX ops_browser_one_job ON ops_browser_runs (job_id)
    WHERE status IN ('registered','running','cleanup_pending')`);
}
export async function down(knex) {
  await knex.schema.dropTable('ops_browser_runs');
  await knex.schema.dropTable('ops_browser_grants');
}
