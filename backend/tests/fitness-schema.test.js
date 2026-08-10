// Test: Fitness Module Database Schema
// ADR-025: Fitness Module - LiftShift Clone
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';
import { dbGet, dbAll, dbRun } from '../database/connection.js';

// Skip dev user creation in tests (avoids NeoMetal dependency)
process.env.SKIP_DEV_USER = 'true';

const TEST_USER_ID = 99001;
const TEST_SPACE_ID = 99001;
const TEST_EXERCISE_ID = 99001;
const TEST_WORKOUT_ID = 99001;

// Helper to create test user with all required fields
async function createTestUser(id = TEST_USER_ID) {
  await dbRun(`
    INSERT INTO users (id, email, password_hash, name, encryption_key_encrypted)
    VALUES ($1, $2, 'hash', 'Test User', 'test_encrypted_key')
    ON CONFLICT (id) DO NOTHING
  `, [id, `fitness-schema-test${id}@test.com`]);
}

// Helper to create test space
async function createTestSpace(id = TEST_SPACE_ID, ownerId = TEST_USER_ID) {
  await createTestUser(ownerId);
  await dbRun(`
    INSERT INTO spaces (id, name, owner_id, type)
    VALUES ($1, 'Test Space', $2, 'personal')
    ON CONFLICT (id) DO NOTHING
  `, [id, ownerId]);
}

// Cleanup helper
async function cleanupFitnessTestData() {
  await dbRun(`DELETE FROM fitness_sets WHERE workout_id = $1`, [TEST_WORKOUT_ID]);
  await dbRun(`DELETE FROM fitness_workouts WHERE space_id = $1`, [TEST_SPACE_ID]);
  await dbRun(`DELETE FROM fitness_exercises WHERE name IN ('Bench Press', 'Custom Exercise', 'Squat') AND (space_id = $1 OR space_id IS NULL)`, [TEST_SPACE_ID]);
  await dbRun(`DELETE FROM spaces WHERE id = $1`, [TEST_SPACE_ID]);
  await dbRun(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]);
}

// Helper: get column names for a table (PostgreSQL)
async function getColumnNames(tableName) {
  const rows = await dbAll(
    `SELECT column_name as name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [tableName]
  );
  return rows.map(r => r.name);
}

describe('Fitness Database Schema', () => {
  beforeEach(async () => {
    await setupTestDatabase();
    await cleanupFitnessTestData();
  });

  afterEach(async () => {
    await cleanupFitnessTestData();
    await cleanupTestDatabase();
  });

  describe('fitness_exercises table', () => {
    test('should exist with all required columns', async () => {
      const columnNames = await getColumnNames('fitness_exercises');

      expect(columnNames.length).toBeGreaterThan(0);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('space_id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('equipment');
      expect(columnNames).toContain('primary_muscle');
      expect(columnNames).toContain('secondary_muscle');
      expect(columnNames).toContain('category');
      expect(columnNames).toContain('created_at');
    });

    test('should allow inserting global exercise (space_id = NULL)', async () => {
      await dbRun(`
        INSERT INTO fitness_exercises (name, equipment, primary_muscle, category)
        VALUES ($1, $2, $3, $4)
      `, ['Bench Press', 'barbell', 'Chest', 'compound']);

      const exercise = await dbGet(`SELECT * FROM fitness_exercises WHERE name = $1`, ['Bench Press']);

      expect(exercise).toBeDefined();
      expect(exercise.name).toBe('Bench Press');
      expect(exercise.space_id).toBeNull();
      expect(exercise.primary_muscle).toBe('Chest');

      // Cleanup
      await dbRun(`DELETE FROM fitness_exercises WHERE name = 'Bench Press' AND space_id IS NULL`);
    });

    test('should allow inserting user-specific exercise (space_id set)', async () => {
      await createTestSpace();

      await dbRun(`
        INSERT INTO fitness_exercises (space_id, name, equipment, primary_muscle, category)
        VALUES ($1, $2, $3, $4, $5)
      `, [TEST_SPACE_ID, 'Custom Exercise', 'bodyweight', 'Core', 'isolation']);

      const exercise = await dbGet(`SELECT * FROM fitness_exercises WHERE name = $1`, ['Custom Exercise']);

      expect(exercise).toBeDefined();
      expect(exercise.space_id).toBe(TEST_SPACE_ID);
    });
  });

  describe('fitness_workouts table', () => {
    test('should exist with all required columns', async () => {
      const columnNames = await getColumnNames('fitness_workouts');

      expect(columnNames.length).toBeGreaterThan(0);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('space_id');
      expect(columnNames).toContain('title');
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('started_at');
      expect(columnNames).toContain('ended_at');
      expect(columnNames).toContain('notes');
      expect(columnNames).toContain('source');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    test('should allow inserting workout', async () => {
      await createTestSpace();

      await dbRun(`
        INSERT INTO fitness_workouts (id, space_id, title, started_at, source)
        VALUES ($1, $2, $3, $4, $5)
      `, [TEST_WORKOUT_ID, TEST_SPACE_ID, 'Morning Workout', '2026-01-17 08:00:00', 'manual']);

      const workout = await dbGet(`SELECT * FROM fitness_workouts WHERE title = $1`, ['Morning Workout']);

      expect(workout).toBeDefined();
      expect(workout.space_id).toBe(TEST_SPACE_ID);
      expect(workout.source).toBe('manual');
    });
  });

  describe('fitness_sets table', () => {
    test('should exist with all required columns', async () => {
      const columnNames = await getColumnNames('fitness_sets');

      expect(columnNames.length).toBeGreaterThan(0);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('workout_id');
      expect(columnNames).toContain('exercise_id');
      expect(columnNames).toContain('exercise_name');
      expect(columnNames).toContain('set_index');
      expect(columnNames).toContain('set_type');
      expect(columnNames).toContain('weight_kg');
      expect(columnNames).toContain('reps');
      expect(columnNames).toContain('rpe');
      expect(columnNames).toContain('distance_km');
      expect(columnNames).toContain('duration_seconds');
      expect(columnNames).toContain('is_pr');
      expect(columnNames).toContain('created_at');
    });

    test('should allow inserting set with exercise reference', async () => {
      await createTestSpace();
      await dbRun(`INSERT INTO fitness_exercises (id, name, primary_muscle) VALUES ($1, 'Squat', 'Quads') ON CONFLICT (id) DO NOTHING`, [TEST_EXERCISE_ID]);
      await dbRun(`INSERT INTO fitness_workouts (id, space_id, title, started_at) VALUES ($1, $2, 'Leg Day', '2026-01-17 08:00:00')`, [TEST_WORKOUT_ID, TEST_SPACE_ID]);

      await dbRun(`
        INSERT INTO fitness_sets (workout_id, exercise_id, exercise_name, set_index, weight_kg, reps, is_pr)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [TEST_WORKOUT_ID, TEST_EXERCISE_ID, 'Squat', 1, 100, 5, 1]);

      const set = await dbGet(`SELECT * FROM fitness_sets WHERE workout_id = $1`, [TEST_WORKOUT_ID]);

      expect(set).toBeDefined();
      expect(set.exercise_name).toBe('Squat');
      expect(Number(set.weight_kg)).toBe(100);
      expect(set.reps).toBe(5);
      expect(set.is_pr).toBeTruthy();
    });

    test('should cascade delete sets when workout is deleted', async () => {
      await createTestSpace();
      await dbRun(`INSERT INTO fitness_workouts (id, space_id, title, started_at) VALUES ($1, $2, 'Test Workout', '2026-01-17 08:00:00')`, [TEST_WORKOUT_ID, TEST_SPACE_ID]);
      await dbRun(`INSERT INTO fitness_sets (workout_id, exercise_name, set_index, weight_kg, reps) VALUES ($1, 'Bench', 1, 80, 8)`, [TEST_WORKOUT_ID]);
      await dbRun(`INSERT INTO fitness_sets (workout_id, exercise_name, set_index, weight_kg, reps) VALUES ($1, 'Bench', 2, 80, 7)`, [TEST_WORKOUT_ID]);

      // Verify sets exist
      const setsBefore = await dbAll(`SELECT * FROM fitness_sets WHERE workout_id = $1`, [TEST_WORKOUT_ID]);
      expect(setsBefore.length).toBe(2);

      // Delete workout
      await dbRun(`DELETE FROM fitness_workouts WHERE id = $1`, [TEST_WORKOUT_ID]);

      // Verify sets are deleted
      const setsAfter = await dbAll(`SELECT * FROM fitness_sets WHERE workout_id = $1`, [TEST_WORKOUT_ID]);
      expect(setsAfter.length).toBe(0);
    });
  });

  describe('fitness_workout_sets view', () => {
    test('should return joined workout and set data', async () => {
      await createTestSpace();
      await dbRun(`INSERT INTO fitness_workouts (id, space_id, title, started_at, ended_at, description) VALUES ($1, $2, 'Push Day', '2026-01-17 08:00:00', '2026-01-17 09:00:00', 'Chest and Triceps')`, [TEST_WORKOUT_ID, TEST_SPACE_ID]);
      await dbRun(`INSERT INTO fitness_sets (workout_id, exercise_name, set_index, set_type, weight_kg, reps, is_pr) VALUES ($1, 'Bench Press', 1, 'warmup', 60, 10, false)`, [TEST_WORKOUT_ID]);
      await dbRun(`INSERT INTO fitness_sets (workout_id, exercise_name, set_index, set_type, weight_kg, reps, is_pr) VALUES ($1, 'Bench Press', 2, 'normal', 100, 5, true)`, [TEST_WORKOUT_ID]);

      const rows = await dbAll(`SELECT * FROM fitness_workout_sets WHERE workout_id = $1 ORDER BY set_index`, [TEST_WORKOUT_ID]);

      expect(rows.length).toBe(2);
      expect(rows[0].workout_title).toBe('Push Day');
      expect(rows[0].exercise_name).toBe('Bench Press');
      expect(rows[0].set_type).toBe('warmup');
      expect(rows[1].set_type).toBe('normal');
      expect(rows[1].is_pr).toBeTruthy();
    });
  });
});
