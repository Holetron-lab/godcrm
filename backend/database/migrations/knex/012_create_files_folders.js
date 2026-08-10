// backend/database/migrations/knex/012_create_files_folders.js
// Files and Folders System
export async function up(knex) {
  // Folders
  await knex.schema.createTable('folders', (table) => {
    table.increments('id').primary();
    table.integer('space_id').unsigned().notNullable()
      .references('id').inTable('spaces').onDelete('CASCADE');
    table.integer('parent_id').unsigned()
      .references('id').inTable('folders').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.text('path');
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('space_id');
    table.index('parent_id');
  });

  // Files
  await knex.schema.createTable('files', (table) => {
    table.increments('id').primary();
    table.integer('folder_id').unsigned()
      .references('id').inTable('folders').onDelete('SET NULL');
    table.integer('space_id').unsigned()
      .references('id').inTable('spaces').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.string('mime_type', 100);
    table.integer('size');
    table.text('path').notNullable();
    table.integer('uploaded_by').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('folder_id');
    table.index('space_id');
    table.index('uploaded_by');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('files');
  await knex.schema.dropTableIfExists('folders');
}
