// backend/database/migrations/knex/047_widgets_is_template.js
// ADR-0012 Phase 8.1 — template virtualization step 1/2.
//
// Add widgets.is_template (boolean, default false) + partial unique index
// (preset_name) WHERE is_template = true. The unique index guarantees
// at most one template row per preset_name; instance widgets remain
// unconstrained (current setup).
//
// Backfill of 8 empty templates is performed by the sister script
//   scripts/migrations/20260429_widget_templates_phase8.js
// (one row per distinct preset_name observed on the deployment, configs
// stay as '{}' — instance configs uplift into per-atom settings_override
// during Phase 8.4 migration).
export async function up(knex) {
  await knex.schema.alterTable('widgets', (table) => {
    table.boolean('is_template').notNullable().defaultTo(false);
  });

  // Partial unique index: one template per preset_name, only among templates.
  // Use raw SQL — knex schema builder doesn't natively express partial indexes.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS widgets_template_preset_unique_idx
      ON widgets (preset_name) WHERE is_template = true
  `);
}

export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS widgets_template_preset_unique_idx`);
  await knex.schema.alterTable('widgets', (table) => {
    table.dropColumn('is_template');
  });
}
