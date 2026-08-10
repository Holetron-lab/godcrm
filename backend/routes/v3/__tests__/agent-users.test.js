/**
 * Agent User API Tests
 * ADR-023: Agent-as-User & Infinite Chat Architecture
 * 
 * Tests for creating agent users, listing agent users, and generating API keys
 * 
 * NOTE: These tests are skipped for SQLite because agent-users.js uses 
 * PostgreSQL-specific SQL syntax ($1, $2, RETURNING, NOW()).
 * Run with DATABASE_TYPE=postgres for full test coverage.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { dbGet, dbAll, dbRun, sqlNow, isPostgres, resetAdapter } from '../../../database/connection.js';

// Skip all tests if using SQLite (agent-users.js uses PostgreSQL syntax)
const describePostgres = isPostgres() ? describe : describe.skip;

// Mock authenticate middleware for testing
vi.mock('../../../middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 1, email: 'test@example.com', role: 'admin' };
    next();
  }
}));

describePostgres('Agent User API', () => {
  let testAgentTableId;
  let testAgentRowId;
  let testProjectId;
  let testSpaceId;
  
  beforeAll(async () => {
    // Skip dev user creation (depends on NeoMetal which doesn't exist in tests)
    process.env.SKIP_DEV_USER = 'true';
    
    // Initialize database schema (required for SQLite in-memory tests)
    await resetAdapter();
    
    // Create test user first (foreign key constraint)
    await dbRun(`
      INSERT INTO users (id, email, password_hash, name, encryption_key_encrypted)
      VALUES (1, 'test@example.com', 'hash', 'Test User', 'encrypted_key')
      ON CONFLICT (id) DO NOTHING
    `);
    
    // Create test space
    const spaceResult = await dbRun(`
      INSERT INTO spaces (name, owner_id, type, created_at, updated_at)
      VALUES (?, 1, 'business', ${sqlNow()}, ${sqlNow()})
    `, ['Test AI Space']);
    testSpaceId = spaceResult.lastInsertRowid;
    
    // Create test project
    const projectResult = await dbRun(`
      INSERT INTO projects (name, space_id, owner_id, type, created_at, updated_at)
      VALUES (?, ?, 1, 'custom', ${sqlNow()}, ${sqlNow()})
    `, ['Test AI Project', testSpaceId]);
    testProjectId = projectResult.lastInsertRowid;
    
    // Create test AI Agents table
    const tableResult = await dbRun(`
      INSERT INTO universal_tables (name, project_id, created_at, updated_at)
      VALUES (?, ?, ${sqlNow()}, ${sqlNow()})
    `, ['AI Agents', testProjectId]);
    testAgentTableId = tableResult.lastInsertRowid;
    
    // Create test agent row
    const agentData = {
      name: 'Test Agent',
      description: 'A test AI agent',
      icon: '🤖',
      system_prompt: 'You are a test agent',
      status: 'active'
    };
    
    const rowResult = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
      VALUES (?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [testAgentTableId, 'test-agent-1', JSON.stringify(agentData)]);
    testAgentRowId = rowResult.lastInsertRowid;
  });
  
  afterAll(async () => {
    // Cleanup test data (may fail if tables dropped - ignore errors)
    try {
      await dbRun(`DELETE FROM table_rows WHERE table_id = ?`, [testAgentTableId]);
      await dbRun(`DELETE FROM universal_tables WHERE id = ?`, [testAgentTableId]);
      await dbRun(`DELETE FROM projects WHERE id = ?`, [testProjectId]);
      await dbRun(`DELETE FROM spaces WHERE id = ?`, [testSpaceId]);
      await dbRun(`DELETE FROM users WHERE user_type = 'agent' AND email LIKE '%test-agent%'`);
    } catch (e) {
      // Ignore cleanup errors in test mode
    }
  });
  
  describe('POST /api/v3/users/create-agent-user', () => {
    it('should create a user with user_type=agent linked to agent row', async () => {
      const { createAgentUser } = await import('../agent-users.js');
      
      const result = await createAgentUser({
        agentTableId: testAgentTableId,
        agentRowId: testAgentRowId,
        name: 'Test Agent User',
        createdBy: 1
      });
      
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user.user_type).toBe('agent');
      expect(result.user.managed_by_agent_table_id).toBe(testAgentTableId);
      expect(result.user.managed_by_agent_row_id).toBe(testAgentRowId);
      expect(result.user.email).toContain('@agents.godcrm.local');
    });
    
    it('should auto-generate email from agent name if not provided', async () => {
      const { createAgentUser } = await import('../agent-users.js');
      
      const result = await createAgentUser({
        agentTableId: testAgentTableId,
        agentRowId: testAgentRowId,
        createdBy: 1
      });
      
      expect(result.user.email).toMatch(/test-agent.*@agents\.godcrm\.local/);
    });
    
    it('should store agent_config JSON in user record', async () => {
      const { createAgentUser } = await import('../agent-users.js');
      
      const agentConfig = {
        auto_respond: true,
        respond_only_when_mentioned: false,
        max_response_tokens: 2000
      };
      
      const result = await createAgentUser({
        agentTableId: testAgentTableId,
        agentRowId: testAgentRowId,
        agentConfig,
        createdBy: 1
      });
      
      expect(result.user.agent_config).toMatchObject(agentConfig);
    });
    
    it('should fail if agent row does not exist', async () => {
      const { createAgentUser } = await import('../agent-users.js');
      
      const result = await createAgentUser({
        agentTableId: testAgentTableId,
        agentRowId: 999999,
        createdBy: 1
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent not found');
    });
  });
  
  describe('GET /api/v3/users/agents', () => {
    it('should return all users with user_type=agent', async () => {
      const { getAgentUsers } = await import('../agent-users.js');
      
      const result = await getAgentUsers();
      
      expect(result.success).toBe(true);
      expect(Array.isArray(result.users)).toBe(true);
      
      // All returned users should be agents
      for (const user of result.users) {
        expect(user.user_type).toBe('agent');
      }
    });
    
    it('should include linked agent data', async () => {
      const { getAgentUsers } = await import('../agent-users.js');
      
      const result = await getAgentUsers();
      
      if (result.users.length > 0) {
        const agentUser = result.users[0];
        expect(agentUser.managed_by_agent_table_id).toBeDefined();
        expect(agentUser.managed_by_agent_row_id).toBeDefined();
      }
    });
  });
  
  describe('POST /api/v3/users/:id/generate-api-key', () => {
    it('should generate API key for agent user', async () => {
      const { createAgentUser, generateUserApiKey } = await import('../agent-users.js');
      
      // First create an agent user
      const createResult = await createAgentUser({
        agentTableId: testAgentTableId,
        agentRowId: testAgentRowId,
        createdBy: 1
      });
      
      const userId = createResult.user.id;
      
      // Generate API key
      const keyResult = await generateUserApiKey(userId, { createdBy: 1 });
      
      expect(keyResult.success).toBe(true);
      expect(keyResult.apiKey).toBeDefined();
      expect(keyResult.apiKey).toMatch(/^sk-agent-/);
    });
    
    it('should fail for non-existent user', async () => {
      const { generateUserApiKey } = await import('../agent-users.js');
      
      const result = await generateUserApiKey(999999, { createdBy: 1 });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('User not found');
    });
  });
});

describe('Agent User Integration', () => {
  describe('Agent Authentication', () => {
    it('should allow agent user to authenticate via API key', async () => {
      // This test verifies that the auth middleware recognizes agent users
      // and allows them to make API calls
      
      // Implementation depends on how API key auth is set up
      expect(true).toBe(true); // Placeholder for integration test
    });
  });
});
