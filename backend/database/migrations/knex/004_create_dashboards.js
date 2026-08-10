// backend/database/migrations/knex/004_create_dashboards.js
// Dashboards: Container for widgets
export async function up(knex) {
  await knex.schema.createTable('dashboards', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned()
      .references('id').inTable('users').onDelete('CASCADE');
    table.integer('space_id').unsigned()
      .references('id').inTable('spaces').onDelete('CASCADE');
    table.integer('project_id').unsigned()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.string('name', 255).notNullable();
    table.text('description');
    table.string('icon', 50).defaultTo('📊');
    table.boolean('is_default').defaultTo(false);
    table.integer('order_index').defaultTo(0);
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes
    table.index('user_id');
    table.index('space_id');
    table.index('project_id');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('dashboards');
}
