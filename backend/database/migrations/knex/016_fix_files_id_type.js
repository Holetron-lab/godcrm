// backend/database/migrations/knex/016_fix_files_id_type.js
// Change files.id from INTEGER to VARCHAR to match SQLite schema
// ADR-017: Database Abstraction Layer

/**
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // Drop existing files table and recreate with VARCHAR id
  // This is safe because we're migrating data fresh anyway
  await knex.schema.dropTableIfExists('files');
  
  await knex.schema.createTable('files', (table) => {
    table.string('id', 100).primary();  // Changed from increments() to string
    table.integer('folder_id').unsigned()
      .references('id').inTable('folders').onDelete('SET NULL');
    table.integer('space_id').unsigned()
      .references('id').inTable('spaces').onDelete('CASCADE');
    table.integer('project_id').unsigned()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.string('original_name', 500);
    table.string('mime_type', 100);
    table.integer('size');
    table.text('path').notNullable();
    table.string('url', 1000);
    table.string('storage_provider_id', 100);
    table.integer('table_id').unsigned();
    table.string('row_id', 100);
    table.string('column_id', 100);
    table.integer('uploaded_by').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    table.text('description');
    table.json('metadata');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('folder_id');
    table.index('space_id');
    table.index('project_id');
    table.index('uploaded_by');
    table.index('table_id');
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('files');
  
  // Recreate with original INTEGER id
  await knex.schema.createTable('files', (table) => {
    table.increments('id').primary();
    table.integer('folder_id').unsigned();
    table.integer('space_id').unsigned();
    table.string('name', 255).notNullable();
    table.string('mime_type', 100);
    table.integer('size');
    table.text('path').notNullable();
    table.integer('uploaded_by').unsigned();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}
