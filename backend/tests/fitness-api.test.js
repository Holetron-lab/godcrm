/**
 * ADR-025: Fitness Module API Tests
 * TDD - Test First Approach
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';

// Set test mode
process.env.TEST_MODE = 'true';
process.env.JWT_SECRET = 'test-secret-key-for-fitness';
process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-32-characters!!';
process.env.SKIP_DEV_USER = 'true';

let app;
let authToken;
let spaceId;

/**
 * Helper to setup test user and get auth token
 */
async function setupAuthenticatedUser() {
  const authRoutes = (await import('../routes/v3/auth.js')).default;
  app.use('/api/v3/auth', authRoutes);
  
  // Register user with unique email to avoid conflicts
  const registerRes = await request(app)
    .post('/api/v3/auth/register')
    .send({ email: `fitness-${Date.now()}@test.com`, password: 'TestPass123!', name: 'Fitness User' });
  
  authToken = registerRes.body.data?.accessToken;
  
  // Get user's personal space
  const spacesRoutes = (await import('../routes/v3/spaces.js')).default;
  app.use('/api/v3/spaces', spacesRoutes);
  
  const spacesRes = await request(app)
    .get('/api/v3/spaces')
    .set('Authorization', `Bearer ${authToken}`);
  
  // Find personal space
  const personalSpace = spacesRes.body.data?.find(s => s.type === 'personal');
  spaceId = personalSpace?.id || 1;
  
  return { authToken, spaceId };
}

beforeEach(async () => {
  await setupTestDatabase();
  
  app = express();
  app.use(express.json());
  
  // Setup fitness routes
  const fitnessRoutes = (await import('../routes/v3/fitness.js')).default;
  app.use('/api/v3/fitness', fitnessRoutes);
  
  await setupAuthenticatedUser();
});

afterEach(async () => {
  await cleanupTestDatabase();
});

describe('Fitness API - Workouts CRUD', () => {
  
  describe('POST /api/v3/fitness/workouts', () => {
    test('should create a new workout', async () => {
      const response = await request(app)
        .post('/api/v3/fitness/workouts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          title: 'Morning Push Day',
          started_at: '2026-01-17T08:00:00Z',
          notes: 'Feeling strong today'
        });
      
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.title).toBe('Morning Push Day');
      expect(response.body.data.space_id).toBe(spaceId);
    });

    test('should require space_id', async () => {
      const response = await request(app)
        .post('/api/v3/fitness/workouts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'No Space Workout',
          started_at: '2026-01-17T08:00:00Z'
        });
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should require started_at', async () => {
      const response = await request(app)
        .post('/api/v3/fitness/workouts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          title: 'No Date Workout'
        });
      
      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v3/fitness/workouts', () => {
    test('should list workouts for space', async () => {
      // Create workout first
      await request(app)
        .post('/api/v3/fitness/workouts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          title: 'Test Workout',
          started_at: '2026-01-17T08:00:00Z'
        });
      
      const response = await request(app)
        .get('/api/v3/fitness/workouts')
        .query({ space_id: spaceId })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    });

    test('should return empty array for space with no workouts', async () => {
      const response = await request(app)
        .get('/api/v3/fitness/workouts')
        .query({ space_id: 9999 })
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });

  describe('GET /api/v3/fitness/workouts/:id', () => {
    test('should get single workout with sets', async () => {
      // Create workout
      const createRes = await request(app)
        .post('/api/v3/fitness/workouts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          title: 'Detailed Workout',
          started_at: '2026-01-17T08:00:00Z'
        });
      
      const workoutId = createRes.body.data.id;
      
      // Add a set
      await request(app)
        .post(`/api/v3/fitness/workouts/${workoutId}/sets`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          exercise_name: 'Bench Press',
          set_index: 1,
          weight_kg: 80,
          reps: 10
        });
      
      const response = await request(app)
        .get(`/api/v3/fitness/workouts/${workoutId}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(workoutId);
      expect(response.body.data.title).toBe('Detailed Workout');
      expect(Array.isArray(response.body.data.sets)).toBe(true);
      expect(response.body.data.sets.length).toBe(1);
      expect(response.body.data.sets[0].exercise_name).toBe('Bench Press');
    });

    test('should return 404 for non-existent workout', async () => {
      const response = await request(app)
        .get('/api/v3/fitness/workouts/99999')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/v3/fitness/workouts/:id', () => {
    test('should update workout', async () => {
      // Create workout
      const createRes = await request(app)
        .post('/api/v3/fitness/workouts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          title: 'Original Title',
          started_at: '2026-01-17T08:00:00Z'
        });
      
      const workoutId = createRes.body.data.id;
      
      const response = await request(app)
        .put(`/api/v3/fitness/workouts/${workoutId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Updated Title',
          ended_at: '2026-01-17T09:30:00Z',
          notes: 'Great session!'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.data.title).toBe('Updated Title');
      expect(response.body.data.notes).toBe('Great session!');
    });
  });

  describe('DELETE /api/v3/fitness/workouts/:id', () => {
    test('should delete workout and its sets', async () => {
      // Create workout with set
      const createRes = await request(app)
        .post('/api/v3/fitness/workouts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          title: 'To Delete',
          started_at: '2026-01-17T08:00:00Z'
        });
      
      const workoutId = createRes.body.data.id;
      
      // Add set
      await request(app)
        .post(`/api/v3/fitness/workouts/${workoutId}/sets`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          exercise_name: 'Squat',
          set_index: 1,
          weight_kg: 100,
          reps: 5
        });
      
      // Delete workout
      const deleteRes = await request(app)
        .delete(`/api/v3/fitness/workouts/${workoutId}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      
      // Verify workout is gone
      const getRes = await request(app)
        .get(`/api/v3/fitness/workouts/${workoutId}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(getRes.status).toBe(404);
    });
  });
});

describe('Fitness API - Sets CRUD', () => {
  let workoutId;
  
  beforeEach(async () => {
    // Create a workout for set tests
    const createRes = await request(app)
      .post('/api/v3/fitness/workouts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        space_id: spaceId,
        title: 'Set Test Workout',
        started_at: '2026-01-17T08:00:00Z'
      });
    
    workoutId = createRes.body.data?.id;
  });

  describe('POST /api/v3/fitness/workouts/:workoutId/sets', () => {
    test('should create a new set', async () => {
      const response = await request(app)
        .post(`/api/v3/fitness/workouts/${workoutId}/sets`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          exercise_name: 'Deadlift',
          set_index: 1,
          set_type: 'normal',
          weight_kg: 140,
          reps: 5,
          rpe: 8
        });
      
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.exercise_name).toBe('Deadlift');
      expect(Number(response.body.data.weight_kg)).toBe(140);
      expect(response.body.data.reps).toBe(5);
    });

    test('should allow creating warmup set', async () => {
      const response = await request(app)
        .post(`/api/v3/fitness/workouts/${workoutId}/sets`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          exercise_name: 'Bench Press',
          set_index: 1,
          set_type: 'warmup',
          weight_kg: 40,
          reps: 15
        });
      
      expect(response.status).toBe(201);
      expect(response.body.data.set_type).toBe('warmup');
    });

    test('should require exercise_name', async () => {
      const response = await request(app)
        .post(`/api/v3/fitness/workouts/${workoutId}/sets`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          set_index: 1,
          weight_kg: 80,
          reps: 10
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/v3/fitness/sets/:id', () => {
    test('should update a set', async () => {
      // Create set
      const createRes = await request(app)
        .post(`/api/v3/fitness/workouts/${workoutId}/sets`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          exercise_name: 'Squat',
          set_index: 1,
          weight_kg: 100,
          reps: 8
        });
      
      const setId = createRes.body.data.id;
      
      // Update set
      const response = await request(app)
        .put(`/api/v3/fitness/sets/${setId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          weight_kg: 105,
          reps: 10,
          is_pr: true
        });
      
      expect(response.status).toBe(200);
      expect(Number(response.body.data.weight_kg)).toBe(105);
      expect(response.body.data.reps).toBe(10);
      expect(response.body.data.is_pr).toBe(true);
    });
  });

  describe('DELETE /api/v3/fitness/sets/:id', () => {
    test('should delete a set', async () => {
      // Create set
      const createRes = await request(app)
        .post(`/api/v3/fitness/workouts/${workoutId}/sets`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          exercise_name: 'Pull-up',
          set_index: 1,
          reps: 12
        });
      
      const setId = createRes.body.data.id;
      
      // Delete set
      const response = await request(app)
        .delete(`/api/v3/fitness/sets/${setId}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});

describe('Fitness API - Exercises Catalog', () => {
  describe('GET /api/v3/fitness/exercises', () => {
    test('should list exercises', async () => {
      const response = await request(app)
        .get('/api/v3/fitness/exercises')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should search exercises by name', async () => {
      // First create an exercise with unique name
      const uniqueName = `Barbell Bench Press ${Date.now()}`;
      await request(app)
        .post('/api/v3/fitness/exercises')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: uniqueName,
          primary_muscle: 'chest',
          equipment: 'barbell'
        });

      const response = await request(app)
        .get('/api/v3/fitness/exercises')
        .query({ search: 'bench' })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.some(e => e.name.toLowerCase().includes('bench'))).toBe(true);
    });
  });

  describe('POST /api/v3/fitness/exercises', () => {
    test('should create custom exercise', async () => {
      const uniqueName = `My Custom Exercise ${Date.now()}`;
      const response = await request(app)
        .post('/api/v3/fitness/exercises')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          name: uniqueName,
          primary_muscle: 'back',
          equipment: 'cable'
        });

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe(uniqueName);
      expect(response.body.data.space_id).toBe(spaceId);
    });
  });
});
