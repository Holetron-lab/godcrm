/**
 * @fileoverview Tests for AI Agents API endpoints
 * TDD: Test first, then fix
 */

// Set env vars BEFORE imports
process.env.SKIP_DEV_USER = 'true';
const JWT_SECRET = 'test-secret-key';
process.env.JWT_SECRET = JWT_SECRET;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { dbRun, dbGet, dbAll } from '../../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';
import aiAgentsRoutes from '../ai-agents.js';

describe('GET /api/v3/ai/agents/:spaceId', () => {
  let app;
  let authToken;
  let testSpaceId;
  let testProjectId;
  let testTableId;
  let testAgentRowIds = [];

  beforeAll(async () => {
    await setupTestDatabase();

    // Create Express app - ai-agents.js has router.use(authenticate) built-in
    app = express();
    app.use(express.json());

    app.use('/api/v3/ai', aiAgentsRoutes);

    // Create test user first (needed for FK constraints and auth)
    const ts = Date.now();
    const userResult = await dbRun(`
      INSERT INTO users (email, password_hash, name, role, encryption_key_encrypted, created_at)
      VALUES ($1, 'hash123', 'Test User', 'admin', 'enc123', NOW())
    `, [`ai-agents-test-${ts}@test.com`]);
    const testUserId = userResult.lastInsertRowid;

    // Generate real JWT token (authenticate middleware verifies it)
    authToken = jwt.sign({ id: testUserId, email: `ai-agents-test-${ts}@test.com`, role: 'admin' }, JWT_SECRET);

    // Create test space (type must be one of: business, personal, admin, ai)
    const spaceResult = await dbRun(`
      INSERT INTO spaces (name, type, owner_id, created_at, updated_at)
      VALUES ('Test AI Space', 'ai', $1, NOW(), NOW())
    `, [testUserId]);
    testSpaceId = spaceResult.lastInsertRowid;

    // Create test project (type is NOT NULL)
    const projectResult = await dbRun(`
      INSERT INTO projects (name, description, type, space_id, owner_id, created_at, updated_at)
      VALUES ('Test System Data', 'Test project', 'business', $1, $2, NOW(), NOW())
    `, [testSpaceId, testUserId]);
    testProjectId = projectResult.lastInsertRowid;

    // Create AI Agents table
    const tableResult = await dbRun(`
      INSERT INTO universal_tables (name, project_id, icon, created_at, updated_at)
      VALUES ('AI Agents', $1, '🤖', NOW(), NOW())
    `, [testProjectId]);
    testTableId = tableResult.lastInsertRowid;

    // Create test agents with different statuses
    const agents = [
      { name: 'Active Agent 1', status: 'active', is_active: null },
      { name: 'Active Agent 2', status: 'active', is_active: true },
      { name: 'Inactive Agent', status: 'inactive', is_active: false },
      { name: 'Legacy Active', status: null, is_active: true },
      { name: 'Testing Agent', status: 'testing', is_active: null }
    ];

    for (const agent of agents) {
      const result = await dbRun(`
        INSERT INTO table_rows (table_id, data, base_id, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
      `, [testTableId, JSON.stringify(agent), `row-${Date.now()}-${Math.random()}`]);
      testAgentRowIds.push(result.lastInsertRowid);
    }
  });

  afterAll(async () => {
    // Cleanup
    if (testAgentRowIds.length > 0) {
      await dbRun(`DELETE FROM table_rows WHERE id IN (${testAgentRowIds.join(',')})`);
    }
    if (testTableId) {
      await dbRun('DELETE FROM universal_tables WHERE id = $1', [testTableId]);
    }
    if (testProjectId) {
      await dbRun('DELETE FROM projects WHERE id = $1', [testProjectId]);
    }
    if (testSpaceId) {
      await dbRun('DELETE FROM spaces WHERE id = $1', [testSpaceId]);
    }
    await cleanupTestDatabase();
  });

  it('should return agents for a valid spaceId', async () => {
    const response = await request(app)
      .get(`/api/v3/ai/agents/${testSpaceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(response.body.data.agents).toBeInstanceOf(Array);
    expect(response.body.data.agents.length).toBeGreaterThan(0);
  });

  it('should return is_active=true for agents with status=active', async () => {
    const response = await request(app)
      .get(`/api/v3/ai/agents/${testSpaceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const activeAgents = response.body.data.agents.filter(
      (a) => a.name === 'Active Agent 1' || a.name === 'Active Agent 2'
    );

    expect(activeAgents.length).toBe(2);
    activeAgents.forEach((agent) => {
      expect(agent.is_active).toBe(true);
    });
  });

  it('should return is_active=false for inactive agents', async () => {
    const response = await request(app)
      .get(`/api/v3/ai/agents/${testSpaceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const inactiveAgent = response.body.data.agents.find(
      (a) => a.name === 'Inactive Agent'
    );

    expect(inactiveAgent).toBeDefined();
    expect(inactiveAgent.is_active).toBe(false);
  });

  it('should return is_active=true for legacy agents with is_active=true', async () => {
    const response = await request(app)
      .get(`/api/v3/ai/agents/${testSpaceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const legacyAgent = response.body.data.agents.find(
      (a) => a.name === 'Legacy Active'
    );

    expect(legacyAgent).toBeDefined();
    expect(legacyAgent.is_active).toBe(true);
  });

  it('should return empty agents array for space without agents', async () => {
    const response = await request(app)
      .get('/api/v3/ai/agents/99999')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.agents).toEqual([]);
  });

  it('should prefer table with most rows when multiple agent tables exist', async () => {
    // Create second table with fewer rows
    const smallerTableResult = await dbRun(`
      INSERT INTO universal_tables (name, project_id, icon, created_at, updated_at)
      VALUES ('Empty Agents', $1, '🤖', NOW(), NOW())
    `, [testProjectId]);
    const smallerTableId = smallerTableResult.lastInsertRowid;

    try {
      const response = await request(app)
        .get(`/api/v3/ai/agents/${testSpaceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should still return agents from the table with more rows
      expect(response.body.data.agents.length).toBeGreaterThan(0);
    } finally {
      await dbRun('DELETE FROM universal_tables WHERE id = $1', [smallerTableId]);
    }
  });
});
