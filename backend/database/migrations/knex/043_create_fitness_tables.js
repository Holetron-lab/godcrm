// backend/database/migrations/knex/043_create_fitness_tables.js
// ADR-025: Fitness Module — exercises, workouts, sets
export async function up(knex) {
  // fitness_exercises
  await knex.schema.createTable('fitness_exercises', (table) => {
    table.increments('id').primary();
    table.integer('space_id').references('id').inTable('spaces');
    table.string('name', 255).notNullable();
    table.string('equipment', 100);
    table.string('primary_muscle', 100);
    table.string('secondary_muscle', 100);
    table.string('category', 50);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // fitness_workouts
  await knex.schema.createTable('fitness_workouts', (table) => {
    table.increments('id').primary();
    table.integer('space_id').references('id').inTable('spaces').notNullable();
    table.string('title', 255);
    table.text('description');
    table.timestamp('started_at').notNullable();
    table.timestamp('ended_at');
    table.text('notes');
    table.string('source', 50).defaultTo('manual');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('space_id', 'idx_fitness_workouts_space');
    table.index(['space_id', 'started_at'], 'idx_fitness_workouts_date');
  });

  // fitness_sets
  await knex.schema.createTable('fitness_sets', (table) => {
    table.increments('id').primary();
    table.integer('workout_id').references('id').inTable('fitness_workouts').onDelete('CASCADE');
    table.integer('exercise_id').references('id').inTable('fitness_exercises');
    table.string('exercise_name', 255);
    table.integer('set_index').notNullable();
    table.string('set_type', 50).defaultTo('normal');
    table.decimal('weight_kg', 7, 2);
    table.integer('reps');
    table.decimal('rpe', 3, 1);
    table.decimal('distance_km', 7, 3);
    table.integer('duration_seconds');
    table.boolean('is_pr').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('workout_id', 'idx_fitness_sets_workout');
    table.index('exercise_name', 'idx_fitness_sets_exercise');
  });

  // Partial index for PRs
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_fitness_sets_pr ON fitness_sets(is_pr) WHERE is_pr = true');

  // Unique constraint for exercises per space
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_fitness_exercises_unique ON fitness_exercises(space_id, name) WHERE space_id IS NOT NULL');

  // Seed global exercises
  await knex('fitness_exercises').insert([
    { space_id: null, name: 'Bench Press', equipment: 'barbell', primary_muscle: 'Chest', category: 'compound' },
    { space_id: null, name: 'Squat', equipment: 'barbell', primary_muscle: 'Quads', category: 'compound' },
    { space_id: null, name: 'Deadlift', equipment: 'barbell', primary_muscle: 'Back', category: 'compound' },
    { space_id: null, name: 'Overhead Press', equipment: 'barbell', primary_muscle: 'Shoulders', category: 'compound' },
    { space_id: null, name: 'Barbell Row', equipment: 'barbell', primary_muscle: 'Back', category: 'compound' },
    { space_id: null, name: 'Pull-up', equipment: 'bodyweight', primary_muscle: 'Back', category: 'compound' },
    { space_id: null, name: 'Dip', equipment: 'bodyweight', primary_muscle: 'Chest', category: 'compound' },
    { space_id: null, name: 'Bicep Curl', equipment: 'dumbbell', primary_muscle: 'Biceps', category: 'isolation' },
    { space_id: null, name: 'Tricep Extension', equipment: 'cable', primary_muscle: 'Triceps', category: 'isolation' },
    { space_id: null, name: 'Leg Press', equipment: 'machine', primary_muscle: 'Quads', category: 'compound' },
    { space_id: null, name: 'Lat Pulldown', equipment: 'cable', primary_muscle: 'Back', category: 'compound' },
    { space_id: null, name: 'Leg Curl', equipment: 'machine', primary_muscle: 'Hamstrings', category: 'isolation' },
    { space_id: null, name: 'Leg Extension', equipment: 'machine', primary_muscle: 'Quads', category: 'isolation' },
    { space_id: null, name: 'Lateral Raise', equipment: 'dumbbell', primary_muscle: 'Shoulders', category: 'isolation' },
    { space_id: null, name: 'Face Pull', equipment: 'cable', primary_muscle: 'Shoulders', category: 'isolation' },
    { space_id: null, name: 'Calf Raise', equipment: 'machine', primary_muscle: 'Calves', category: 'isolation' },
    { space_id: null, name: 'Plank', equipment: 'bodyweight', primary_muscle: 'Core', category: 'isolation' },
    { space_id: null, name: 'Russian Twist', equipment: 'bodyweight', primary_muscle: 'Core', category: 'isolation' },
    { space_id: null, name: 'Incline Bench Press', equipment: 'barbell', primary_muscle: 'Chest', category: 'compound' },
    { space_id: null, name: 'Romanian Deadlift', equipment: 'barbell', primary_muscle: 'Hamstrings', category: 'compound' },
  ]);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('fitness_sets');
  await knex.schema.dropTableIfExists('fitness_workouts');
  await knex.schema.dropTableIfExists('fitness_exercises');
}
