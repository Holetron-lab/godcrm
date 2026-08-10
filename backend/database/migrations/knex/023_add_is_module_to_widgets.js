// backend/database/migrations/knex/023_add_is_module_to_widgets.js
// ADR-045: Module Flag — add is_module boolean to widgets table
// Separates sidebar modules from dashboard-only widgets at DB level

const MODULE_PRESETS = [
  'labs',
  'documents',
  'documents_v4',
  'wellness',
  'fitness',
  'virtual_office',
  'ai_agents',
  'kanban_board',
  'table_view',
  'calendar_widget',
  'timeline_widget'
];

export async function up(knex) {
  // Step 1: Add is_module column
  await knex.schema.alterTable('widgets', (table) => {
    table.boolean('is_module').defaultTo(false);
  });

  // Step 2: Data migration — set is_module = true for sidebar modules
  await knex('widgets')
    .whereIn('preset_name', MODULE_PRESETS)
    .update({ is_module: true });
}

export async function down(knex) {
  await knex.schema.alterTable('widgets', (table) => {
    table.dropColumn('is_module');
  });
}
