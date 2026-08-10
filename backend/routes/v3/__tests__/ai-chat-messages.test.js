/**
 * ADR-024 Phase 2: AI Chat → Messages Table Tests
 * 
 * TDD: Tests for AI chat conversations using the new messages table
 * instead of JSON blob in table_rows.
 * 
 * Endpoints tested:
 * - POST /api/v3/chat/conversations - Create AI chat conversation
 * - POST /api/v3/chat/conversations/:id/messages - Send user message
 * - POST /api/v3/chat/conversations/:id/ai-response - AI responds (mock)
 * - GET /api/v3/chat/conversations/:id - Get conversation with messages from DB
 */

// Set env vars BEFORE imports
process.env.SKIP_DEV_USER = 'true';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { dbRun, dbGet, dbAll, isPostgres } from '../../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';

const JWT_SECRET = 'test-secret-key';

describe('ADR-024 Phase 2: AI Chat with Messages Table', () => {
  let app;
  let authToken;
  let testUserId;
  let aiChatConversationId;

  beforeAll(async () => {
    await setupTestDatabase();

    // Create test user
    const ts = Date.now();
    const result = await dbRun(`
      INSERT INTO users (email, password_hash, name, role, encryption_key_encrypted, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [`ai-chat-test-${ts}@test.com`, 'hash123', 'AI Chat Test User', 'admin', 'enc123']);
    testUserId = result.lastInsertRowid;

    // Generate auth token - use 'id' as required by chat.js requireAuth
    authToken = jwt.sign({ id: testUserId, userId: testUserId, email: 'ai-chat-test@test.com', role: 'admin' }, JWT_SECRET);

    // Create Express app
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

  describe('Create AI Chat Conversation', () => {
    it('should create an ai_chat type conversation', async () => {
      const response = await request(app)
        .post('/api/v3/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          title: 'New AI Chat',
          type: 'chat'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.type).toBe('chat');
      expect(response.body.data.title).toBe('New AI Chat');
      
      aiChatConversationId = response.body.data.id;
    });

    it('should add creator as participant automatically', async () => {
      // Check participants in DB
      const participant = await dbGet(
        isPostgres()
          ? 'SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2'
          : 'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
        [aiChatConversationId, testUserId]
      );
      
      expect(participant).toBeDefined();
      expect(participant.role).toBe('admin');
    });
  });

  describe('Send User Message to AI Chat', () => {
    it('should save user message to messages table', async () => {
      const response = await request(app)
        .post(`/api/v3/chat/conversations/${aiChatConversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: 'Hello AI, I need help with a task',
          content_type: 'text'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.content).toBe('Hello AI, I need help with a task');
      expect(response.body.data.role).toBe('user');
      expect(response.body.data.conversation_id).toBe(aiChatConversationId);

      // Verify message is in DB
      const message = await dbGet(
        isPostgres()
          ? 'SELECT * FROM messages WHERE id = $1'
          : 'SELECT * FROM messages WHERE id = ?',
        [response.body.data.id]
      );
      
      expect(message).toBeDefined();
      expect(message.content).toBe('Hello AI, I need help with a task');
    });

    it('should support multiple messages in conversation', async () => {
      // Send a second message
      await request(app)
        .post(`/api/v3/chat/conversations/${aiChatConversationId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Second message' });

      // Get all messages
      const messages = await dbAll(
        isPostgres()
          ? 'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC'
          : 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
        [aiChatConversationId]
      );

      expect(messages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('AI Response (Simulated)', () => {
    it('should save AI response to messages table with role=assistant', async () => {
      // Simulate AI response by inserting directly (in real scenario, this would be done by AI service)
      const result = await dbRun(
        isPostgres()
          ? `INSERT INTO messages 
             (conversation_id, sender_id, sender_type, role, content, content_type, model_used, created_at)
             VALUES ($1, $2, 'agent', 'assistant', $3, 'text', 'gpt-4o', NOW()) RETURNING id`
          : `INSERT INTO messages 
             (conversation_id, sender_id, sender_type, role, content, content_type, model_used, created_at)
             VALUES (?, ?, 'agent', 'assistant', ?, 'text', 'gpt-4o', NOW())`,
        [aiChatConversationId, testUserId, 'I can help you with that task. What would you like to do?']
      );
      
      const aiMessageId = result.lastInsertRowid;
      
      // Verify AI message is stored correctly
      const aiMessage = await dbGet(
        isPostgres()
          ? 'SELECT * FROM messages WHERE id = $1'
          : 'SELECT * FROM messages WHERE id = ?',
        [aiMessageId]
      );
      
      expect(aiMessage).toBeDefined();
      expect(aiMessage.role).toBe('assistant');
      expect(aiMessage.sender_type).toBe('agent');
      expect(aiMessage.model_used).toBe('gpt-4o');
    });
  });

  describe('Get Conversation with Messages', () => {
    it('should return conversation with messages from messages table', async () => {
      const response = await request(app)
        .get(`/api/v3/chat/conversations/${aiChatConversationId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.type).toBe('chat');
      expect(Array.isArray(response.body.data.messages)).toBe(true);
      expect(response.body.data.messages.length).toBeGreaterThanOrEqual(3);
      
      // Messages should include both user and assistant roles
      const roles = response.body.data.messages.map(m => m.role);
      expect(roles).toContain('user');
      expect(roles).toContain('assistant');
    });

    it('should return messages in chronological order', async () => {
      const response = await request(app)
        .get(`/api/v3/chat/conversations/${aiChatConversationId}`)
        .set('Authorization', `Bearer ${authToken}`);

      const messages = response.body.data.messages;
      
      for (let i = 1; i < messages.length; i++) {
        const prev = new Date(messages[i - 1].created_at);
        const curr = new Date(messages[i].created_at);
        expect(curr.getTime()).toBeGreaterThanOrEqual(prev.getTime());
      }
    });
  });

  describe('AI Context Building', () => {
    it.skip('should be able to build context from messages table for AI (chunk_number column removed in PG)', async () => {
      // Import the service
      const { buildAIContext } = await import('../../../services/chatChunkingService.js');
      
      const context = await buildAIContext(aiChatConversationId);
      
      expect(context).toBeDefined();
      expect(context.recentMessages.length).toBeGreaterThan(0);
      expect(context.totalMessages).toBeGreaterThan(0);
    });
  });

  describe.skip('Large Conversation with Summaries (chunk_number column removed in PG)', () => {
    let largeConversationId;

    beforeAll(async () => {
      // Create a new conversation
      const convResult = await dbRun(
        isPostgres()
          ? `INSERT INTO conversations (type, created_by, created_at) VALUES ('ai_chat', $1, NOW()) RETURNING id`
          : `INSERT INTO conversations (type, created_by, created_at) VALUES ('ai_chat', ?, NOW())`,
        [testUserId]
      );
      largeConversationId = isPostgres() ? convResult.rows?.[0]?.id : convResult.lastInsertRowid;

      // Add as participant
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES ($1, $2, 'admin', NOW())`
          : `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'admin', NOW())`,
        [largeConversationId, testUserId]
      );

      // Insert 20 messages to trigger summarization
      for (let i = 0; i < 20; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        await dbRun(
          isPostgres()
            ? `INSERT INTO messages (conversation_id, sender_id, role, content, created_at) 
               VALUES ($1, $2, $3, $4, NOW())`
            : `INSERT INTO messages (conversation_id, sender_id, role, content, created_at) 
               VALUES (?, ?, ?, ?, NOW())`,
          [largeConversationId, testUserId, role, `Message number ${i + 1}`]
        );
      }
    });

    it('should indicate summarization is needed for 20 messages', async () => {
      const { shouldCreateSummary } = await import('../../../services/chatChunkingService.js');
      
      const should = await shouldCreateSummary(largeConversationId);
      expect(should).toBe(true);
    });

    it('should create summary and store in conversation_summaries', async () => {
      const { createSummary } = await import('../../../services/chatChunkingService.js');
      
      // Mock summarization function
      const mockSummarize = async (messages) => {
        return `Summarized ${messages.length} messages: discussion about numbered messages`;
      };
      
      const summary = await createSummary(largeConversationId, mockSummarize);
      
      expect(summary).toBeDefined();
      expect(summary.chunk_number).toBe(1);
      expect(summary.messages_count).toBe(10);
      
      // Verify in DB
      const dbSummary = await dbGet(
        isPostgres()
          ? 'SELECT * FROM conversation_summaries WHERE conversation_id = $1'
          : 'SELECT * FROM conversation_summaries WHERE conversation_id = ?',
        [largeConversationId]
      );
      
      expect(dbSummary).toBeDefined();
      expect(dbSummary.summary).toContain('Summarized 10 messages');
    });

    it('should build context with summary + recent messages', async () => {
      const { buildAIContext } = await import('../../../services/chatChunkingService.js');
      
      const context = await buildAIContext(largeConversationId);
      
      expect(context.summaries.length).toBe(1);
      expect(context.summaries[0]).toContain('Summarized 10 messages');
      expect(context.systemContext).toContain('Previous conversation summary');
      expect(context.recentMessages.length).toBeGreaterThan(0);
    });
  });
});
