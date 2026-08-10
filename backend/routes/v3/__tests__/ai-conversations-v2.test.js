/**
 * ADR-024: AI Conversations API v2 Tests
 * 
 * Tests for migrating AI chat from table_rows JSON to normalized tables:
 * - conversations (type='ai_chat')
 * - messages
 * - conversation_participants
 */

// Set env vars BEFORE imports - must match what auth middleware uses
const JWT_SECRET = 'test-secret-key';
process.env.SKIP_DEV_USER = 'true';
process.env.JWT_SECRET = JWT_SECRET;

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { dbAll, dbGet, dbRun, isPostgres } from '../../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';

describe('ADR-024: AI Conversations API v2', () => {
  let app;
  let testUserId;
  let authToken;
  let testAgentId;
  
  beforeAll(async () => {
    await setupTestDatabase();
    
    // Create test user
    const ts = Date.now();
    const userResult = await dbRun(
      `INSERT INTO users (email, name, password_hash, role, encryption_key_encrypted, created_at) 
       VALUES (?, 'AI Conv Test', 'hash', 'user', 'enc123', NOW())`,
      [`ai-conv-test-${ts}@test.com`]
    );
    testUserId = userResult.lastInsertRowid;
    
    // Create test AI agent in users table (agent user)
    const agentResult = await dbRun(
      `INSERT INTO users (email, name, password_hash, role, user_type, encryption_key_encrypted, created_at) 
       VALUES (?, 'Test Agent', 'hash', 'user', 'agent', 'enc123', NOW())`,
      [`agent-${ts}@test.com`]
    );
    testAgentId = agentResult.lastInsertRowid;
    
    // Create auth token - include 'id' as required by requireAuth
    authToken = jwt.sign(
      { id: testUserId, userId: testUserId, email: `ai-conv-test-${ts}@test.com`, role: 'user' },
      JWT_SECRET
    );
    
    // Create Express app - ai-agents.js has its own authenticate middleware
    app = express();
    app.use(express.json());
    
    // Ensure 'tables' table exists (SQLite subqueries in list-conversations reference it)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY,
        name TEXT,
        display_name TEXT,
        icon TEXT
      )
    `);

    // Import and mount ai-agents routes (contains /ai/conversations endpoints)
    const aiAgentsRoutes = await import('../ai-agents.js');
    app.use('/api/v3/ai', aiAgentsRoutes.default);
  });
  
  afterAll(async () => {
    await cleanupTestDatabase();
  });
  
  // ==========================================
  // POST /ai/conversations - Create AI conversation
  // ==========================================
  describe('POST /api/v3/ai/conversations', () => {
    it('should create a new AI conversation in conversations table', async () => {
      const response = await request(app)
        .post('/api/v3/ai/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Test AI Chat',
          agentId: testAgentId,
          agentName: 'Test Agent'
        });
      
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.title).toBe('Test AI Chat');
      // ADR-091: conversations now use unified 'chat' type instead of 'ai_chat'
      expect(response.body.data.type).toBe('chat');
      
      // Verify in database - should be in conversations table, NOT table_rows
      const conv = await dbGet(
        'SELECT * FROM conversations WHERE id = ?',
        [response.body.data.id]
      );
      expect(conv).toBeDefined();
      expect(conv.type).toBe('chat');
      expect(conv.created_by).toBe(testUserId);
    });
    
    it('should add creator as participant with admin role', async () => {
      const response = await request(app)
        .post('/api/v3/ai/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Participant Test',
          agentId: testAgentId
        });
      
      expect(response.status).toBe(201);
      
      const participant = await dbGet(
        'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
        [response.body.data.id, testUserId]
      );
      expect(participant).toBeDefined();
      expect(participant.role).toBe('admin');
    });
    
    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v3/ai/conversations')
        .send({ title: 'No Auth' });
      
      expect(response.status).toBe(401);
    });
  });
  
  // ==========================================
  // GET /ai/conversations - List AI conversations
  // ==========================================
  describe('GET /api/v3/ai/conversations', () => {
    let conversationId;
    
    beforeEach(async () => {
      // Create test conversation directly in DB
      const result = await dbRun(
        `INSERT INTO conversations (title, type, created_by, created_at, updated_at)
         VALUES ('List Test Conv', 'ai_chat', ?, NOW(), NOW())`,
        [testUserId]
      );
      conversationId = result.lastInsertRowid;
      
      // Add participant
      await dbRun(
        `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', NOW())`,
        [conversationId, testUserId]
      );
    });
    
    it('should return list of AI conversations for current user', async () => {
      const response = await request(app)
        .get('/api/v3/ai/conversations')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // API returns { conversations: [...] } not a direct array
      expect(Array.isArray(response.body.data.conversations)).toBe(true);

      const conv = response.body.data.conversations.find(c => c.id === conversationId);
      expect(conv).toBeDefined();
      expect(conv.title).toBe('List Test Conv');
    });
    
    it('should only return conversations where user is participant', async () => {
      // Create another user's conversation
      const otherUserResult = await dbRun(
        `INSERT INTO users (email, name, password_hash, role, encryption_key_encrypted, created_at) 
         VALUES ('other@test.com', 'Other', 'hash', 'user', 'enc123', NOW())`
      );
      const otherUserId = otherUserResult.lastInsertRowid;
      
      const otherConvResult = await dbRun(
        `INSERT INTO conversations (title, type, created_by, created_at, updated_at)
         VALUES ('Other User Conv', 'ai_chat', ?, NOW(), NOW())`,
        [otherUserId]
      );
      
      await dbRun(
        `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', NOW())`,
        [otherConvResult.lastInsertRowid, otherUserId]
      );
      
      const response = await request(app)
        .get('/api/v3/ai/conversations')
        .set('Authorization', `Bearer ${authToken}`);
      
      // Should NOT include other user's conversation
      const otherConv = response.body.data.conversations.find(c => c.id === otherConvResult.lastInsertRowid);
      expect(otherConv).toBeUndefined();
      
      // Cleanup
      await dbRun('DELETE FROM conversation_participants WHERE conversation_id = ?', [otherConvResult.lastInsertRowid]);
      await dbRun('DELETE FROM conversations WHERE id = ?', [otherConvResult.lastInsertRowid]);
      await dbRun('DELETE FROM users WHERE id = ?', [otherUserId]);
    });
    
    it('should include messages count and last message', async () => {
      // Add messages to conversation
      await dbRun(
        `INSERT INTO messages (conversation_id, sender_id, role, content, content_type, created_at)
         VALUES (?, ?, 'user', 'Hello AI', 'text', NOW())`,
        [conversationId, testUserId]
      );
      await dbRun(
        `INSERT INTO messages (conversation_id, sender_id, role, content, content_type, created_at)
         VALUES (?, ?, 'assistant', 'Hi there!', 'text', NOW())`,
        [conversationId, testAgentId]
      );
      
      const response = await request(app)
        .get('/api/v3/ai/conversations')
        .set('Authorization', `Bearer ${authToken}`);
      
      const conv = response.body.data.conversations.find(c => c.id === conversationId);
      expect(Number(conv.messagesCount)).toBe(2);
      expect(conv.lastMessage).toContain('Hi there');
    });
  });
  
  // ==========================================
  // GET /ai/conversations/:id - Get single conversation
  // ==========================================
  describe('GET /api/v3/ai/conversations/:id', () => {
    let conversationId;
    
    beforeEach(async () => {
      // Create conversation with messages
      const result = await dbRun(
        `INSERT INTO conversations (title, type, created_by, created_at, updated_at)
         VALUES ('Detail Test', 'ai_chat', ?, NOW(), NOW())`,
        [testUserId]
      );
      conversationId = result.lastInsertRowid;
      
      await dbRun(
        `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', NOW())`,
        [conversationId, testUserId]
      );
      
      // Add messages
      await dbRun(
        `INSERT INTO messages (conversation_id, sender_id, role, content, content_type, created_at)
         VALUES (?, ?, 'user', 'First message', 'text', NOW() - INTERVAL '2 minutes')`,
        [conversationId, testUserId]
      );
      await dbRun(
        `INSERT INTO messages (conversation_id, sender_id, role, content, content_type, created_at)
         VALUES (?, ?, 'assistant', 'Response', 'text', NOW() - INTERVAL '1 minute')`,
        [conversationId, testAgentId]
      );
    });
    
    it('should return conversation with all messages', async () => {
      const response = await request(app)
        .get(`/api/v3/ai/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(conversationId);
      expect(response.body.data.title).toBe('Detail Test');
      expect(Array.isArray(response.body.data.messages)).toBe(true);
      expect(response.body.data.messages.length).toBe(2);

      // Messages should be in chronological order
      // Note: messages are returned DESC then reversed, so oldest first
      expect(response.body.data.messages[0].content).toBe('First message');
      expect(response.body.data.messages[1].content).toBe('Response');
    });
    
    it('should return 404 for non-existent conversation', async () => {
      const response = await request(app)
        .get('/api/v3/ai/conversations/999999')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(404);
    });
    
    it('should return 403 if user is not participant', async () => {
      // Create other user's conversation (without adding testUser as participant)
      const otherResult = await dbRun(
        `INSERT INTO conversations (title, type, created_by, created_at, updated_at)
         VALUES ('Private', 'ai_chat', ?, NOW(), NOW())`,
        [testAgentId]  // Use testAgentId (exists) but don't add testUserId as participant
      );
      
      const response = await request(app)
        .get(`/api/v3/ai/conversations/${otherResult.lastInsertRowid}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(403);
      
      // Cleanup
      await dbRun('DELETE FROM conversations WHERE id = ?', [otherResult.lastInsertRowid]);
    });
  });
  
  // ==========================================
  // PUT /ai/conversations/:id - Add message
  // ==========================================
  describe('PUT /api/v3/ai/conversations/:id', () => {
    let conversationId;
    
    beforeEach(async () => {
      const result = await dbRun(
        `INSERT INTO conversations (title, type, created_by, created_at, updated_at)
         VALUES ('Message Test', 'ai_chat', ?, NOW(), NOW())`,
        [testUserId]
      );
      conversationId = result.lastInsertRowid;
      
      await dbRun(
        `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', NOW())`,
        [conversationId, testUserId]
      );
    });
    
    it('should add a new message to the conversation', async () => {
      const response = await request(app)
        .put(`/api/v3/ai/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: {
            role: 'user',
            content: 'New message content'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify message was added to messages table
      const messages = await dbAll(
        'SELECT * FROM messages WHERE conversation_id = ?',
        [conversationId]
      );
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('New message content');
      expect(messages[0].role).toBe('user');
    });
    
    it('should update conversation.updated_at on new message', async () => {
      const before = await dbGet('SELECT updated_at FROM conversations WHERE id = ?', [conversationId]);
      
      // Wait 1.1 seconds to ensure we cross a second boundary (SQLite datetime precision is seconds)
      await new Promise(r => setTimeout(r, 1100));
      
      await request(app)
        .put(`/api/v3/ai/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: { role: 'user', content: 'Test' } });
      
      const after = await dbGet('SELECT updated_at FROM conversations WHERE id = ?', [conversationId]);
      expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
    });
    
    it('should allow adding assistant messages', async () => {
      const response = await request(app)
        .put(`/api/v3/ai/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: {
            role: 'assistant',
            content: 'AI response with tool results',
            toolResults: [{ tool: 'search', result: 'data' }]
          }
        });
      
      expect(response.status).toBe(200);
      
      const msg = await dbGet(
        'SELECT * FROM messages WHERE conversation_id = ? AND role = ?',
        [conversationId, 'assistant']
      );
      expect(msg).toBeDefined();
      expect(msg.content).toBe('AI response with tool results');
    });
  });
  
  // ==========================================
  // DELETE /ai/conversations/:id
  // ==========================================
  describe('DELETE /api/v3/ai/conversations/:id', () => {
    it('should delete conversation and all its messages', async () => {
      // Create conversation with messages
      const result = await dbRun(
        `INSERT INTO conversations (title, type, created_by, created_at, updated_at)
         VALUES ('To Delete', 'ai_chat', ?, NOW(), NOW())`,
        [testUserId]
      );
      const conversationId = result.lastInsertRowid;
      
      await dbRun(
        `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', NOW())`,
        [conversationId, testUserId]
      );
      
      await dbRun(
        `INSERT INTO messages (conversation_id, sender_id, role, content, content_type, created_at)
         VALUES (?, ?, 'user', 'To be deleted', 'text', NOW())`,
        [conversationId, testUserId]
      );
      
      const response = await request(app)
        .delete(`/api/v3/ai/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Verify cascade delete
      const conv = await dbGet('SELECT * FROM conversations WHERE id = ?', [conversationId]);
      expect(conv).toBeFalsy();
      
      const messages = await dbAll('SELECT * FROM messages WHERE conversation_id = ?', [conversationId]);
      expect(messages.length).toBe(0);
      
      const participants = await dbAll('SELECT * FROM conversation_participants WHERE conversation_id = ?', [conversationId]);
      expect(participants.length).toBe(0);
    });
    
    it('should return 403 if user is not participant', async () => {
      const result = await dbRun(
        `INSERT INTO conversations (title, type, created_by, created_at, updated_at)
         VALUES ('Not Mine', 'ai_chat', ?, NOW(), NOW())`,
        [testAgentId]  // Use testAgentId (exists) but don't add testUserId as participant
      );
      
      const response = await request(app)
        .delete(`/api/v3/ai/conversations/${result.lastInsertRowid}`)
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(403);
      
      // Cleanup
      await dbRun('DELETE FROM conversations WHERE id = ?', [result.lastInsertRowid]);
    });
  });
});
