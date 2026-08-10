// backend/database/migrations/knex/045_add_widget_owner_step1.js
// ADR-0003 widget-embed Phase 1 — introduce polymorphic owner on widgets.
//
// Step 1/3 (this file):
//   Add widgets.owner_kind (nullable), widgets.owner_id (nullable) + composite
//   index. dashboard_id stays NOT NULL here. No backfill, no enforcement.
// Step 2/3:
//   scripts/backfill-widgets-owner.js — populates owner_kind='dashboard',
//   owner_id=dashboard_id for every existing row (idempotent).
// Step 3/3:
//   046_add_widget_owner_step3.js — sets owner_kind + owner_id NOT NULL and
//   makes dashboard_id NULLABLE (legacy read path).
//
// owner_kind is stored as a text column (not a Postgres ENUM) to keep the
// migration portable to SQLite and to let us add new kinds cheaply.
// Allowed values: 'dashboard' | 'document' | 'atom'.
export async function up(knex) {
  await knex.schema.alterTable('widgets', (table) => {
    table.string('owner_kind', 32).nullable();
    table.integer('owner_id').unsigned().nullable();
    table.index(['owner_kind', 'owner_id'], 'widgets_owner_kind_owner_id_idx');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('widgets', (table) => {
    table.dropIndex(['owner_kind', 'owner_id'], 'widgets_owner_kind_owner_id_idx');
    table.dropColumn('owner_id');
    table.dropColumn('owner_kind');
  });
}
