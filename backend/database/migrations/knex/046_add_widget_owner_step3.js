// backend/database/migrations/knex/046_add_widget_owner_step3.js
// ADR-0003 widget-embed Phase 1, step 3/3.
//
// Pre-condition: scripts/backfill-widgets-owner.js has been run to completion
// with 0 remaining rows where owner_kind IS NULL or owner_id IS NULL among
// rows that still have dashboard_id. Orphaned module-widgets
// (dashboard_id IS NULL, set by WidgetService.deleteWidget for detached modules)
// must be triaged before running — this migration aborts if any such NULLs
// remain.
//
// This step:
//   1. Verifies invariants — aborts if any widgets row still has
//      owner_kind IS NULL or owner_id IS NULL.
//   2. Sets owner_kind + owner_id to NOT NULL.
//   3. Makes dashboard_id NULLABLE (legacy read path; document/atom-owned
//      widgets will have dashboard_id = NULL).
//
// Down-migration only reverses the NOT NULL / NULLABLE toggles — owner_kind
// / owner_id columns and index are removed by migration 045's down().

export async function up(knex) {
  const stragglers = await knex('widgets')
    .whereNull('owner_kind')
    .orWhereNull('owner_id')
    .count({ n: '*' })
    .first();
  const left = Number(stragglers?.n ?? 0);
  if (left > 0) {
    throw new Error(
      `[046_add_widget_owner_step3] ${left} widgets still have NULL owner_kind/owner_id. ` +
      `Run scripts/backfill-widgets-owner.js first; orphaned rows (dashboard_id IS NULL) ` +
      `need manual triage.`
    );
  }

  await knex.schema.alterTable('widgets', (table) => {
    table.string('owner_kind', 32).notNullable().alter();
    table.integer('owner_id').unsigned().notNullable().alter();
    table.integer('dashboard_id').unsigned().nullable().alter();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('widgets', (table) => {
    table.string('owner_kind', 32).nullable().alter();
    table.integer('owner_id').unsigned().nullable().alter();
    table.integer('dashboard_id').unsigned().notNullable().alter();
  });
}
