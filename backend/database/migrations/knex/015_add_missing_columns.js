// backend/database/migrations/knex/015_add_missing_columns.js
// Adds columns that exist in production SQLite but missing in PG schema
// ADR-017: Database Abstraction Layer

/**
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // Add missing columns to spaces (only access_control is missing)
  await knex.schema.alterTable('spaces', (table) => {
    table.json('access_control');
  });

  // Add missing columns to projects
  await knex.schema.alterTable('projects', (table) => {
    table.json('access_control');
    table.integer('order_index').defaultTo(0);
    table.integer('owner_owner_id').unsigned();
  });

  // Add missing columns to files (many missing)
  await knex.schema.alterTable('files', (table) => {
    table.string('original_name', 500);
    table.string('storage_provider_id', 100);
    table.integer('table_id').unsigned();
    table.string('row_id', 100);
    table.string('column_id', 100);
    table.string('url', 1000);
    table.integer('project_id').unsigned();
    table.text('description');
    table.json('metadata');
  });

  // Add missing columns to universal_tables
  await knex.schema.alterTable('universal_tables', (table) => {
    table.string('theme', 50);
    table.json('access_control');
    table.integer('order_index').defaultTo(0);
    table.integer('items_count').defaultTo(0);
  });

  // Add missing columns to dashboards (only theme and access_control missing)
  await knex.schema.alterTable('dashboards', (table) => {
    table.string('theme', 50);
    table.json('access_control');
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.alterTable('dashboards', (table) => {
    table.dropColumn('theme');
    table.dropColumn('access_control');
  });

  await knex.schema.alterTable('universal_tables', (table) => {
    table.dropColumn('theme');
    table.dropColumn('access_control');
    table.dropColumn('order_index');
    table.dropColumn('items_count');
  });

  await knex.schema.alterTable('files', (table) => {
    table.dropColumn('original_name');
    table.dropColumn('storage_provider_id');
    table.dropColumn('table_id');
    table.dropColumn('row_id');
    table.dropColumn('column_id');
    table.dropColumn('url');
    table.dropColumn('project_id');
    table.dropColumn('description');
    table.dropColumn('metadata');
  });

  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('access_control');
    table.dropColumn('order_index');
    table.dropColumn('owner_owner_id');
  });

  await knex.schema.alterTable('spaces', (table) => {
    table.dropColumn('access_control');
  });
}
