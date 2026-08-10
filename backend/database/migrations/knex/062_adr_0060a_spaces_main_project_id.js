// Migration 062: ADR-0060-A P7/A2 — Add `spaces.main_project_id`
//
// Adds a nullable FK from spaces → projects. Drives the public landing
// resolver: when a space owner picks a "home" project for `/s/:slug`, the
// landing route mounts that project's dashboard directly (per ADR-0060-A
// §Schema change). NULL keeps the existing behaviour — the public route
// falls back to the first public project ordered by (order_index, id).
//
// Created: 2026-05-14
// Ticket:  T-154117
// ADR:     0060-A (doc 154050)

export async function up(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) {
    console.log('[Migration 062] Non-PG dialect — skipping (PG-only feature).');
    return;
  }

  await knex.raw(`
    ALTER TABLE spaces
      ADD COLUMN IF NOT EXISTS main_project_id INTEGER
      REFERENCES projects(id) ON DELETE SET NULL
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_spaces_main_project_id
      ON spaces(main_project_id)
  `);

  console.log('[Migration 062] spaces.main_project_id column + index added');
}

export async function down(knex) {
  const isPostgres =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_spaces_main_project_id`);
  await knex.raw(`ALTER TABLE spaces DROP COLUMN IF EXISTS main_project_id`);
}
