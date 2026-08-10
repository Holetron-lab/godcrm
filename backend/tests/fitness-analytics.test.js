// @vitest-environment node
/**
 * ADR-025: Fitness Analytics API Tests
 * TDD - Test First Approach
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';
import { dbRun } from '../database/connection.js';

// Set test mode
process.env.TEST_MODE = 'true';
process.env.JWT_SECRET = 'test-secret-key-for-fitness';
process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-32-characters!!';
process.env.SKIP_DEV_USER = 'true';

let app;
let spaceId;

/**
 * Helper to create test user and space
 */
const TEST_UID = 99100;
async function createTestUserAndSpace() {
  await dbRun(`
    INSERT INTO users (id, email, password_hash, name, encryption_key_encrypted)
    VALUES ($1, $2, 'hash', 'Test User', 'encrypted_key')
    ON CONFLICT (id) DO NOTHING
  `, [TEST_UID, `fitness-analytics-${Date.now()}@test.com`]);

  const result = await dbRun(`
    INSERT INTO spaces (owner_id, name, type)
    VALUES ($1, 'Test Space Analytics', 'personal')
  `, [TEST_UID]);

  return result.lastInsertRowid;
}

/**
 * Helper to seed workout data for analytics tests
 */
async function seedAnalyticsData(spaceId) {
  // Create workouts over the past week (relative to today so streak/week filters work)
  const today = new Date();
  const makeDate = (daysAgo) => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0] + ' 08:00:00';
  };
  const dates = [
    makeDate(7), // Day 1
    makeDate(5), // Day 3
    makeDate(3), // Day 5
    makeDate(2), // Day 6
    makeDate(0), // Day 8 (today)
  ];
  
  // Clean up any previous fitness data to avoid PK conflicts with SERIAL
  await dbRun(`DELETE FROM fitness_sets`);
  await dbRun(`DELETE FROM fitness_workouts`);

  for (let i = 0; i < dates.length; i++) {
    const workoutResult = await dbRun(`
      INSERT INTO fitness_workouts (space_id, title, started_at, ended_at)
      VALUES (?, ?, ?, ?)
    `, [spaceId, `Workout ${i + 1}`, dates[i], dates[i].replace('08:00:00', '09:00:00')]);
    const workoutId = workoutResult.lastInsertRowid;

    // Add sets with increasing weights (for PR detection)
    await dbRun(`
      INSERT INTO fitness_sets (workout_id, exercise_name, set_index, weight_kg, reps, is_pr)
      VALUES (?, 'Bench Press', 1, ?, 5, ?)
    `, [workoutId, 60 + i * 10, i === dates.length - 1 ? true : false]); // Last one is PR

    await dbRun(`
      INSERT INTO fitness_sets (workout_id, exercise_name, set_index, weight_kg, reps)
      VALUES (?, 'Squat', 1, ?, 5)
    `, [workoutId, 80 + i * 10]);
  }
}

beforeEach(async () => {
  await setupTestDatabase();
  
  app = express();
  app.use(express.json());
  
  spaceId = await createTestUserAndSpace();
  await seedAnalyticsData(spaceId);
  
  const fitnessRoutes = (await import('../routes/v3/fitness.js')).default;
  app.use('/api/v3/fitness', fitnessRoutes);
});

afterEach(async () => {
  await cleanupTestDatabase();
});

describe('Fitness Analytics API', () => {
  
  describe('GET /api/v3/fitness/analytics/summary', () => {
    test('should return workout summary stats', async () => {
      const response = await request(app)
        .get('/api/v3/fitness/analytics/summary')
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.total_workouts).toBe(5);
      expect(response.body.data.total_sets).toBe(10);
      expect(response.body.data.total_volume).toBeGreaterThan(0);
      expect(response.body.data.total_prs).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/v3/fitness/analytics/volume', () => {
    test('should return volume by day', async () => {
      const response = await request(app)
        .get('/api/v3/fitness/analytics/volume')
        .query({ space_id: spaceId, period: 'week' });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty('date');
      expect(response.body.data[0]).toHaveProperty('volume');
    });

    test('should return volume by exercise', async () => {
      const response = await request(app)
        .get('/api/v3/fitness/analytics/volume')
        .query({ space_id: spaceId, group_by: 'exercise' });
      
      expect(response.status).toBe(200);
      expect(response.body.data.some(d => d.exercise === 'Bench Press')).toBe(true);
      expect(response.body.data.some(d => d.exercise === 'Squat')).toBe(true);
    });
  });

  describe('GET /api/v3/fitness/analytics/prs', () => {
    test('should return personal records', async () => {
      const response = await request(app)
        .get('/api/v3/fitness/analytics/prs')
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      expect(response.body.data[0]).toHaveProperty('exercise_name');
      expect(response.body.data[0]).toHaveProperty('weight_kg');
    });
  });

  describe('GET /api/v3/fitness/analytics/streak', () => {
    test('should return current workout streak', async () => {
      const response = await request(app)
        .get('/api/v3/fitness/analytics/streak')
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.current_streak).toBeGreaterThanOrEqual(0);
      expect(response.body.data.longest_streak).toBeGreaterThanOrEqual(0);
      expect(response.body.data.workouts_this_week).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v3/fitness/analytics/muscle-volume', () => {
    test('should return volume by muscle group', async () => {
      // First add exercise with muscle mapping
      await dbRun(`
        INSERT INTO fitness_exercises (name, primary_muscle, equipment)
        VALUES ('Bench Press', 'chest', 'barbell')
      `);
      await dbRun(`
        INSERT INTO fitness_exercises (name, primary_muscle, equipment)
        VALUES ('Squat', 'quadriceps', 'barbell')
      `);
      
      const response = await request(app)
        .get('/api/v3/fitness/analytics/muscle-volume')
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /api/v3/fitness/analytics/exercise/:exerciseName', () => {
    test('should return exercise-specific analytics', async () => {
      const response = await request(app)
        .get('/api/v3/fitness/analytics/exercise/Bench Press')
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.exercise_name).toBe('Bench Press');
      expect(response.body.data.total_sets).toBeGreaterThan(0);
      expect(response.body.data.max_weight).toBeGreaterThan(0);
      expect(response.body.data.estimated_1rm).toBeGreaterThan(0);
    });
  });
});
