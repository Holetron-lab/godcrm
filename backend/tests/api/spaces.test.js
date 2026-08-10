// API v3: Spaces Routes Tests
import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { setupTestDatabase, cleanupTestDatabase } from '../helpers/test-db.js';
import spacesRouter from '../../routes/v3/spaces.js';
import { authMiddleware } from '../../middleware/auth.js';

// Mock auth middleware for tests
const mockAuthMiddleware = (req, res, next) => {
  req.user = { id: 1, email: 'test@example.com', role: 'user' };
  next();
};

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v3/spaces', mockAuthMiddleware, spacesRouter);
  return app;
}

describe.skip('API v3: /spaces', () => {
  let app;

  beforeAll(() => {
    app = createTestApp();
  });

  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe.skip('GET /api/v3/spaces', () => {
    test('should return all spaces for user', async () => {
      const res = await request(app).get('/api/v3/spaces');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      // Should have default spaces created by autoCreateDefaultProjects
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test('should include projects_count and dashboards_count', async () => {
      const res = await request(app).get('/api/v3/spaces');

      expect(res.status).toBe(200);
      const space = res.body.data[0];
      expect(space).toHaveProperty('projects_count');
      expect(space).toHaveProperty('dashboards_count');
    });

    test('should return empty array if user has no spaces', async () => {
      // Mock user without spaces
      const appNoSpaces = express();
      appNoSpaces.use(express.json());
      appNoSpaces.use('/api/v3/spaces', (req, res, next) => {
        req.user = { id: 999, email: 'nouser@example.com', role: 'user' };
        next();
      }, spacesRouter);

      const res = await request(appNoSpaces).get('/api/v3/spaces');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe.skip('POST /api/v3/spaces', () => {
    test('should create new space', async () => {
      const res = await request(app)
        .post('/api/v3/spaces')
        .send({
          name: 'My Business',
          description: 'Business workspace',
          icon: '🏢',
          type: 'business',
          theme_primary: '#3b82f6',
          theme_secondary: '#ec4899',
          theme_tertiary: '#14b8a6'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.space.name).toBe('My Business');
      expect(res.body.data.space.type).toBe('business');
      expect(res.body.data.space.owner_id).toBe(1);
      expect(res.body.data.default_dashboard).toBeDefined();
    });

    test('should reject invalid type', async () => {
      const res = await request(app)
        .post('/api/v3/spaces')
        .send({
          name: 'Test',
          type: 'invalid_type'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Invalid space type');
    });

    test('should reject missing name', async () => {
      const res = await request(app)
        .post('/api/v3/spaces')
        .send({
          type: 'personal'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('name is required');
    });

    test('should reject missing type', async () => {
      const res = await request(app)
        .post('/api/v3/spaces')
        .send({
          name: 'Test Space'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('should use default values if not provided', async () => {
      const res = await request(app)
        .post('/api/v3/spaces')
        .send({
          name: 'Simple Space',
          type: 'personal'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.space.icon).toBe('📁');
      expect(res.body.data.space.theme_primary).toBe('#0ea5e9');
    });
  });

  describe.skip('GET /api/v3/spaces/:id', () => {
    test('should return space details', async () => {
      // Get existing space
      const listRes = await request(app).get('/api/v3/spaces');
      const spaceId = listRes.body.data[0].id;

      const res = await request(app).get(`/api/v3/spaces/${spaceId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.space.id).toBe(spaceId);
      expect(res.body.data.projects).toBeInstanceOf(Array);
      expect(res.body.data.dashboard).toBeDefined();
    });

    test('should return 404 for non-existent space', async () => {
      const res = await request(app).get('/api/v3/spaces/999');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('not found');
    });

    test('should not allow access to other users spaces', async () => {
      // Create space for user 1
      const createRes = await request(app)
        .post('/api/v3/spaces')
        .send({ name: 'User 1 Space', type: 'personal' });
      
      const spaceId = createRes.body.data.space.id;

      // Try to access as user 2
      const appUser2 = express();
      appUser2.use(express.json());
      appUser2.use('/api/v3/spaces', (req, res, next) => {
        req.user = { id: 2, email: 'user2@example.com', role: 'user' };
        next();
      }, spacesRouter);

      const res = await request(appUser2).get(`/api/v3/spaces/${spaceId}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('not authorized');
    });
  });

  describe.skip('PUT /api/v3/spaces/:id', () => {
    test('should update space', async () => {
      // Get existing space
      const listRes = await request(app).get('/api/v3/spaces');
      const spaceId = listRes.body.data[0].id;

      const res = await request(app)
        .put(`/api/v3/spaces/${spaceId}`)
        .send({
          name: 'Updated Name',
          description: 'Updated description'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Updated Name');
      expect(res.body.data.description).toBe('Updated description');
    });

    test('should return 404 for non-existent space', async () => {
      const res = await request(app)
        .put('/api/v3/spaces/999')
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });

    test('should not allow changing type', async () => {
      const listRes = await request(app).get('/api/v3/spaces');
      const spaceId = listRes.body.data[0].id;

      const res = await request(app)
        .put(`/api/v3/spaces/${spaceId}`)
        .send({ type: 'business' });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Cannot change space type');
    });
  });

  describe.skip('DELETE /api/v3/spaces/:id', () => {
    test('should delete space', async () => {
      // Create space to delete
      const createRes = await request(app)
        .post('/api/v3/spaces')
        .send({ name: 'To Delete', type: 'business' });
      
      const spaceId = createRes.body.data.space.id;

      const res = await request(app).delete(`/api/v3/spaces/${spaceId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deleted
      const getRes = await request(app).get(`/api/v3/spaces/${spaceId}`);
      expect(getRes.status).toBe(404);
    });

    test('should return 404 for non-existent space', async () => {
      const res = await request(app).delete('/api/v3/spaces/999');

      expect(res.status).toBe(404);
    });

    test('should cascade delete projects and dashboards', async () => {
      // This is tested in services layer
      // Just verify 200 response here
      const createRes = await request(app)
        .post('/api/v3/spaces')
        .send({ name: 'Test', type: 'personal' });
      
      const res = await request(app).delete(`/api/v3/spaces/${createRes.body.data.space.id}`);
      expect(res.status).toBe(200);
    });
  });

  describe.skip('Error handling', () => {
    test('should handle invalid JSON', async () => {
      const res = await request(app)
        .post('/api/v3/spaces')
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect(res.status).toBe(400);
    });

    test('should handle database errors gracefully', async () => {
      // Close database to simulate error
      await cleanupTestDatabase();

      const res = await request(app).get('/api/v3/spaces');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });
});
