// Migration 084: ADR-0181 — Agent Write-Reservations (advisory soft-lock table).
//
// Backing store for the post-allow reservation stage added to the ADR-0053
// /check route handler (backend/routes/v3/agent-permissions.js) via
// services/agent-permissions/reservations.js. This is an `_`-namespaced
// operational infra table — same class as _command_policies / _command_audit
// (ADR-0053) — NOT CRM domain data. Additive + fully idempotent.
//
// A stale reservation self-releases through the expires_at TTL (a dead loop's
// row is stolen on the next acquire), so there is deliberately no operational
// unlock path and no cache-invalidation trigger to install.
//
// Numbering: 084 is the first free slot. 079 is taken by the sc-sim module
// migration (079_adr_0165_sc_sim_crm_project_isolation.js, merged into the same
// knex_migrations ledger via moduleMigrationDirs()); 080–083 are the applied
// ADR-0158 mail migrations recorded in the ledger (…082_adr_0158_p4_mail_labels,
// 083_adr_0158_p6_mail_scheduled) whose files live in a divergent tree. 084 sits
// above every occupied number in both the file set and the live ledger.
//
// Column contract is authoritative-matched to the test suite's inline schema
// (services/agent-permissions/__tests__/reservations.test.js) so the DB-backed
// tests behave identically whether or not this migration has been applied.

const TABLE = '_agent_write_reservations';

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 084] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      file_path       TEXT PRIMARY KEY,          -- normalized repo-relative key (tree/worktree-agnostic)
      wp_id           TEXT,                       -- work-package / designation, when known
      holder_session  TEXT NOT NULL,              -- hook stdin session_id — the owning loop
      agent_id        INTEGER,                    -- ADR-0053 C3 env, when present
      space_id        INTEGER,
      acquired_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      renewed_at      TIMESTAMPTZ,                -- stamped by the ON CONFLICT DO UPDATE (renew/steal) path
      expires_at      TIMESTAMPTZ NOT NULL        -- TTL backstop; stale rows are stolen on next acquire
    )
  `);

  // The acquire's steal-if-expired predicate and any reclaim scan filter on
  // expires_at; holder-scoped release filters on holder_session.
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_awr_expires_at ON ${TABLE} (expires_at)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_awr_holder_session ON ${TABLE} (holder_session)`);

  console.log(`[Migration 084] ${TABLE} created (ADR-0181)`);
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_awr_holder_session`);
  await knex.raw(`DROP INDEX IF EXISTS idx_awr_expires_at`);
  await knex.raw(`DROP TABLE IF EXISTS ${TABLE}`);
}
