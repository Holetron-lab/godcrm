// backend/database/migrations/knex/044_create_wellness_tables.js
// ADR-027: Wellness Ecosystem — Profile, Vitals, Gamification
export async function up(knex) {
  // wellness_profiles
  await knex.schema.createTable('wellness_profiles', (table) => {
    table.increments('id').primary();
    table.integer('space_id').references('id').inTable('spaces').notNullable().unique();
    table.string('gender', 10);
    table.date('birth_date');
    table.integer('height_cm');
    table.decimal('target_weight_kg', 5, 2);
    table.string('activity_level', 20);
    table.integer('bmr');
    table.integer('tdee');
    table.string('timezone', 50).defaultTo('UTC');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // wellness_vitals
  await knex.schema.createTable('wellness_vitals', (table) => {
    table.increments('id').primary();
    table.integer('space_id').references('id').inTable('spaces').notNullable();
    table.timestamp('measured_at').notNullable();
    table.string('vital_type', 50).notNullable();
    table.decimal('value', 10, 3).notNullable();
    table.string('unit', 20);
    table.string('source', 50).defaultTo('manual');
    table.text('notes');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['space_id', 'vital_type', 'measured_at'], 'idx_vitals_latest');
    table.index('space_id', 'idx_vitals_space');
  });

  // wellness_points
  await knex.schema.createTable('wellness_points', (table) => {
    table.increments('id').primary();
    table.integer('space_id').references('id').inTable('spaces').notNullable();
    table.timestamp('earned_at').defaultTo(knex.fn.now());
    table.integer('points').notNullable();
    table.string('source_type', 50).notNullable();
    table.integer('source_id');
    table.string('reason', 255);
    table.jsonb('metadata');

    table.index(['space_id', 'earned_at'], 'idx_points_space');
  });

  // wellness_levels
  await knex.schema.createTable('wellness_levels', (table) => {
    table.increments('id').primary();
    table.integer('space_id').references('id').inTable('spaces').notNullable().unique();
    table.integer('current_level').defaultTo(1);
    table.integer('total_xp').defaultTo(0);
    table.integer('level_xp').defaultTo(0);
    table.string('title', 100).defaultTo('Beginner');
    table.text('avatar_url');
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // wellness_achievements
  await knex.schema.createTable('wellness_achievements', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable();
    table.text('description');
    table.string('icon', 100);
    table.string('category', 50);
    table.string('tier', 20).defaultTo('bronze');
    table.jsonb('condition').notNullable();
    table.integer('points_reward').defaultTo(50);
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // wellness_user_achievements
  await knex.schema.createTable('wellness_user_achievements', (table) => {
    table.increments('id').primary();
    table.integer('space_id').references('id').inTable('spaces').notNullable();
    table.integer('achievement_id').references('id').inTable('wellness_achievements');
    table.timestamp('earned_at');
    table.decimal('progress', 5, 2).defaultTo(0);
    table.unique(['space_id', 'achievement_id']);
  });

  // wellness_streaks
  await knex.schema.createTable('wellness_streaks', (table) => {
    table.increments('id').primary();
    table.integer('space_id').references('id').inTable('spaces').notNullable();
    table.string('streak_type', 50).notNullable();
    table.integer('current_count').defaultTo(0);
    table.integer('longest_count').defaultTo(0);
    table.date('last_activity_date');
    table.date('started_at');
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.unique(['space_id', 'streak_type']);

    table.index('space_id', 'idx_streaks_space');
  });

  // Seed default achievements
  await knex('wellness_achievements').insert([
    { name: 'First Check-in', description: 'Log your first vital sign', icon: '❤️', category: 'health', tier: 'bronze', condition: JSON.stringify({ type: 'count', table: 'wellness_vitals', count: 1 }), points_reward: 10 },
    { name: 'Health Monitor', description: 'Log vitals for 7 days in a row', icon: '📊', category: 'health', tier: 'silver', condition: JSON.stringify({ type: 'streak', streak_type: 'vitals_logged', count: 7 }), points_reward: 50 },
    { name: 'Vital Master', description: 'Log vitals for 30 days in a row', icon: '🏆', category: 'health', tier: 'gold', condition: JSON.stringify({ type: 'streak', streak_type: 'vitals_logged', count: 30 }), points_reward: 200 },
    { name: 'First Workout', description: 'Complete your first workout', icon: '💪', category: 'fitness', tier: 'bronze', condition: JSON.stringify({ type: 'count', table: 'fitness_workouts', count: 1 }), points_reward: 10 },
    { name: 'Week Warrior', description: 'Work out 7 days in a row', icon: '🔥', category: 'fitness', tier: 'silver', condition: JSON.stringify({ type: 'streak', streak_type: 'workout', count: 7 }), points_reward: 50 },
    { name: 'Month Master', description: 'Work out 30 days in a row', icon: '🏆', category: 'fitness', tier: 'gold', condition: JSON.stringify({ type: 'streak', streak_type: 'workout', count: 30 }), points_reward: 200 },
    { name: 'Century Club', description: 'Complete 100 workouts', icon: '💯', category: 'fitness', tier: 'platinum', condition: JSON.stringify({ type: 'count', table: 'fitness_workouts', count: 100 }), points_reward: 500 },
    { name: 'Level 5', description: 'Reach Level 5', icon: '⭐', category: 'consistency', tier: 'bronze', condition: JSON.stringify({ type: 'level', level: 5 }), points_reward: 25 },
    { name: 'Level 10', description: 'Reach Level 10', icon: '🌟', category: 'consistency', tier: 'silver', condition: JSON.stringify({ type: 'level', level: 10 }), points_reward: 75 },
    { name: 'Level 25', description: 'Reach Level 25', icon: '✨', category: 'consistency', tier: 'gold', condition: JSON.stringify({ type: 'level', level: 25 }), points_reward: 150 },
    { name: 'Level 50', description: 'Reach Level 50', icon: '🎖️', category: 'consistency', tier: 'platinum', condition: JSON.stringify({ type: 'level', level: 50 }), points_reward: 500 },
  ]);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('wellness_streaks');
  await knex.schema.dropTableIfExists('wellness_user_achievements');
  await knex.schema.dropTableIfExists('wellness_achievements');
  await knex.schema.dropTableIfExists('wellness_levels');
  await knex.schema.dropTableIfExists('wellness_points');
  await knex.schema.dropTableIfExists('wellness_vitals');
  await knex.schema.dropTableIfExists('wellness_profiles');
}
