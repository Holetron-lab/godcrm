/**
 * ADR-025: Fitness CSV Import Tests
 * TDD - Test First Approach
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';
import { dbRun, dbGet } from '../database/connection.js';

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
const TEST_UID = 99200;
async function createTestUserAndSpace() {
  // Create user with unique ID
  await dbRun(`
    INSERT INTO users (id, email, password_hash, name, encryption_key_encrypted)
    VALUES ($1, $2, 'hash', 'Test User', 'encrypted_key')
    ON CONFLICT (id) DO NOTHING
  `, [TEST_UID, `fitness-csv-${Date.now()}@test.com`]);

  // Create space
  const result = await dbRun(`
    INSERT INTO spaces (owner_id, name, type)
    VALUES ($1, 'Test Space CSV', 'personal')
  `, [TEST_UID]);

  return result.lastInsertRowid;
}

beforeEach(async () => {
  await setupTestDatabase();
  
  app = express();
  app.use(express.json());
  app.use(express.text({ type: 'text/csv' }));
  
  // Create test space
  spaceId = await createTestUserAndSpace();
  
  // Setup fitness routes
  const fitnessRoutes = (await import('../routes/v3/fitness.js')).default;
  app.use('/api/v3/fitness', fitnessRoutes);
});

afterEach(async () => {
  await cleanupTestDatabase();
});

describe('Fitness CSV Import', () => {
  
  describe('POST /api/v3/fitness/import/csv', () => {
    
    test('should import Hevy format CSV', async () => {
      const hevyCSV = `title,start_time,end_time,description,exercise_title,superset_id,reps,weight_kg,distance_km,duration_seconds,notes,rpe,set_type
Push Day,2026-01-15 08:00:00,2026-01-15 09:00:00,Chest and triceps,Bench Press (Barbell),,10,60,,,,7,warmup
Push Day,2026-01-15 08:00:00,2026-01-15 09:00:00,Chest and triceps,Bench Press (Barbell),,8,80,,,,8,normal
Push Day,2026-01-15 08:00:00,2026-01-15 09:00:00,Chest and triceps,Bench Press (Barbell),,6,90,,,,9,normal
Push Day,2026-01-15 08:00:00,2026-01-15 09:00:00,Chest and triceps,Incline Dumbbell Press,,10,24,,,,7,normal
Push Day,2026-01-15 08:00:00,2026-01-15 09:00:00,Chest and triceps,Incline Dumbbell Press,,10,24,,,,7,normal`;
      
      const response = await request(app)
        .post('/api/v3/fitness/import/csv')
        .query({ space_id: spaceId, format: 'hevy' })
        .set('Content-Type', 'text/csv')
        .send(hevyCSV);
      
      if (response.status !== 200) {
        console.log('Error response:', response.body);
      }
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.workouts_created).toBe(1);
      expect(response.body.data.sets_created).toBe(5);
    });

    test('should import Strong format CSV', async () => {
      const strongCSV = `Date,Workout Name,Exercise Name,Set Order,Weight,Weight Unit,Reps,RPE,Distance,Distance Unit,Seconds,Notes,Workout Notes,Workout Duration
2026-01-16,Pull Day,Deadlift (Barbell),1,100,kg,5,8,,,,,,3600
2026-01-16,Pull Day,Deadlift (Barbell),2,120,kg,5,8,,,,,,3600
2026-01-16,Pull Day,Deadlift (Barbell),3,140,kg,3,9,,,,,,3600
2026-01-16,Pull Day,Lat Pulldown (Cable),1,60,kg,10,7,,,,,,3600`;

      const response = await request(app)
        .post('/api/v3/fitness/import/csv')
        .query({ space_id: spaceId, format: 'strong' })
        .set('Content-Type', 'text/csv')
        .send(strongCSV);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.workouts_created).toBe(1);
      expect(response.body.data.sets_created).toBe(4);
    });

    test('should auto-detect format when not specified', async () => {
      const hevyCSV = `title,start_time,exercise_title,reps,weight_kg,set_type
Leg Day,2026-01-17 10:00:00,Squat (Barbell),5,100,normal
Leg Day,2026-01-17 10:00:00,Squat (Barbell),5,100,normal`;
      
      const response = await request(app)
        .post('/api/v3/fitness/import/csv')
        .query({ space_id: spaceId })
        .set('Content-Type', 'text/csv')
        .send(hevyCSV);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.format_detected).toBeDefined();
    });

    test('should require space_id', async () => {
      const response = await request(app)
        .post('/api/v3/fitness/import/csv')
        .set('Content-Type', 'text/csv')
        .send('title,start_time\nTest,2026-01-17');
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should handle empty CSV', async () => {
      const response = await request(app)
        .post('/api/v3/fitness/import/csv')
        .query({ space_id: spaceId })
        .set('Content-Type', 'text/csv')
        .send('');
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('EMPTY_CSV');
    });

    test('should skip rows with missing required fields', async () => {
      const csvWithMissing = `title,start_time,exercise_title,reps,weight_kg
Leg Day,2026-01-17 10:00:00,Squat,5,100
Leg Day,2026-01-17 10:00:00,,5,100
Leg Day,2026-01-17 10:00:00,Lunge,8,40`;
      
      const response = await request(app)
        .post('/api/v3/fitness/import/csv')
        .query({ space_id: spaceId })
        .set('Content-Type', 'text/csv')
        .send(csvWithMissing);
      
      expect(response.status).toBe(200);
      // Should import 2 rows, skip 1 with missing exercise
      expect(response.body.data.sets_created).toBe(2);
      expect(response.body.data.rows_skipped).toBe(1);
    });

    test('should convert lbs to kg when weight_unit is lbs', async () => {
      const strongCSV = `Date,Workout Name,Exercise Name,Set Order,Weight,Weight Unit,Reps
2026-01-17,Test,Bench Press,1,135,lbs,10`;

      const response = await request(app)
        .post('/api/v3/fitness/import/csv')
        .query({ space_id: spaceId })
        .set('Content-Type', 'text/csv')
        .send(strongCSV);
      
      expect(response.status).toBe(200);
      
      // 135 lbs ≈ 61.24 kg
      const { dbGet } = await import('../database/connection.js');
      const set = await dbGet('SELECT weight_kg FROM fitness_sets ORDER BY id DESC LIMIT 1');
      expect(set.weight_kg).toBeCloseTo(61.24, 1);
    });
  });
});
