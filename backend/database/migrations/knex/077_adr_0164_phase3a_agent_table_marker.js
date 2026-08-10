// Migration 077: ADR-164 Phase 3a — stable agent-table marker.
//
// Backfills the pre-existing `universal_tables.table_type` column (VARCHAR(50), added in
// migration 005, NULL for agent tables to date) with the value 'ai_agents' for every table
// currently identified by the display-name convention `name = 'AI Agents'`.
//
// This is the ONE surviving name-lookup: from here on the runtime resolves agent tables by the
// stable marker (see backend/services/agentTableResolver.js). Creation and copy paths stamp the
// marker going forward (setupTablesController, copy-tools copyTableCore, AIAgentsPackService).
//
// After this migration the safety invariant holds by construction: marker ⊇ name, i.e.
//   name \ marker == ∅  (nothing we served drops out — the dual-mode telemetry gate).
//
// No DDL — column already exists. Portable (PG + sqlite). Idempotent: re-run touches 0 rows
// because the WHERE clause only matches still-unset agent tables.
//
// Dirty-data policy (mirrors migration 076): a collision check runs BEFORE the write and
// throws with an actionable message; knex wraps the migration in a transaction, so a refusal
// leaves table_type untouched. This matters because a silently-unstamped agent table would
// keep name\marker != ∅ forever — permanently blocking the Phase 4 flip — so we fail loud
// at migration time instead of discovering it via prod telemetry weeks later.

const AGENT_TABLE_NAME = 'AI Agents';
const AGENT_TABLE_TYPE = 'ai_agents';

export async function up(knex) {
  // --- Pre-flight: an 'AI Agents' table already carrying a DIFFERENT non-marker table_type
  // (e.g. a documents_* type) must not be silently skipped — that would leave it name-matched
  // but marker-less, wedging the safety gate open. Refuse; resolve by hand.
  const collision = await knex('universal_tables')
    .where({ name: AGENT_TABLE_NAME })
    .whereNotNull('table_type')
    .whereNot('table_type', '')
    .whereNot('table_type', AGENT_TABLE_TYPE)
    .select('id', 'name', 'table_type');
  if (collision.length > 0) {
    const detail = collision
      .map((r) => `  table ${r.id} '${r.name}' has table_type='${r.table_type}'`)
      .join('\n');
    throw new Error(
      `[Migration 077] ${collision.length} '${AGENT_TABLE_NAME}' table(s) already carry a ` +
      `non-marker table_type — resolve manually before re-running (ADR-164 Phase 3a):\n${detail}`
    );
  }

  // --- Backfill: stamp the marker on agent tables that have no table_type yet (NULL or '').
  const updated = await knex('universal_tables')
    .where({ name: AGENT_TABLE_NAME })
    .andWhere(function () {
      this.whereNull('table_type').orWhere('table_type', '');
    })
    .update({ table_type: AGENT_TABLE_TYPE });

  console.log(`[Migration 077] Stamped table_type='${AGENT_TABLE_TYPE}' on ${updated} '${AGENT_TABLE_NAME}' table(s)`);
}

export async function down(knex) {
  // Only revert the marker we set — never touch a table_type that was some other value.
  const reverted = await knex('universal_tables')
    .where({ name: AGENT_TABLE_NAME, table_type: AGENT_TABLE_TYPE })
    .update({ table_type: null });

  console.log(`[Migration 077] Reverted table_type marker on ${reverted} '${AGENT_TABLE_NAME}' table(s)`);
}
