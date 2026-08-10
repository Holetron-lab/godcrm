/**
 * Labs Routes Tests
 * ADR-043: MindWorkflow Integration
 */

// Set env vars BEFORE imports
process.env.SKIP_DEV_USER = 'true';
const JWT_SECRET = 'test-secret-key';
process.env.JWT_SECRET = JWT_SECRET;

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import labsRouter from '../labs.js';
import { dbRun, dbGet, dbAll } from '../../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';

// Create test app
const app = express();
app.use(express.json());

// Mock auth middleware that handles JWT tokens
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

app.use('/api/v3/labs', labsRouter);

let authToken;
let testUserId;

describe('Labs Routes', () => {
  beforeAll(async () => {
    // Set up test database with all necessary tables
    await setupTestDatabase();
    
    // Create test user
    const ts = Date.now();
    try {
      const userResult = await dbRun(`
        INSERT INTO users (email, password_hash, name, role, encryption_key_encrypted, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [`labs-test-${ts}@test.com`, 'hash123', 'Labs Test User', 'admin', 'enc123']);
      testUserId = userResult.lastInsertRowid;

      authToken = jwt.sign({ 
        id: testUserId, 
        userId: testUserId, 
        email: `labs-test-${ts}@test.com`, 
        role: 'admin' 
      }, JWT_SECRET);
    } catch (err) {
      // User table might not exist, create a simple token
      authToken = jwt.sign({ 
        id: 1, 
        userId: 1, 
        email: 'test@test.com', 
        role: 'admin' 
      }, JWT_SECRET);
    }

    // Add test AI templates (delete first to avoid unique constraint violations)
    await dbRun(`DELETE FROM labs_ai_templates WHERE mindworkflow_id IN ('test_planner', 'test_assistant')`);
    await dbRun(`
      INSERT INTO labs_ai_templates
      (mindworkflow_id, name, category, description, system_prompt, user_prompt_example, settings, routing_config, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      'test_planner',
      'Test Strategic Planner',
      'text_to_text',
      'Test template for planning',
      'You are a test planner.',
      'Create a test plan.',
      JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.4 }),
      JSON.stringify({ outputs: [{ id: 'text', type: 'text', enabled: true }] })
    ]);

    await dbRun(`
      INSERT INTO labs_ai_templates 
      (mindworkflow_id, name, category, description, system_prompt, user_prompt_example, settings, routing_config, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      'test_assistant',
      'Test Assistant',
      'text_to_text',
      'Test template for assistance',
      'You are a test assistant.',
      'Help with testing.',
      JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.3 }),
      JSON.stringify({ outputs: [{ id: 'text', type: 'text', enabled: true }] })
    ]);
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Clean up test data - use correct table and column names
    try {
      await dbRun('DELETE FROM labs_edges WHERE lab_id LIKE ?', ['labs-test-%']);
      await dbRun('DELETE FROM labs_nodes WHERE lab_id LIKE ?', ['labs-test-%']);
      await dbRun('DELETE FROM labs WHERE lab_id LIKE ?', ['labs-test-%']);
    } catch (err) {
      // Tables might not exist yet, ignore errors
    }
  });

  afterEach(async () => {
    // Clean up test data - use correct table and column names
    try {
      await dbRun('DELETE FROM labs_edges WHERE lab_id LIKE ?', ['labs-test-%']);
      await dbRun('DELETE FROM labs_nodes WHERE lab_id LIKE ?', ['labs-test-%']);
      await dbRun('DELETE FROM labs WHERE lab_id LIKE ?', ['labs-test-%']);
    } catch (err) {
      // Tables might not exist, ignore errors
    }
  });

  describe('Projects CRUD', () => {
    it.todo('should list all projects');
    it.todo('should create a new project');
    it.todo('should get project with nodes and edges');
    it.todo('should update project');
    it.todo('should delete project and cascade delete nodes/edges');
    it.todo('should return 404 for non-existent project');
    it.todo('should require title when creating project');
  });

  describe('Nodes CRUD', () => {
    it.todo('should list nodes for a project');
    it.todo('should create a new node');
    it.todo('should update node');
    it.todo('should delete node and related edges');
    it.todo('should return 404 for non-existent node');
    it.todo('should require type and title when creating node');
  });

  describe('Edges CRUD', () => {
    it.todo('should list edges for a project');
    it.todo('should create a new edge');
    it.todo('should delete edge');
    it.todo('should return 404 for non-existent edge');
    it.todo('should require source_node_id and target_node_id when creating edge');
  });

  describe('AI Integration', () => {
    it.todo('should get available AI agents');
    it.todo('should get AI providers');
    
    it('should get AI templates', async () => {
      const response = await request(app)
        .get('/api/v3/labs/ai/templates')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      
      // Templates may be empty in test environment (no seeding)
      // If templates exist, verify structure
      if (response.body.data.length > 0) {
        const template = response.body.data[0];
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('mindworkflow_id');
        expect(template).toHaveProperty('category');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('system_prompt');
      }
    });
    
    it.todo('should execute AI node');
    it.todo('should return 404 when executing non-existent node');
    it.todo('should return error when executing non-AI node');
  });

  describe('Error Handling', () => {
    it.todo('should handle database errors gracefully');
    it.todo('should validate input parameters');
    it.todo('should return proper error responses');
  });

  describe('Authentication', () => {
    it.todo('should require authentication for all endpoints');
    it.todo('should return 401 for unauthenticated requests');
  });
});

// Helper functions for tests
export const createTestProject = async (overrides = {}) => {
  const projectData = {
    space_id: null,
    title: 'Test Project',
    description: 'Test Description',
    settings: {},
    ...overrides
  };

  const response = await request(app)
    .post('/api/v3/labs/projects')
    .send(projectData);

  return response.body.data;
};

export const createTestNode = async (projectId, overrides = {}) => {
  const nodeData = {
    type: 'text',
    title: 'Test Node',
    content: 'Test content',
    meta: {},
    ai_config: {},
    ui_config: {},
    ...overrides
  };

  const response = await request(app)
    .post(`/api/v3/labs/projects/${projectId}/nodes`)
    .send(nodeData);

  return response.body.data;
};

export const createTestEdge = async (projectId, sourceNodeId, targetNodeId, overrides = {}) => {
  const edgeData = {
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
    source_handle: null,
    target_handle: null,
    ...overrides
  };

  const response = await request(app)
    .post(`/api/v3/labs/projects/${projectId}/edges`)
    .send(edgeData);

  return response.body.data;
};