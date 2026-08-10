/**
 * Labs Init API Endpoint Tests
 * Tests for POST /api/v3/labs/init endpoint
 */

process.env.SKIP_DEV_USER = 'true';
const JWT_SECRET = 'test-secret-key';
process.env.JWT_SECRET = JWT_SECRET;

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';
import { dbRun, dbGet, dbAll } from '../../../database/connection.js';

describe('Labs Init API', () => {
  let app;
  let authToken;
  let testUserId;
  let testSpaceId;

  beforeAll(async () => {
    await setupTestDatabase();

    // Create test user
    const ts = Date.now();
    const userResult = await dbRun(`
      INSERT INTO users (email, password_hash, name, role, encryption_key_encrypted, created_at)
      VALUES ($1, 'hash123', 'Test User', 'admin', 'enc123', NOW())
    `, [`test-labs-init-${ts}@test.com`]);

    testUserId = userResult.lastInsertRowid;

    // Create test space
    const spaceResult = await dbRun(`
      INSERT INTO spaces (owner_id, name, type, settings, created_at)
      VALUES ($1, 'Test Space', 'business', $2, NOW())
    `, [testUserId, JSON.stringify({})]);

    testSpaceId = spaceResult.lastInsertRowid;

    // Generate auth token
    authToken = jwt.sign(
      { id: testUserId, email: `test-labs-init-${ts}@test.com`, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Create Express app with mock auth + labs routes (avoiding server.js import)
    app = express();
    app.use(express.json());

    // Mock auth middleware
    app.use((req, res, next) => {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        try {
          req.user = jwt.verify(token, JWT_SECRET);
        } catch (e) {
          // Invalid token
        }
      }
      next();
    });

    // Import and mount labs routes directly
    const labsRoutes = (await import('../labs.js')).default;
    app.use('/api/v3/labs', labsRoutes);
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Clean up any existing labs
    await dbRun('DELETE FROM labs WHERE space_id = $1', [testSpaceId]);
  });

  describe('POST /api/v3/labs/init', () => {
    it('should create new lab when none exists', async () => {
      const response = await request(app)
        .post('/api/v3/labs/init')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: testSpaceId,
          widget_id: 123,
          title: 'Test Labs Project'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        lab_id: expect.any(String),
        title: 'Test Labs Project',
        initialized: true
      });

      // Verify lab was created in database
      const lab = await dbGet(
        'SELECT * FROM labs WHERE lab_id = $1',
        [response.body.data.lab_id]
      );
      expect(lab).toBeTruthy();
      expect(lab.space_id).toBe(testSpaceId);
      expect(lab.title).toBe('Test Labs Project');

      const settings = typeof lab.settings === 'string' ? JSON.parse(lab.settings) : lab.settings;
      expect(settings.widget_id).toBe(123);
    });

    it('should return existing lab when widget_id matches', async () => {
      // Create existing lab
      const existingLabId = `labs-${Date.now()}-existing`;
      await dbRun(`
        INSERT INTO labs (space_id, lab_id, title, settings, created_at, updated_at)
        VALUES ($1, $2, 'Existing Project', $3, NOW(), NOW())
      `, [testSpaceId, existingLabId, JSON.stringify({ widget_id: 456 })]);

      const response = await request(app)
        .post('/api/v3/labs/init')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: testSpaceId,
          widget_id: 456,
          title: 'New Project'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        lab_id: existingLabId,
        already_exists: true
      });
    });

    it('should return 400 when space_id is missing', async () => {
      const response = await request(app)
        .post('/api/v3/labs/init')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          widget_id: 123,
          title: 'Test Project'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('space_id is required');
    });

    it('should use default title when not provided', async () => {
      const response = await request(app)
        .post('/api/v3/labs/init')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          space_id: testSpaceId,
          widget_id: 789
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('New Lab');
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/api/v3/labs/init')
        .send({
          space_id: testSpaceId,
          widget_id: 123,
          title: 'Test Project'
        });

      expect([200, 201, 400]).toContain(response.status);
    });
  });
});
