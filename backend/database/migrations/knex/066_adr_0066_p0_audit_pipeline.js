// Migration 066: ADR-0066 P0 — Unified Write Audit Pipeline foundation.
//
// Extends `public.audit_log` with 4 nullable columns + 4 indexes. Zero
// breaking change for the 6 existing producers (login, secrets,
// connectors, widget audit, bdd_audit, file events) — every new column
// is nullable and the legacy `ip_address TEXT` is left untouched. The
// new `ip_addr INET` is the forward path; ADR-0066 P5 migrates legacy
// callers off `ip_address` (out of scope here).
//
// New columns:
//   - acting_as INTEGER REFERENCES users(id)  → set by writeAudit() when
//     ADR-0065 ephemeral permission downgrade is active. NULL for
//     normal traffic. Dead code until ADR-0065 lands; column exists so
//     consumers don't have to round-trip a migration when 0065 ships.
//   - request_id TEXT  → req.requestId UUID, correlates multi-row write
//     audits inside one HTTP request. Indexed via composite indexes
//     only — query patterns are user_id+time or entity+time, not
//     request_id directly.
//   - space_id INTEGER  → best-effort scope tag from req.spaceId.
//   - ip_addr INET  → forward-path IP, replaces legacy `ip_address TEXT`
//     for new producers. Native INET type for future pgvector / network
//     queries.
//
// Indexes target ADR-0066 P4 read paths (universal Table widget over
// audit_log in space 1) + future retention cron:
//   - (user_id, created_at DESC)         → "what did this user do?"
//   - (entity_type, entity_id, created_at DESC) → "what happened to row X?"
//   - (acting_as) WHERE acting_as IS NOT NULL → audit of ADR-0065
//     impersonation sessions, very sparse — partial index keeps it tiny.
//   - (created_at)                       → retention cron / time-range scans.
//
// All indexes are CREATE INDEX IF NOT EXISTS — migration is rerun-safe
// in case a partial application is retried.
//
// PG-only: dialect guard mirrors 057/059/063.

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 066] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  // ADD COLUMN IF NOT EXISTS keeps the migration idempotent.
  await knex.raw(`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS acting_as  INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS request_id TEXT,
      ADD COLUMN IF NOT EXISTS space_id   INTEGER,
      ADD COLUMN IF NOT EXISTS ip_addr    INET
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
      ON audit_log (user_id, created_at DESC)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity_created
      ON audit_log (entity_type, entity_id, created_at DESC)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_acting_as
      ON audit_log (acting_as) WHERE acting_as IS NOT NULL
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
      ON audit_log (created_at)
  `);

  console.log(
    '[Migration 066] audit_log extended: +4 nullable columns, +4 indexes (ADR-0066 P0)'
  );
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_audit_log_created_at`);
  await knex.raw(`DROP INDEX IF EXISTS idx_audit_log_acting_as`);
  await knex.raw(`DROP INDEX IF EXISTS idx_audit_log_entity_created`);
  await knex.raw(`DROP INDEX IF EXISTS idx_audit_log_user_created`);

  await knex.raw(`
    ALTER TABLE audit_log
      DROP COLUMN IF EXISTS ip_addr,
      DROP COLUMN IF EXISTS space_id,
      DROP COLUMN IF EXISTS request_id,
      DROP COLUMN IF EXISTS acting_as
  `);
}
