// Migration 056: Add favorites_config JSONB column on spaces
//
// Polish for chat-input attach popup (architect plan, 2026-05-05). Sister column
// to tickets_config / files_config — drives the "favourite tables" picker that
// renders Tickets / Files / Documents / <custom...> tabs in the AIChatPanel
// attach UI and in RowBindingV2.
//
// Schema (frontend-controlled, no DB validation):
//   {
//     "documents": { "tableId": int, "tableName": str, "tableIcon": str } | null,
//     "custom":    [ { "tableId": int, "tableName": str, "tableIcon": str } ]
//   }
//
// Stays NULL by default to match precedent (tickets_config / files_config also
// default NULL). The crud.js parser already handles `space.<col> ? parse : null`,
// so no behaviour change for existing spaces — frontend shows defaults when null.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 056] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE spaces
      ADD COLUMN IF NOT EXISTS favorites_config JSONB
  `);

  console.log('[Migration 056] spaces.favorites_config column added');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`ALTER TABLE spaces DROP COLUMN IF EXISTS favorites_config`);
}
