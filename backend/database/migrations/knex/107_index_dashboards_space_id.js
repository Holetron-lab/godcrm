// Migration 107: index `dashboards(space_id)`.
//
// `getSpacesByUser()` (backend/services/space/crud.js) builds the space list with two
// correlated subqueries per space — one counting projects, one counting dashboards.
// The projects side rides `idx_projects_space_public`; the dashboards side had NO index
// on `space_id` at all, so every row of the outer scan paid a full Seq Scan of
// `dashboards`. Cost is the product, and it lands on the privileged branch (owner/admin),
// which deliberately selects *every* space.
//
// Measured on godcrm_test (12 340 spaces x 15 596 dashboards): 5 953 ms, 2.4M buffer hits
// in SubPlan 2 alone. That is what pushed `spaces.test.js :: GET /api/v3/spaces` past
// vitest's 5 000 ms default — the tests were the messenger, not the defect.
//
// The existing `idx_dashboards_project_public` does not help: `project_id` is a different
// column, and the subquery filters on `space_id`.
//
// Plain CREATE INDEX, not CONCURRENTLY: knex wraps each migration in a transaction and
// CONCURRENTLY cannot run inside one. `dashboards` is small on both masters (6 261 rows on
// master A) so the ACCESS EXCLUSIVE window is milliseconds.

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 107] Non-PG dialect — skipping.'); return; }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_dashboards_space_id ON dashboards (space_id)');
  console.log('[Migration 107] idx_dashboards_space_id ready.');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;
  await knex.raw('DROP INDEX IF EXISTS idx_dashboards_space_id');
}
