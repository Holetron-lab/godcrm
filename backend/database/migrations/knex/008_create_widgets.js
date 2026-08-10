// backend/database/migrations/knex/008_create_widgets.js
// Widgets: Dashboard components
export async function up(knex) {
  await knex.schema.createTable('widgets', (table) => {
    table.increments('id').primary();
    
    // Ownership & Location
    table.integer('dashboard_id').unsigned().notNullable()
      .references('id').inTable('dashboards').onDelete('CASCADE');
    table.integer('source_widget_id').unsigned()
      .references('id').inTable('widgets').onDelete('CASCADE');
    
    // Widget Type & Source
    table.enu('widget_type', ['preset', 'custom']).notNullable();
    table.string('preset_name', 255);
    
    // Widget Code (for custom widgets)
    table.text('code');
    table.integer('code_version').defaultTo(1);
    
    // Configuration
    table.string('title', 255).notNullable();
    table.text('description');
    table.string('icon', 50).defaultTo('🧩');
    
    // Data Binding & Config (JSON)
    table.text('config').notNullable().defaultTo('{}');
    
    // Layout (react-grid-layout format, JSON)
    table.text('position').notNullable().defaultTo('{"x":0,"y":0,"w":6,"h":4}');
    
    // Display
    table.boolean('is_visible').defaultTo(true);
    table.integer('order_index').defaultTo(0);
    
    // Metadata
    table.integer('created_by').unsigned()
      .references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes
    table.index('dashboard_id');
    table.index('widget_type');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('widgets');
}
