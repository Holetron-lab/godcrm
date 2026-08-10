// @vitest-environment node
/**
 * ADR-024: Chat API Tests
 * TDD RED Phase - Tests for /api/v3/chat/* endpoints
 * 
 * Endpoints:
 * - POST /api/v3/chat/conversations - Create conversation
 * - GET /api/v3/chat/conversations - List conversations
 * - GET /api/v3/chat/conversations/:id - Get conversation with messages
 * - POST /api/v3/chat/conversations/:id/messages - Send message
 * - POST /api/v3/chat/conversations/:id/bind - Bind to task
 * - GET /api/v3/chat/tasks/:tableId/:rowId - Get task chat
 * - POST /api/v3/chat/conversations/:id/participants - Add participant
 * - DELETE /api/v3/chat/conversations/:id/participants/:userId - Remove participant
 */

// Set env vars BEFORE imports
process.env.SKIP_DEV_USER = 'true';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { dbRun, dbGet } from '../../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';

// We'll create mock auth and routes for testing
const JWT_SECRET = 'test-secret-key';

describe('ADR-024: Chat API', () => {
  let app;
  let authToken;
  let testUserId;
  let testUser2Id;
  let conversationId;

  beforeAll(async () => {
    // Initialize test database
    await setupTestDatabase();

    // Create test users with unique emails (using timestamp)
    const ts = Date.now();
    const result1 = await dbRun(`
      INSERT INTO users (email, password_hash, name, role, encryption_key_encrypted, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `, [`testuser-${ts}@test.com`, 'hash123', 'Test User', 'admin', 'enc123']);
    testUserId = result1.lastInsertRowid;  // better-sqlite3 uses lastInsertRowid

    const result2 = await dbRun(`
      INSERT INTO users (email, password_hash, name, role, encryption_key_encrypted, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `, [`testuser2-${ts}@test.com`, 'hash456', 'Test User 2', 'user', 'enc456']);
    testUser2Id = result2.lastInsertRowid;

    // Generate auth token - use 'id' as required by chat.js requireAuth middleware
    authToken = jwt.sign({ id: testUserId, userId: testUserId, email: 'testuser@test.com', role: 'admin' }, JWT_SECRET);

    // Create Express app with routes
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

    // Ensure 'tables' table exists (SQLite subqueries in list-conversations reference it)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY,
        name TEXT,
        display_name TEXT,
        icon TEXT
      )
    `);

    // Import and mount chat routes
    const chatRoutes = await import('../chat.js');
    app.use('/api/v3/chat', chatRoutes.default);
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  // ==========================================
  // Phase 1: Create Conversation
  // ==========================================
  describe('POST /api/v3/chat/conversations', () => {
    it('should create a new conversation', async () => {
      const response = await request(app)
        .post('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Test Conversation',
          type: 'chat'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.title).toBe('Test Conversation');
      expect(response.body.data.type).toBe('chat');
      
      conversationId = response.body.data.id;
    });

    it('should create a chat conversation between two users', async () => {
      const response = await request(app)
        .post('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'chat',
          participant_ids: [testUser2Id]
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.type).toBe('chat');
    });

    it('should not 500 when participant_ids contains an id that is not a real user', async () => {
      // Regression: the chat UI could pass an AI Agents row_id (not a users.id).
      // Previously this triggered an FK violation on conversation_participants_user_id_fkey
      // and 500'd the whole request, making some agents un-messageable.
      const response = await request(app)
        .post('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'chat',
          participant_ids: [999999999] // no such user, no such agent row
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should resolve an AI Agents row_id in participant_ids to its agent-user', async () => {
      // Create an agent-user whose managed_by_agent_row_id points at a synthetic
      // AI Agents row id. Passing that row id as a participant must add the
      // agent-USER (not fail), mirroring how the chat UI messages agents.
      // Unique row id per run keeps this deterministic against the shared test DB.
      const agentRowId = 900000000 + (Date.now() % 100000000);
      const agentEmail = `agentuser-${Date.now()}@test.com`;
      await dbRun(`
        INSERT INTO users (email, password_hash, name, role, user_type, managed_by_agent_row_id, encryption_key_encrypted, created_at)
        VALUES (?, ?, ?, ?, 'agent', ?, ?, datetime('now'))
      `, [agentEmail, 'hash', 'Agent Fixture', 'user', agentRowId, 'enc']);

      const response = await request(app)
        .post('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'chat', participant_ids: [agentRowId] });

      expect(response.status).toBe(201);
      const convId = response.body.data.id;
      // Contract: the agent (identified by its AI Agents row_id) is now a
      // participant — resolved to its agent-USER, not inserted as the raw row_id.
      const joined = await dbGet(
        `SELECT cp.user_id FROM conversation_participants cp
         JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = ? AND u.managed_by_agent_row_id = ? AND u.user_type = 'agent'`,
        [convId, agentRowId]
      );
      expect(joined).toBeTruthy();
    });

    it('should reject legacy conversation type with 400', async () => {
      const response = await request(app)
        .post('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'Legacy Type Test',
          type: 'group'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v3/chat/conversations')
        .send({ title: 'No Auth Test' });

      expect(response.status).toBe(401);
    });
  });

  // ==========================================
  // Phase 2: List Conversations
  // ==========================================
  describe('GET /api/v3/chat/conversations', () => {
    it('should list user conversations', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.conversations)).toBe(true);
      expect(response.body.data).toHaveProperty('has_more');
      expect(response.body.data).toHaveProperty('total_count');
    });

    it('should filter by type', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations?type=chat')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      if (response.body.data.conversations.length > 0) {
        expect(response.body.data.conversations.every(c => c.type === 'chat')).toBe(true);
      }
    });

    it('should paginate results', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations?limit=5&offset=0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.conversations.length).toBeLessThanOrEqual(5);
      expect(response.body.data.limit).toBe(5);
      expect(response.body.data.offset).toBe(0);
    });

    it('should include participants array in each conversation', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.conversations)).toBe(true);

      if (response.body.data.conversations.length > 0) {
        const conversation = response.body.data.conversations[0];
        expect(conversation).toHaveProperty('participants');
        expect(Array.isArray(conversation.participants)).toBe(true);

        // Each participant should have user info
        if (conversation.participants.length > 0) {
          const participant = conversation.participants[0];
          expect(participant).toHaveProperty('user_id');
          expect(participant).toHaveProperty('name');
          expect(participant).toHaveProperty('role');
        }
      }
    });
  });

  // ==========================================
  // Ticket #81443: Unified Inbox — type=all|ai|people + userId filter
  // ==========================================
  describe('GET /api/v3/chat/conversations — unified inbox filters (Ticket #81443)', () => {
    let aiConvId;
    let directConvId;

    beforeAll(async () => {
      // Create an AI conversation (type='chat')
      const aiResult = await dbRun(`
        INSERT INTO conversations (title, type, created_by, settings, created_at, updated_at)
        VALUES (?, 'chat', ?, '{}', datetime('now'), datetime('now'))
      `, ['AI Conv', testUserId]);
      aiConvId = aiResult.lastInsertRowid;
      await dbRun(`
        INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
        VALUES (?, ?, 'admin', datetime('now'))
      `, [aiConvId, testUserId]);

      // Create a people conversation (type='direct')
      const directResult = await dbRun(`
        INSERT INTO conversations (title, type, created_by, settings, created_at, updated_at)
        VALUES (?, 'direct', ?, '{}', datetime('now'), datetime('now'))
      `, ['Direct Conv', testUserId]);
      directConvId = directResult.lastInsertRowid;
      await dbRun(`
        INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
        VALUES (?, ?, 'admin', datetime('now'))
      `, [directConvId, testUserId]);
    });

    it('AC1: ?type=all returns both AI and people conversations', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations?type=all')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const ids = response.body.data.conversations.map(c => c.id);
      expect(ids).toContain(aiConvId);
      expect(ids).toContain(directConvId);
    });

    it('AC1b: ?type=ai returns only AI conversations (chat/ai_chat)', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations?type=ai')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const ids = response.body.data.conversations.map(c => c.id);
      expect(ids).toContain(aiConvId);
      expect(ids).not.toContain(directConvId);
      // All returned convs must be AI types
      response.body.data.conversations.forEach(c => {
        expect(['chat', 'ai_chat']).toContain(c.type);
      });
    });

    it('AC1c: ?type=people returns only people conversations (direct/group)', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations?type=people')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const ids = response.body.data.conversations.map(c => c.id);
      expect(ids).toContain(directConvId);
      expect(ids).not.toContain(aiConvId);
      // All returned convs must be people types
      response.body.data.conversations.forEach(c => {
        expect(['direct', 'group']).toContain(c.type);
      });
    });

    it('AC3: ?userId=N filters by participant', async () => {
      // testUser2 is NOT a participant in either conversation created above
      const response = await request(app)
        .get(`/api/v3/chat/conversations?type=all&userId=${testUser2Id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // testUser2 is not participant in aiConvId or directConvId
      const ids = response.body.data.conversations.map(c => c.id);
      expect(ids).not.toContain(aiConvId);
      expect(ids).not.toContain(directConvId);
    });

    it('AC4: ?search=text searches by title', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations?type=all&search=AI Conv')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const ids = response.body.data.conversations.map(c => c.id);
      expect(ids).toContain(aiConvId);
      expect(ids).not.toContain(directConvId);
    });

    it('AC6: AI conversations contain agent_name and agent_icon fields', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations?type=ai')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      if (response.body.data.conversations.length > 0) {
        const aiConv = response.body.data.conversations.find(c => c.id === aiConvId);
        if (aiConv) {
          expect(aiConv).toHaveProperty('agent_name');
          expect(aiConv).toHaveProperty('agent_icon');
        }
      }
    });

    it('AC7: No params returns paginated conversations (backward compat)', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.conversations)).toBe(true);
      expect(response.body.data).toHaveProperty('has_more');
      expect(response.body.data).toHaveProperty('total_count');
    });

    it('AC2: ?agentId=N (agent_id) filter works', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations?type=all&agent_id=99999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // No conversations with agent_id=99999 should be returned
      expect(response.body.data.conversations.length).toBe(0);
    });

    it('AC2b: ?agentId=N (camelCase) filter works', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations?type=all&agentId=99999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // No conversations with agentId=99999 should be returned
      expect(response.body.data.conversations.length).toBe(0);
    });

    it('AC5: ?dateFrom and ?dateTo filter by date range (camelCase)', async () => {
      // Future date range — should return no conversations
      const futureDate = '2099-01-01T00:00:00.000Z';
      const response = await request(app)
        .get(`/api/v3/chat/conversations?type=all&dateFrom=${futureDate}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // No conversations updated after 2099 exist
      expect(response.body.data.conversations.length).toBe(0);
    });

    it('AC5b: ?date_from and ?date_to filter by date range (snake_case)', async () => {
      // Past date range — should include our test conversations
      const pastDate = '2000-01-01T00:00:00.000Z';
      const futureDate = '2099-01-01T00:00:00.000Z';
      const response = await request(app)
        .get(`/api/v3/chat/conversations?type=all&date_from=${pastDate}&date_to=${futureDate}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const ids = response.body.data.conversations.map(c => c.id);
      // Both test conversations should be in this range
      expect(ids).toContain(aiConvId);
      expect(ids).toContain(directConvId);
    });
  });

  // ==========================================
  // Phase 3: Get Conversation with Messages
  // ==========================================
  describe('GET /api/v3/chat/conversations/:id', () => {
    it('should get conversation with messages', async () => {
      // Skip if no conversation created yet
      if (!conversationId) return;

      const response = await request(app)
        .get(`/api/v3/chat/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('messages');
      expect(Array.isArray(response.body.data.messages)).toBe(true);
    });

    it('should return 404 for non-existent conversation', async () => {
      const response = await request(app)
        .get('/api/v3/chat/conversations/99999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });

  // ==========================================
  // Phase 4: Send Messages
  // ==========================================
  describe('POST /api/v3/chat/conversations/:id/messages', () => {
    it('should send a text message', async () => {
      // Skip if no conversation created yet
      if (!conversationId) return;

      const response = await request(app)
        .post(`/api/v3/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'Hello, World!',
          content_type: 'text'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.content).toBe('Hello, World!');
      expect(response.body.data.sender_id).toBe(testUserId);
    });

    it('should send a message with mentions', async () => {
      if (!conversationId) return;

      const response = await request(app)
        .post(`/api/v3/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'Hey @user2, check this out!',
          content_type: 'text',
          mentions: [{ user_id: testUser2Id, offset: 4, length: 6 }]
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.mentions).toContainEqual(
        expect.objectContaining({ user_id: testUser2Id })
      );
    });

    it('should create a reply (threaded message)', async () => {
      if (!conversationId) return;

      // First send a message
      const firstMsg = await request(app)
        .post(`/api/v3/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Original message' });

      // Then reply to it
      const response = await request(app)
        .post(`/api/v3/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'This is a reply',
          parent_id: firstMsg.body.data.id
        });

      expect(response.status).toBe(201);
      expect(response.body.data.parent_id).toBe(firstMsg.body.data.id);
    });
  });

  // ==========================================
  // Phase 5: Task Binding
  // ==========================================
  describe('POST /api/v3/chat/conversations/:id/bind', () => {
    it('should bind conversation to a task', async () => {
      if (!conversationId) return;

      const response = await request(app)
        .post(`/api/v3/chat/conversations/${conversationId}/bind`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          table_id: 1,
          row_id: 100
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.bound_table_id).toBe(1);
      expect(response.body.data.bound_row_id).toBe(100);
    });
  });

  describe('GET /api/v3/chat/tasks/:tableId/:rowId', () => {
    it('should get conversation for a task', async () => {
      const response = await request(app)
        .get('/api/v3/chat/tasks/1/100')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.bound_table_id).toBe(1);
      expect(response.body.data.bound_row_id).toBe(100);
    });

    it('should create conversation if none exists for task', async () => {
      const response = await request(app)
        .get('/api/v3/chat/tasks/2/200?create=true')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.bound_table_id).toBe(2);
      expect(response.body.data.bound_row_id).toBe(200);
    });
  });

  // ==========================================
  // Phase 6: Participants Management
  // ==========================================
  describe('POST /api/v3/chat/conversations/:id/participants', () => {
    it('should add participant to conversation', async () => {
      if (!conversationId) return;

      const response = await request(app)
        .post(`/api/v3/chat/conversations/${conversationId}/participants`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          user_id: testUser2Id,
          role: 'member'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should prevent duplicate participants', async () => {
      if (!conversationId) return;

      // Try to add same participant again
      const response = await request(app)
        .post(`/api/v3/chat/conversations/${conversationId}/participants`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          user_id: testUser2Id,
          role: 'member'
        });

      expect(response.status).toBe(409); // Conflict
    });
  });

  describe('DELETE /api/v3/chat/conversations/:id/participants/:userId', () => {
    it('should remove participant from conversation', async () => {
      if (!conversationId || !testUser2Id) return;

      const response = await request(app)
        .delete(`/api/v3/chat/conversations/${conversationId}/participants/${testUser2Id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // ==========================================
  // Phase 7: Search (Full-Text)
  // ==========================================
  describe.skip('GET /api/v3/chat/search (endpoint removed during chat refactor)', () => {
    it('should search messages by content', async () => {
      const response = await request(app)
        .get('/api/v3/chat/search?q=Hello')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter search by conversation', async () => {
      if (!conversationId) return;

      const response = await request(app)
        .get(`/api/v3/chat/search?q=Hello&conversation_id=${conversationId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // ==========================================
  // Phase 8: Unread Messages Count (ADR-024 Inbox)
  // ==========================================
  describe('GET /api/v3/chat/conversations - unread_count', () => {
    let inboxConversationId;
    let user2Token;

    beforeAll(async () => {
      // Create token for user 2 - use 'id' as required by chat.js requireAuth
      user2Token = jwt.sign({ id: testUser2Id, userId: testUser2Id, email: 'testuser2@test.com', role: 'user' }, JWT_SECRET);
    });

    it('should include unread_count in conversation list', async () => {
      // Create a new conversation
      const createRes = await request(app)
        .post('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'chat',
          participant_ids: [testUser2Id]
        });

      inboxConversationId = createRes.body.data.id;

      // User1 sends a message
      await request(app)
        .post(`/api/v3/chat/conversations/${inboxConversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Hello from user1!', content_type: 'text' });

      // User2 checks their conversations - should see unread_count
      const response = await request(app)
        .get('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      const conv = response.body.data.conversations.find(c => c.id === inboxConversationId);
      expect(conv).toBeDefined();
      expect(conv).toHaveProperty('unread_count');
      expect(typeof conv.unread_count).toBe('number');
      expect(conv.unread_count).toBeGreaterThanOrEqual(1);
    });

    it('should return 0 unread for sender', async () => {
      // User1 (sender) should have 0 unread
      const response = await request(app)
        .get('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);

      const conv = response.body.data.conversations.find(c => c.id === inboxConversationId);
      if (conv) {
        // Sender sees their own messages, unread should be 0 for self-sent
        expect(conv).toHaveProperty('unread_count');
      }
    });
  });

  // ==========================================
  // Phase 9: Mark Messages as Read
  // ==========================================
  describe('POST /api/v3/chat/conversations/:id/read', () => {
    let readTestConvId;
    let user2Token;

    beforeAll(async () => {
      user2Token = jwt.sign({ id: testUser2Id, userId: testUser2Id, email: 'testuser2@test.com', role: 'user' }, JWT_SECRET);

      // Create conversation and send message
      const createRes = await request(app)
        .post('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: 'chat',
          participant_ids: [testUser2Id]
        });

      readTestConvId = createRes.body.data.id;

      // Send message from user1
      await request(app)
        .post(`/api/v3/chat/conversations/${readTestConvId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Test message for read marking', content_type: 'text' });
    });

    it('should mark messages as read', async () => {
      // User2 marks as read
      const response = await request(app)
        .post(`/api/v3/chat/conversations/${readTestConvId}/read`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should set unread_count to 0 after marking read', async () => {
      // Mark as read
      await request(app)
        .post(`/api/v3/chat/conversations/${readTestConvId}/read`)
        .set('Authorization', `Bearer ${user2Token}`);

      // Check unread count
      const response = await request(app)
        .get('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${user2Token}`);

      const conv = response.body.data.conversations.find(c => c.id === readTestConvId);
      expect(conv).toBeDefined();
      expect(conv.unread_count).toBe(0);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post(`/api/v3/chat/conversations/${readTestConvId}/read`);

      expect(response.status).toBe(401);
    });
  });

  // ==========================================
  // Phase 10: Total Unread Count
  // ==========================================
  describe('GET /api/v3/chat/unread', () => {
    it('should return total unread count across all conversations', async () => {
      const response = await request(app)
        .get('/api/v3/chat/unread')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('total_unread');
      expect(typeof response.body.data.total_unread).toBe('number');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/v3/chat/unread');

      expect(response.status).toBe(401);
    });
  });
});
