/**
 * Migration 087: ADR-185 — Chat message translation columns
 *
 * Seeds, up front, the full per-language content column set on the PHYSICAL
 * `messages` table plus detection + provenance columns. All additive and
 * nullable — in PostgreSQL 11+ `ADD COLUMN <nullable>` is a metadata-only
 * operation (instant, no table rewrite). `content` (the original) is untouched
 * and stays NOT NULL; only *translations* ever populate `content_<lang>`.
 *
 * Storage decision per ADR-185 §Decision.1:
 *   - content_<lang> text NULL   (15 langs = LANGUAGE_NAMES, single source of truth)
 *   - detected_lang  varchar(8)  (language of the original — which slot it mirrors)
 *   - translation_meta jsonb     (per-lang provenance: { <lang>: { by, actor_type, agent_id, at } })
 *
 * One migration, no per-language migrations ever again. Runs on all rings with
 * code (master A / master B(NL) / godcrm_test), never data.
 */

// Kept in lock-step with LANGUAGE_NAMES in backend/routes/v3/documents/_helpers.js.
// Inlined here (not imported) so the migration is self-contained and stable even
// if the helper list is later reordered — the column set is a schema contract.
const LANG_CODES = [
  'en', 'ru', 'de', 'fr', 'es', 'it', 'pt', 'zh',
  'ja', 'ko', 'ar', 'he', 'uk', 'pl', 'nl',
];

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  await knex.schema.alterTable('messages', (table) => {
    for (const code of LANG_CODES) {
      table.text(`content_${code}`).nullable();
    }
    table.string('detected_lang', 8).nullable();
    if (isPostgres) {
      table.jsonb('translation_meta').nullable();
    } else {
      table.text('translation_meta').nullable();
    }
  });
}

export async function down(knex) {
  await knex.schema.alterTable('messages', (table) => {
    for (const code of LANG_CODES) {
      table.dropColumn(`content_${code}`);
    }
    table.dropColumn('detected_lang');
    table.dropColumn('translation_meta');
  });
}
