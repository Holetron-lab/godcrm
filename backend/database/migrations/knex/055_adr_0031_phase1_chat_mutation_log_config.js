// Migration 055: ADR-0031 Phase 1 — Row-Mutation Event Log Config
//
// Single config table that drives `tableMutationService.js`. Each row is a rule:
// "when (table_id, column_key) changes, render `template` and post a system
// message of `event_type` into the row's attached chat".
//
// Schema notes:
//  - `(table_id, column_key)` UNIQUE — one rule per column per table at MVP.
//  - `template` is a Liquid-lite string. Supported: {{path}}, {{path | default: x}},
//    {% if cond %}/{% elsif %}/{% else %}/{% endif %} with == comparisons.
//  - `event_type` is free-form text used for filter chips in chat UI (P8).
//  - `enabled` is a per-rule kill-switch. Space-level gating lives in env var
//    ROW_MUTATION_LOG_ENABLED_SPACES (CSV of space IDs, P3 flips on for space 11).
//  - No `space_id` column — rules are global; per-space scoping is the env flag.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 055] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS _chat_mutation_log_config (
      id          SERIAL PRIMARY KEY,
      table_id    INTEGER NOT NULL,
      column_key  TEXT NOT NULL,
      template    TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      enabled     BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS _chat_mutation_log_config_table_col_uq
    ON _chat_mutation_log_config (table_id, column_key)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS _chat_mutation_log_config_enabled_idx
    ON _chat_mutation_log_config (enabled) WHERE enabled = true
  `);

  console.log('[Migration 055] _chat_mutation_log_config table + indexes created');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS _chat_mutation_log_config_enabled_idx`);
  await knex.raw(`DROP INDEX IF EXISTS _chat_mutation_log_config_table_col_uq`);
  await knex.raw(`DROP TABLE IF EXISTS _chat_mutation_log_config`);
}
