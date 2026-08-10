// backend/database/migrations/knex/026_create_widget_library_tables.js
// ADR-073: Widget Picker System — Database tables for widget library, favorites, and history

export async function up(knex) {
  // ===================================================================
  // 1. widget_library — Stores widgets available for quick-add
  // ===================================================================
  await knex.schema.createTable('widget_library', (table) => {
    table.increments('id').primary();

    table.integer('widget_id').unsigned().notNullable()
      .references('id').inTable('widgets').onDelete('CASCADE');
    table.integer('space_id').unsigned().notNullable()
      .references('id').inTable('spaces');

    table.boolean('is_public').defaultTo(false);
    table.boolean('is_template').defaultTo(false);
    table.integer('use_count').defaultTo(0);
    table.timestamp('last_used_at');
    table.specificType('tags', 'TEXT[]');  // PostgreSQL array type

    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique('widget_id');
    table.index('space_id', 'idx_widget_library_space');
    table.index('is_public', 'idx_widget_library_public');
  });

  // GIN index for tags array search (PostgreSQL only)
  await knex.raw('CREATE INDEX idx_widget_library_tags ON widget_library USING GIN(tags)');

  // ===================================================================
  // 2. user_widget_favorites — User's favorite widgets
  // ===================================================================
  await knex.schema.createTable('user_widget_favorites', (table) => {
    table.increments('id').primary();

    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.integer('widget_id').unsigned().notNullable()
      .references('id').inTable('widgets').onDelete('CASCADE');

    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.unique(['user_id', 'widget_id']);
    table.index('user_id', 'idx_favorites_user');
  });

  // ===================================================================
  // 3. user_widget_history — Tracks recently used widgets
  // ===================================================================
  await knex.schema.createTable('user_widget_history', (table) => {
    table.increments('id').primary();

    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.integer('widget_id').unsigned().notNullable()
      .references('id').inTable('widgets').onDelete('CASCADE');

    table.timestamp('accessed_at').defaultTo(knex.fn.now());

    table.index('user_id', 'idx_history_user');
  });

  // Composite index for efficient "recent by user" queries
  await knex.raw('CREATE INDEX idx_history_recent ON user_widget_history(user_id, accessed_at DESC)');

  // ===================================================================
  // 4. Trigger to keep only last 50 history entries per user (PostgreSQL)
  // ===================================================================
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trim_widget_history() RETURNS TRIGGER AS $$
    BEGIN
      DELETE FROM user_widget_history
      WHERE user_id = NEW.user_id
        AND id NOT IN (
          SELECT id FROM user_widget_history
          WHERE user_id = NEW.user_id
          ORDER BY accessed_at DESC
          LIMIT 50
        );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER trim_history_trigger
    AFTER INSERT ON user_widget_history
    FOR EACH ROW EXECUTE FUNCTION trim_widget_history();
  `);

  // ===================================================================
  // 5. Data Migration — Auto-populate widget_library from existing modules
  // ===================================================================
  await knex.raw(`
    INSERT INTO widget_library (widget_id, space_id, is_public, tags)
    SELECT
      w.id,
      m.space_id,
      false,
      ARRAY[w.preset_name]::TEXT[]
    FROM widgets w
    JOIN modules m ON m.widget_id = w.id
    ON CONFLICT (widget_id) DO NOTHING
  `);
}

export async function down(knex) {
  // Drop trigger first
  await knex.raw('DROP TRIGGER IF EXISTS trim_history_trigger ON user_widget_history');
  await knex.raw('DROP FUNCTION IF EXISTS trim_widget_history()');

  // Drop tables in reverse order
  await knex.schema.dropTableIfExists('user_widget_history');
  await knex.schema.dropTableIfExists('user_widget_favorites');
  await knex.schema.dropTableIfExists('widget_library');
}
