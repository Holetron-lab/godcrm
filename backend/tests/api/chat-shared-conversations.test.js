/**
 * TASK-043: Shared Conversations API Tests
 * TDD: Test shared conversations between users
 * 
 * Behavior 1: GET /api/v3/chat/conversations/with/:userId
 * - Returns all conversations where BOTH current user AND target user are participants
 * - Includes last message preview, unread count, updated_at
 * 
 * Uses PostgreSQL DEV database - SKIPPED in SQLite environment
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { dbRun, dbGet, isPostgres } from '../../database/connection.js';
import chatRoutes from '../../routes/v3/chat.js';

// Skip this test suite if not PostgreSQL
const describeIfPostgres = isPostgres() ? describe : describe.skip;

const app = express();
app.use(express.json());

// Mock authentication middleware - sets req.user
app.use((req, res, next) => {
  const userId = req.headers['x-test-user-id'];
  if (userId) {
    req.user = { id: parseInt(userId), userId: parseInt(userId) };
  }
  next();
});

app.use('/api/v3/chat', chatRoutes);

// Test data - unique suffix to avoid conflicts
const TEST_SUFFIX = `test_${Date.now()}`;
let testUser1Id;
let testUser2Id;
let testUser3Id;
let sharedConversationId;
let privateConversationId;

describeIfPostgres('Shared Conversations API (PostgreSQL)', () => {
  beforeAll(async () => {
    // Create test users with unique emails
    const user1Result = await dbRun(
      `INSERT INTO users (name, email, password_hash, encryption_key_encrypted, created_at)
       VALUES ($1, $2, $3, 'none', NOW()) RETURNING id`,
      [`Test User 1 ${TEST_SUFFIX}`, `testuser1-${TEST_SUFFIX}@test.com`, 'hash']
    );
    testUser1Id = user1Result.lastInsertRowid;

    const user2Result = await dbRun(
      `INSERT INTO users (name, email, password_hash, encryption_key_encrypted, created_at)
       VALUES ($1, $2, $3, 'none', NOW()) RETURNING id`,
      [`Test User 2 ${TEST_SUFFIX}`, `testuser2-${TEST_SUFFIX}@test.com`, 'hash']
    );
    testUser2Id = user2Result.lastInsertRowid;

    const user3Result = await dbRun(
      `INSERT INTO users (name, email, password_hash, encryption_key_encrypted, created_at)
       VALUES ($1, $2, $3, 'none', NOW()) RETURNING id`,
      [`Test User 3 ${TEST_SUFFIX}`, `testuser3-${TEST_SUFFIX}@test.com`, 'hash']
    );
    testUser3Id = user3Result.lastInsertRowid;

    // Create a shared conversation between user1 and user2
    const conv1Result = await dbRun(
      `INSERT INTO conversations (title, type, created_by, created_at, updated_at) 
       VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
      [`Shared Chat 1-2 ${TEST_SUFFIX}`, 'direct', testUser1Id]
    );
    sharedConversationId = conv1Result.lastInsertRowid;

    // Add both users to shared conversation
    await dbRun(
      `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) 
       VALUES ($1, $2, $3, NOW())`,
      [sharedConversationId, testUser1Id, 'admin']
    );
    await dbRun(
      `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) 
       VALUES ($1, $2, $3, NOW())`,
      [sharedConversationId, testUser2Id, 'member']
    );

    // Create a private conversation (only user1 and user3)
    const conv2Result = await dbRun(
      `INSERT INTO conversations (title, type, created_by, created_at, updated_at) 
       VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
      [`Private Chat 1-3 ${TEST_SUFFIX}`, 'direct', testUser1Id]
    );
    privateConversationId = conv2Result.lastInsertRowid;

    await dbRun(
      `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) 
       VALUES ($1, $2, $3, NOW())`,
      [privateConversationId, testUser1Id, 'admin']
    );
    await dbRun(
      `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) 
       VALUES ($1, $2, $3, NOW())`,
      [privateConversationId, testUser3Id, 'member']
    );

    // Add a message to shared conversation
    await dbRun(
      `INSERT INTO messages (conversation_id, sender_id, role, content, created_at) 
       VALUES ($1, $2, $3, $4, NOW())`,
      [sharedConversationId, testUser1Id, 'user', `Hello from user 1! ${TEST_SUFFIX}`]
    );
  });

  afterAll(async () => {
    // Cleanup test data
    if (sharedConversationId) {
      await dbRun(`DELETE FROM messages WHERE conversation_id = $1`, [sharedConversationId]);
      await dbRun(`DELETE FROM conversation_participants WHERE conversation_id = $1`, [sharedConversationId]);
      await dbRun(`DELETE FROM conversations WHERE id = $1`, [sharedConversationId]);
    }
    if (privateConversationId) {
      await dbRun(`DELETE FROM messages WHERE conversation_id = $1`, [privateConversationId]);
      await dbRun(`DELETE FROM conversation_participants WHERE conversation_id = $1`, [privateConversationId]);
      await dbRun(`DELETE FROM conversations WHERE id = $1`, [privateConversationId]);
    }
    if (testUser1Id) await dbRun(`DELETE FROM users WHERE id = $1`, [testUser1Id]);
    if (testUser2Id) await dbRun(`DELETE FROM users WHERE id = $1`, [testUser2Id]);
    if (testUser3Id) await dbRun(`DELETE FROM users WHERE id = $1`, [testUser3Id]);
  });

  describe('GET /api/v3/chat/conversations/with/:userId', () => {
    it('should return 401 if not authenticated', async () => {
      const res = await request(app)
        .get(`/api/v3/chat/conversations/with/${testUser2Id}`);
      
      expect(res.status).toBe(401);
    });

    it('should return shared conversations between current user and target user', async () => {
      const res = await request(app)
        .get(`/api/v3/chat/conversations/with/${testUser2Id}`)
        .set('x-test-user-id', String(testUser1Id));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      
      // Should include the shared conversation
      const sharedConv = res.body.data.find(c => c.id === sharedConversationId);
      expect(sharedConv).toBeDefined();
      expect(sharedConv.title).toContain('Shared Chat 1-2');
    });

    it('should NOT return conversations where target user is NOT a participant', async () => {
      const res = await request(app)
        .get(`/api/v3/chat/conversations/with/${testUser2Id}`)
        .set('x-test-user-id', String(testUser1Id));

      expect(res.status).toBe(200);
      
      // Should NOT include the private conversation with user3
      const privateConv = res.body.data.find(c => c.id === privateConversationId);
      expect(privateConv).toBeUndefined();
    });

    it('should return empty array if no shared conversations', async () => {
      const res = await request(app)
        .get(`/api/v3/chat/conversations/with/${testUser3Id}`)
        .set('x-test-user-id', String(testUser2Id));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(0);
    });

    it('should include messages_count in response', async () => {
      const res = await request(app)
        .get(`/api/v3/chat/conversations/with/${testUser2Id}`)
        .set('x-test-user-id', String(testUser1Id));

      expect(res.status).toBe(200);
      
      const sharedConv = res.body.data.find(c => c.id === sharedConversationId);
      expect(sharedConv).toBeDefined();
      expect(sharedConv.messages_count).toBeGreaterThanOrEqual(1);
    });
  });
});
