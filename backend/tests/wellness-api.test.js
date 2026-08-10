// @vitest-environment node
/**
 * ADR-027: Wellness Ecosystem API Tests
 * Phase 1: Foundation (Profile, Vitals, Gamification)
 * TDD - Test First Approach (Ralph Mode)
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';

// Set test mode
process.env.TEST_MODE = 'true';
process.env.JWT_SECRET = 'test-secret-key-for-wellness';
process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-32-characters!!';
process.env.SKIP_DEV_USER = 'true';

let app;
let authToken;
let spaceId;
let userId;

/**
 * Helper to setup test user and get auth token
 */
async function setupAuthenticatedUser() {
  const authRoutes = (await import('../routes/v3/auth.js')).default;
  app.use('/api/v3/auth', authRoutes);
  
  // Register user
  const registerRes = await request(app)
    .post('/api/v3/auth/register')
    .send({ email: `wellness-${Date.now()}@test.com`, password: 'TestPass123!', name: 'Wellness User' });
  
  authToken = registerRes.body.data?.accessToken;
  userId = registerRes.body.data?.user?.id;
  
  // Get user's personal space
  const spacesRoutes = (await import('../routes/v3/spaces.js')).default;
  app.use('/api/v3/spaces', spacesRoutes);
  
  const spacesRes = await request(app)
    .get('/api/v3/spaces')
    .set('Authorization', `Bearer ${authToken}`);
  
  const personalSpace = spacesRes.body.data?.find(s => s.type === 'personal');
  spaceId = personalSpace?.id || 1;
  
  return { authToken, spaceId, userId };
}

beforeEach(async () => {
  await setupTestDatabase();
  
  app = express();
  app.use(express.json());
  
  // Setup wellness routes
  const wellnessRoutes = (await import('../routes/v3/wellness.js')).default;
  app.use('/api/v3/wellness', wellnessRoutes);
  
  await setupAuthenticatedUser();

  // Clean up any leftover wellness data for this space from previous test runs
  const { dbRun: runSql } = await import('../database/connection.js');
  await runSql('DELETE FROM wellness_points WHERE space_id = ?', [spaceId]);
  await runSql('DELETE FROM wellness_vitals WHERE space_id = ?', [spaceId]);
  await runSql('DELETE FROM wellness_streaks WHERE space_id = ?', [spaceId]);
  await runSql('DELETE FROM wellness_levels WHERE space_id = ?', [spaceId]);
  await runSql('DELETE FROM wellness_profiles WHERE space_id = ?', [spaceId]);
  await runSql('DELETE FROM wellness_user_achievements WHERE space_id = ?', [spaceId]);
});

afterEach(async () => {
  await cleanupTestDatabase();
});

// =============================================================
// PROFILE TESTS
// =============================================================

describe('Wellness Profile API', () => {
  
  describe('GET /api/v3/wellness/profile', () => {
    test('should return 404 when profile does not exist', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    test('should return profile when it exists', async () => {
      // First create a profile
      await request(app)
        .put('/api/v3/wellness/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          gender: 'male',
          birth_date: '1990-05-15',
          height_cm: 180,
          target_weight_kg: 75,
          activity_level: 'moderate'
        });
      
      const response = await request(app)
        .get('/api/v3/wellness/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.height_cm).toBe(180);
      expect(response.body.data.gender).toBe('male');
    });
  });

  describe('PUT /api/v3/wellness/profile', () => {
    test('should create new profile with calculated BMR/TDEE', async () => {
      const response = await request(app)
        .put('/api/v3/wellness/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          gender: 'male',
          birth_date: '1990-05-15',
          height_cm: 180,
          target_weight_kg: 75,
          activity_level: 'moderate'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.bmr).toBeGreaterThan(0);
      expect(response.body.data.tdee).toBeGreaterThan(0);
      // TDEE should be > BMR (with activity multiplier)
      expect(response.body.data.tdee).toBeGreaterThan(response.body.data.bmr);
    });

    test('should update existing profile', async () => {
      // Create profile
      await request(app)
        .put('/api/v3/wellness/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          gender: 'male',
          height_cm: 180,
          activity_level: 'moderate'
        });
      
      // Update profile
      const response = await request(app)
        .put('/api/v3/wellness/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          height_cm: 182,
          activity_level: 'active'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.data.height_cm).toBe(182);
      expect(response.body.data.activity_level).toBe('active');
    });

    test('should validate height_cm range (50-300)', async () => {
      const response = await request(app)
        .put('/api/v3/wellness/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          height_cm: 10 // Too short
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should validate activity_level enum', async () => {
      const response = await request(app)
        .put('/api/v3/wellness/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          activity_level: 'super_ultra_active' // Invalid
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should require space_id', async () => {
      const response = await request(app)
        .put('/api/v3/wellness/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gender: 'female',
          height_cm: 165
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });
  });
});

// =============================================================
// VITALS TESTS
// =============================================================

describe('Wellness Vitals API', () => {
  
  describe('POST /api/v3/wellness/vitals', () => {
    test('should log a weight vital', async () => {
      const response = await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'weight',
          value: 78.5,
          unit: 'kg',
          measured_at: '2026-01-18T08:00:00Z'
        });
      
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.vital_type).toBe('weight');
      expect(Number(response.body.data.value)).toBe(78.5);
    });

    test('should log heart rate vital', async () => {
      const response = await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'heart_rate',
          value: 72,
          unit: 'bpm',
          measured_at: '2026-01-18T08:00:00Z'
        });
      
      expect(response.status).toBe(201);
      expect(response.body.data.vital_type).toBe('heart_rate');
      expect(Number(response.body.data.value)).toBe(72);
    });

    test('should log blood pressure (systolic)', async () => {
      const response = await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'blood_pressure_sys',
          value: 120,
          unit: 'mmHg',
          measured_at: '2026-01-18T08:00:00Z'
        });
      
      expect(response.status).toBe(201);
      expect(response.body.data.vital_type).toBe('blood_pressure_sys');
    });

    test('should validate vital_type enum', async () => {
      const response = await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'invalid_vital_type',
          value: 100
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    test('should award points for logging vital', async () => {
      // First create level entry
      await request(app)
        .get('/api/v3/wellness/gamification/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      // Log vital
      await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'weight',
          value: 78.5,
          unit: 'kg',
          measured_at: '2026-01-18T08:00:00Z'
        });
      
      // Check points
      const gamification = await request(app)
        .get('/api/v3/wellness/gamification/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(gamification.body.data.total_xp).toBeGreaterThanOrEqual(5); // 5 points for vital
    });
  });

  describe('GET /api/v3/wellness/vitals', () => {
    beforeEach(async () => {
      // Seed some vitals
      const vitals = [
        { vital_type: 'weight', value: 80, unit: 'kg', measured_at: '2026-01-15T08:00:00Z' },
        { vital_type: 'weight', value: 79.5, unit: 'kg', measured_at: '2026-01-16T08:00:00Z' },
        { vital_type: 'weight', value: 79, unit: 'kg', measured_at: '2026-01-17T08:00:00Z' },
        { vital_type: 'heart_rate', value: 70, unit: 'bpm', measured_at: '2026-01-17T08:00:00Z' },
        { vital_type: 'heart_rate', value: 72, unit: 'bpm', measured_at: '2026-01-18T08:00:00Z' }
      ];
      
      for (const vital of vitals) {
        await request(app)
          .post('/api/v3/wellness/vitals')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ space_id: spaceId, ...vital });
      }
    });

    test('should return all vitals', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(5);
    });

    test('should filter by vital_type', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId, vital_type: 'weight' });
      
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(3);
      expect(response.body.data.every(v => v.vital_type === 'weight')).toBe(true);
    });

    test('should filter by date range', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ 
          space_id: spaceId,
          from: '2026-01-17',
          to: '2026-01-18'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(3); // 1 weight + 2 heart_rate on 17th and 18th
    });
  });

  describe('GET /api/v3/wellness/vitals/latest', () => {
    beforeEach(async () => {
      // Seed vitals
      const vitals = [
        { vital_type: 'weight', value: 80, measured_at: '2026-01-15T08:00:00Z' },
        { vital_type: 'weight', value: 79, measured_at: '2026-01-17T08:00:00Z' },
        { vital_type: 'heart_rate', value: 70, measured_at: '2026-01-16T08:00:00Z' },
        { vital_type: 'heart_rate', value: 72, measured_at: '2026-01-18T08:00:00Z' }
      ];
      
      for (const vital of vitals) {
        await request(app)
          .post('/api/v3/wellness/vitals')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ space_id: spaceId, ...vital });
      }
    });

    test('should return latest value for each vital type', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/vitals/latest')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.data.weight).toBeDefined();
      expect(response.body.data.heart_rate).toBeDefined();
      expect(Number(response.body.data.weight.value)).toBe(79);
      expect(Number(response.body.data.heart_rate.value)).toBe(72);
    });
  });

  describe('GET /api/v3/wellness/vitals/trends', () => {
    test('should return trend data for weight', async () => {
      // Seed weight data (relative to today so it falls within the default 30-day window)
      const today = new Date();
      const daysAgo = (n) => {
        const d = new Date(today);
        d.setDate(d.getDate() - n);
        return d.toISOString();
      };
      const weights = [
        { vital_type: 'weight', value: 82, measured_at: daysAgo(21) },
        { vital_type: 'weight', value: 81, measured_at: daysAgo(14) },
        { vital_type: 'weight', value: 80, measured_at: daysAgo(7) },
        { vital_type: 'weight', value: 79, measured_at: daysAgo(0) }
      ];
      
      for (const w of weights) {
        await request(app)
          .post('/api/v3/wellness/vitals')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ space_id: spaceId, ...w });
      }
      
      const response = await request(app)
        .get('/api/v3/wellness/vitals/trends')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId, vital_type: 'weight' });
      
      expect(response.status).toBe(200);
      expect(response.body.data.trend).toBe('decreasing'); // Weight going down
      expect(response.body.data.change).toBeDefined();
      expect(response.body.data.change_pct).toBeDefined();
      expect(response.body.data.data_points).toBeGreaterThanOrEqual(4);
    });
  });
});

// =============================================================
// GAMIFICATION TESTS
// =============================================================

describe('Wellness Gamification API', () => {
  
  describe('GET /api/v3/wellness/gamification/summary', () => {
    test('should return initial gamification state', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/gamification/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.current_level).toBe(1);
      expect(response.body.data.total_xp).toBe(0);
      expect(response.body.data.title).toBe('Beginner');
    });

    test('should create level entry if not exists', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/gamification/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.data.id).toBeDefined();
    });
  });

  describe('Points and Leveling', () => {
    test('should level up when XP threshold is reached', async () => {
      // Initialize gamification
      await request(app)
        .get('/api/v3/wellness/gamification/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      // Award enough points to level up (Level 2 requires 100 XP)
      // Log 20 vitals = 100 points
      for (let i = 0; i < 20; i++) {
        await request(app)
          .post('/api/v3/wellness/vitals')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            space_id: spaceId,
            vital_type: 'heart_rate',
            value: 70 + i,
            measured_at: new Date(Date.now() - i * 3600000).toISOString()
          });
      }
      
      const response = await request(app)
        .get('/api/v3/wellness/gamification/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.body.data.current_level).toBeGreaterThanOrEqual(2);
      expect(response.body.data.total_xp).toBeGreaterThanOrEqual(100);
    });

    test('should calculate correct XP for next level', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/gamification/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      // Level 2 requires 100 XP, Level 3 requires ~283 XP (100 * 2^1.5)
      expect(response.body.data.xp_for_next_level).toBe(100);
    });
  });

  describe('GET /api/v3/wellness/gamification/achievements', () => {
    test('should return all achievements with progress', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/gamification/achievements')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
      // Check structure
      if (response.body.data.length > 0) {
        const achievement = response.body.data[0];
        expect(achievement.name).toBeDefined();
        expect(achievement.description).toBeDefined();
        expect(achievement.tier).toBeDefined();
        expect(achievement.progress).toBeDefined();
        expect(achievement.earned).toBeDefined();
      }
    });
  });
});

// =============================================================
// STREAKS TESTS
// =============================================================

describe('Wellness Streaks API', () => {
  
  describe('GET /api/v3/wellness/streaks', () => {
    test('should return all streak types', async () => {
      const response = await request(app)
        .get('/api/v3/wellness/streaks')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      // Check that we have streak types
      expect(response.body.data.vitals_logged).toBeDefined();
    });

    test('should increment streak when logging vitals on consecutive days', async () => {
      // Log vital for yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'weight',
          value: 80,
          measured_at: yesterday.toISOString()
        });
      
      // Log vital for today
      await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'weight',
          value: 79.5,
          measured_at: new Date().toISOString()
        });
      
      const response = await request(app)
        .get('/api/v3/wellness/streaks')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.body.data.vitals_logged.current_count).toBeGreaterThanOrEqual(2);
    });

    test('should reset streak when gap is too large', async () => {
      // Log vital for 3 days ago
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      
      await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'weight',
          value: 80,
          measured_at: threeDaysAgo.toISOString()
        });
      
      // Log vital for today (gap of 2 days = streak reset)
      await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'weight',
          value: 79.5,
          measured_at: new Date().toISOString()
        });
      
      const response = await request(app)
        .get('/api/v3/wellness/streaks')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.body.data.vitals_logged.current_count).toBe(1); // Reset to 1
    });
  });
});

// =============================================================
// DASHBOARD TESTS
// =============================================================

describe('Wellness Dashboard API', () => {
  
  describe('GET /api/v3/wellness/dashboard', () => {
    test('should return aggregated daily status', async () => {
      // Seed some data
      await request(app)
        .post('/api/v3/wellness/vitals')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: spaceId,
          vital_type: 'weight',
          value: 79,
          measured_at: new Date().toISOString()
        });
      
      const response = await request(app)
        .get('/api/v3/wellness/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ space_id: spaceId });
      
      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.vitals_today).toBeDefined();
      expect(response.body.data.level).toBeDefined();
      expect(response.body.data.streaks).toBeDefined();
    });
  });
});
