// Migration 058: ADR-0053 Phase C0 — Server-Side Agent Command Policy.
//
// Two system tables that back the PreToolUse hook for spawned Claude CLI
// agents (see ADR-0053 §C0/C1):
//
//   _command_policies  — owner-managed allow/deny rules with scope hierarchy
//   _command_audit     — append-only log of every hook decision (TTL 90d)
//
// Schema notes:
//   - Both tables are leading-underscore system tables (like `_secrets`).
//     Not exposed via /api/v3/tables; only via /api/v3/command-policies.
//   - `agent_id` / `tool_id` are integer references to the universal tables
//     1784 (_agents) and 1790 (_ai_tools). No hard FK because universal_table
//     rows live in `rows.data` JSONB — we validate at the API layer.
//   - Resolution order is computed at lookup time (most-specific wins,
//     deny-wins on tie). See backend/services/agent-permissions/resolver.js.
//   - `pg_notify('command_policies_changed', 'invalidate-all')` on any write
//     — the hook process maintains a 60s in-memory cache and evicts wholesale
//     on receipt. Wholesale invalidation is fine: write rate is human-scale.
//   - Audit retention is enforced by a daily cron (DELETE WHERE ts < now()-90d),
//     not a partition — we'll partition later if volume warrants it.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 058] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  // ───────────────────────────────────────────── _command_policies ─────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS _command_policies (
      id          SERIAL PRIMARY KEY,
      scope       TEXT NOT NULL,
      space_id    INT,
      agent_id    INT,
      tool_id     INT,
      pattern     TEXT NOT NULL,
      match_type  TEXT NOT NULL DEFAULT 'prefix',
      action      TEXT NOT NULL,
      actor       INT,
      reason      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT _command_policies_scope_chk     CHECK (scope IN ('global', 'space')),
      CONSTRAINT _command_policies_match_chk     CHECK (match_type IN ('exact', 'prefix', 'regex')),
      CONSTRAINT _command_policies_action_chk    CHECK (action IN ('allow', 'deny')),
      CONSTRAINT _command_policies_scope_space   CHECK (
        (scope = 'global' AND space_id IS NULL) OR
        (scope = 'space'  AND space_id IS NOT NULL)
      )
    )
  `);

  // Lookup path: hook resolves (space_id, agent_id, tool_id) → list of
  // candidate rules. Composite index covers the most-selective filters.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_command_policies_lookup
    ON _command_policies (scope, space_id, agent_id, tool_id)
  `);
  // Secondary index for pattern scans (regex/prefix fallback in resolver).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_command_policies_pattern
    ON _command_policies (pattern)
  `);

  // updated_at auto-bump trigger.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION _command_policies_touch() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`DROP TRIGGER IF EXISTS _command_policies_touch_trg ON _command_policies`);
  await knex.raw(`
    CREATE TRIGGER _command_policies_touch_trg
    BEFORE UPDATE ON _command_policies
    FOR EACH ROW EXECUTE FUNCTION _command_policies_touch()
  `);

  // NOTIFY trigger — invalidate-all payload, hook does wholesale cache flush.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION _command_policies_notify() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify('command_policies_changed', 'invalidate-all');
      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`DROP TRIGGER IF EXISTS _command_policies_notify_trg ON _command_policies`);
  await knex.raw(`
    CREATE TRIGGER _command_policies_notify_trg
    AFTER INSERT OR UPDATE OR DELETE ON _command_policies
    FOR EACH ROW EXECUTE FUNCTION _command_policies_notify()
  `);

  // ───────────────────────────────────────────── _command_audit ────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS _command_audit (
      id              SERIAL PRIMARY KEY,
      agent_id        INT,
      space_id        INT,
      tool_name       TEXT,
      command         TEXT,
      decision        TEXT NOT NULL,
      matched_rule_id INT,
      matched_source  TEXT NOT NULL,
      reason          TEXT,
      ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT _command_audit_decision_chk CHECK (decision IN ('allow', 'deny')),
      CONSTRAINT _command_audit_source_chk   CHECK (matched_source IN ('code-level', 'db-rule', 'default-allow'))
    )
  `);

  // Hot path: most recent first.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_command_audit_ts
    ON _command_audit (ts DESC)
  `);
  // Per-agent feed.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_command_audit_agent_ts
    ON _command_audit (agent_id, ts DESC)
  `);
  // Partial index: deny tail is what humans care about for incident review.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_command_audit_deny_ts
    ON _command_audit (ts DESC) WHERE decision = 'deny'
  `);

  console.log('[Migration 058] _command_policies + _command_audit + NOTIFY trigger created');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP TRIGGER IF EXISTS _command_policies_notify_trg ON _command_policies`);
  await knex.raw(`DROP TRIGGER IF EXISTS _command_policies_touch_trg ON _command_policies`);
  await knex.raw(`DROP FUNCTION IF EXISTS _command_policies_notify()`);
  await knex.raw(`DROP FUNCTION IF EXISTS _command_policies_touch()`);
  await knex.raw(`DROP INDEX IF EXISTS idx_command_audit_deny_ts`);
  await knex.raw(`DROP INDEX IF EXISTS idx_command_audit_agent_ts`);
  await knex.raw(`DROP INDEX IF EXISTS idx_command_audit_ts`);
  await knex.raw(`DROP TABLE IF EXISTS _command_audit`);
  await knex.raw(`DROP INDEX IF EXISTS idx_command_policies_pattern`);
  await knex.raw(`DROP INDEX IF EXISTS idx_command_policies_lookup`);
  await knex.raw(`DROP TABLE IF EXISTS _command_policies`);
}
