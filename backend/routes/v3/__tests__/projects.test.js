/**
 * Projects API Routes Tests (v3) - ADR-064 Phase 2, Task 6
 * Testing REST API endpoints for project CRUD
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import projectsRoutes from '../projects.js';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
const app = express();
app.use(express.json());

let mockUserId = 1;
app.use((req, _res, next) => {
  req.user = { id: mockUserId, role: 'owner' };
  next();
});

app.use('/api/v3/projects', projectsRoutes);

async function createTestUser() {
  const email = `test-proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)',
    [email, 'hash', 'Test User', 'encrypted_key', 1]
  );
  return result.lastInsertRowid;
}

async function createTestSpace(ownerId) {
  const result = await dbRun(
    'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
    [ownerId, 'Test Space', 'business']
  );
  return result.lastInsertRowid;
}

describe('Projects API Routes (v3) - ADR-064', () => {
  let userId, spaceId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    userId = await createTestUser();
    mockUserId = userId;
    spaceId = await createTestSpace(userId);
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // GET /api/v3/projects
  // ============================================================
  describe('GET /api/v3/projects', () => {
    test('should return projects for user', async () => {
      // Create a project via DB
      await dbRun(
        'INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, ?, ?)',
        [userId, spaceId, 'My Project', 'business']
      );

      const res = await request(app)
        .get('/api/v3/projects')
        .query({ space_id: spaceId })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ============================================================
  // POST /api/v3/projects
  // ============================================================
  describe('POST /api/v3/projects', () => {
    test('should create project with valid data', async () => {
      const res = await request(app)
        .post('/api/v3/projects')
        .send({ space_id: spaceId, name: 'New Project', type: 'project' })
        .expect(201);

      expect(res.body.success).toBe(true);

      // Verify project was created in DB
      const projects = await dbAll(
        "SELECT * FROM projects WHERE name = 'New Project' AND space_id = ?",
        [spaceId]
      );
      expect(projects.length).toBe(1);
      expect(projects[0].owner_id).toBe(userId);
    });

    test('should default to project type if invalid type given', async () => {
      const res = await request(app)
        .post('/api/v3/projects')
        .send({ space_id: spaceId, name: 'Type Default', type: 'invalid' })
        .expect(201);

      expect(res.body.success).toBe(true);

      const projects = await dbAll(
        "SELECT * FROM projects WHERE name = 'Type Default'",
        []
      );
      expect(projects[0].type).toBe('project');
    });

    test('should reject missing name', async () => {
      const res = await request(app)
        .post('/api/v3/projects')
        .send({ space_id: spaceId })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================
  // PUT /api/v3/projects/:id
  // ============================================================
  describe('PUT /api/v3/projects/:id', () => {
    test('should update project name', async () => {
      // Create project directly in DB
      const result = await dbRun(
        'INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, ?, ?)',
        [userId, spaceId, 'Old Name', 'project']
      );
      const projectId = result.lastInsertRowid;

      const res = await request(app)
        .put(`/api/v3/projects/${projectId}`)
        .send({ name: 'New Name' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('New Name');
    });

    test('should return 404 for non-existent project', async () => {
      const res = await request(app)
        .put('/api/v3/projects/99999')
        .send({ name: 'New Name' })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================
  // DELETE /api/v3/projects/:id
  // ============================================================
  describe('DELETE /api/v3/projects/:id', () => {
    test('should delete project', async () => {
      const result = await dbRun(
        'INSERT INTO projects (owner_id, space_id, name, type) VALUES (?, ?, ?, ?)',
        [userId, spaceId, 'Delete Me', 'project']
      );
      const projectId = result.lastInsertRowid;

      const res = await request(app)
        .delete(`/api/v3/projects/${projectId}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      const project = await dbGet('SELECT * FROM projects WHERE id = ?', [projectId]);
      expect(project).toBeNull();
    });

    test('should return 404 for non-existent project', async () => {
      const res = await request(app)
        .delete('/api/v3/projects/99999')
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });
});
