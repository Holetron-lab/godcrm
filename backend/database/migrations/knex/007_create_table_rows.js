// backend/database/migrations/knex/007_create_table_rows.js
// Table Rows: Dynamic data storage with JSON
//
// ⚠️ DEPRECATED — DOES NOT REFLECT PRODUCTION SCHEMA (ADR-0156).
// This migration declares a PRIMARY KEY on `id`, a FOREIGN KEY to
// `universal_tables`, a UNIQUE constraint on `base_id`, and three indexes
// (table_id, base_id, created_by). NONE of these exist on the live
// `table_rows` table — prod has no PK, no FK, no UNIQUE, and (until the
// ADR-0156 DDL chain lands) no index on table_id. Treat this file as
// historical intent, NOT as a description of reality. The authoritative
// description of the live schema and the forward-only reconciliation plan
// is ADR-0156. Do not rely on this file to reason about prod.
export async function up(knex) {
  await knex.schema.createTable('table_rows', (table) => {
    table.increments('id').primary();
    table.integer('table_id').unsigned().notNullable()
      .references('id').inTable('universal_tables').onDelete('CASCADE');
    table.string('base_id', 255).unique().notNullable();
    table.text('data').notNullable(); // JSON data
    table.integer('created_by').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes
    table.index('table_id');
    table.index('base_id');
    table.index('created_by');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('table_rows');
}
