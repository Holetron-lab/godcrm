// backend/database/migrations/knex/017_add_documents_columns.js
// Adds columns for Documents widget v4 (folder_path, table_type, base_id, created_by)

/**
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // Add documents-related columns to universal_tables.
  // Idempotent: on databases where migration 005 already created these columns
  // (post-hoc edit drift), skip the ones that exist so a from-scratch run passes.
  const has = {
    folder_path: await knex.schema.hasColumn('universal_tables', 'folder_path'),
    table_type: await knex.schema.hasColumn('universal_tables', 'table_type'),
    base_id: await knex.schema.hasColumn('universal_tables', 'base_id'),
    created_by: await knex.schema.hasColumn('universal_tables', 'created_by'),
  };
  if (Object.values(has).every(Boolean)) return;
  await knex.schema.alterTable('universal_tables', (table) => {
    if (!has.folder_path) table.text('folder_path');         // Path like 'databases/documents/'
    if (!has.table_type) table.string('table_type', 50);     // 'documents_registry' | 'documents_atoms' | null
    if (!has.base_id) table.string('base_id', 50);           // Unique base identifier
    if (!has.created_by) table.integer('created_by').unsigned(); // User who created the table
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.alterTable('universal_tables', (table) => {
    table.dropColumn('folder_path');
    table.dropColumn('table_type');
    table.dropColumn('base_id');
    table.dropColumn('created_by');
  });
}
