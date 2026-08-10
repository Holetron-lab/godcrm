// Migration 073: ADR-0007-S G1-data — `agent_versions` foundation table.
//
// Smith rev-3 Acceptance Gate (ADR-0007-S §5/§7, Unblock-Minimum, Strict
// Genesis). One row per *minted agent revision*. This is the substrate Smith
// writes to when it mints / promotes / retires `@smith-*` agents — it is infra
// Smith USES, not a hand-written agent, so it does not trip ADR-0007 C-6 /
// ADR-143 §Smith-v3.6 (the "no hand-written agent configs" Genesis lock).
//
// Columns:
//   agent_row_id    INTEGER  — the agent's row in the AI Agents table (1784).
//                              This IS the orchestrator's "agent_id FK → agents
//                              (table 1784)". Agents physically live as rows in
//                              `table_rows`, so the FK targets table_rows(id)
//                              ON DELETE CASCADE. The service layer additionally
//                              asserts the referenced row is table_id = 1784
//                              (an FK alone can't distinguish an agent row from
//                              any other universal-table row). NOTE: this adds a
//                              real FK that the sibling `agent_jobs` table omits
//                              — required here by ADR-0007-S acceptance #3
//                              ("FK rejects an orphan version").
//   agent_slug      TEXT     — human-readable lineage key, e.g. 'smith-researcher'
//                              (mirrors agent_jobs.agent_name; denormalized for
//                              fast "live revision of @slug" lookups by G2).
//   version_int     INTEGER  — monotonic revision number per agent_row_id.
//   parent_version  INTEGER  — version this was derived from (NULL for genesis).
//   status          TEXT     — 'draft' | 'active' | 'retired'.
//   prompt_blob     TEXT     — the minted system prompt for this revision.
//   config_json     JSONB    — model / tools / skills / params for this revision.
//   rubric_score    NUMERIC  — Examine-phase score (G4 reads; G1 just stores).
//   traffic_pct     INTEGER  — A/B traffic share 0..100 (G4 reads; G1 stores).
//   created_by      INTEGER  — minter (user id; agents have user accounts too).
//   created_at      TIMESTAMPTZ
//   updated_at      TIMESTAMPTZ
//
// Invariants enforced at the DB level (defense in depth — handlers also guard):
//   1. uq_agent_versions_row_version — (agent_row_id, version_int) is unique.
//   2. uq_agent_versions_one_active  — at most ONE 'active' row per agent_row_id
//      (partial unique index). This is the single-live invariant G2/G4 rely on,
//      so the dispatcher resolves "the active revision of agent N" in one read,
//      and it cannot be violated even by a buggy/concurrent writer.
//
// Style mirrors migration 072 (raw PG SQL, PG-guard, IF NOT EXISTS, idempotent).

export async function up(knex) {
  const isPg = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPg) {
    console.log('[Migration 073] Non-PG dialect — skipping (PG-only).');
    return;
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS agent_versions (
      id              SERIAL PRIMARY KEY,
      agent_row_id    INTEGER     NOT NULL
                        REFERENCES table_rows(id) ON DELETE CASCADE,
      agent_slug      TEXT,
      version_int     INTEGER     NOT NULL,
      parent_version  INTEGER,
      status          TEXT        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'retired')),
      prompt_blob     TEXT,
      config_json     JSONB       NOT NULL DEFAULT '{}'::jsonb,
      rubric_score    NUMERIC(6,3),
      traffic_pct     INTEGER     NOT NULL DEFAULT 0
                        CHECK (traffic_pct >= 0 AND traffic_pct <= 100),
      created_by      INTEGER,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // (agent_row_id, version_int) is unique — version numbers don't repeat per agent.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_versions_row_version
      ON agent_versions (agent_row_id, version_int)
  `);

  // At most one ACTIVE revision per agent. Draft/retired rows coexist freely.
  // This is the hard backstop behind promoteAgentVersion()'s retire-then-activate.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_versions_one_active
      ON agent_versions (agent_row_id)
      WHERE status = 'active'
  `);

  // Lookup path: "all revisions of this agent" + status filters.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_agent_versions_row_status
      ON agent_versions (agent_row_id, status)
  `);

  console.log('[Migration 073] ADR-0007-S G1-data: agent_versions table + single-active invariant created');
}

export async function down(knex) {
  const isPg = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPg) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_agent_versions_row_status`);
  await knex.raw(`DROP INDEX IF EXISTS uq_agent_versions_one_active`);
  await knex.raw(`DROP INDEX IF EXISTS uq_agent_versions_row_version`);
  await knex.raw(`DROP TABLE IF EXISTS agent_versions`);

  console.log('[Migration 073] ADR-0007-S G1-data: rolled back (agent_versions dropped)');
}
