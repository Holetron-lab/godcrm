/**
 * ADR-024 Phase 2: chatChunkingService v2 Tests
 * 
 * TDD: RED Phase - Tests for refactored service that uses DB tables
 * instead of JSON blob for summaries.
 * 
 * Key changes:
 * - Uses `messages` table instead of JSON array
 * - Uses `conversation_summaries` table for cached summaries
 * - Provides efficient context building for AI
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// Set env vars BEFORE imports
process.env.SKIP_DEV_USER = 'true';

import { dbRun, dbGet, dbAll, isPostgres } from '../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../tests/helpers/test-db.js';

// Import service under test
import {
  CHUNK_SIZE,
  KEEP_RECENT_MESSAGES,
  shouldCreateSummary,
  createSummary,
  buildAIContext,
  getMessageCount,
  getSummarizedMessageCount
} from '../chatChunkingService.js';

describe('ADR-024 Phase 2: chatChunkingService v2', () => {
  let testUserId;
  let testConversationId;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    const ts = Date.now();
    
    // Create test user
    const userResult = await dbRun(
      `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, created_at) VALUES ($1, 'hash', 'Test', 'enc', NOW())`,
      [`chunking-test-${ts}@test.com`]
    );
    testUserId = userResult.lastInsertRowid;

    // Create test conversation
    const convResult = await dbRun(
      `INSERT INTO conversations (type, created_by, created_at) VALUES ('ai_chat', $1, NOW())`,
      [testUserId]
    );
    testConversationId = convResult.lastInsertRowid;
  });

  afterEach(async () => {
    // Cleanup
    if (testConversationId) {
      await dbRun('DELETE FROM conversation_summaries WHERE conversation_id = $1', [testConversationId]);
      await dbRun('DELETE FROM messages WHERE conversation_id = $1', [testConversationId]);
      await dbRun('DELETE FROM conversations WHERE id = $1', [testConversationId]);
    }
    if (testUserId) {
      await dbRun('DELETE FROM users WHERE id = $1', [testUserId]);
    }
  });

  /**
   * Helper to insert test messages
   */
  async function insertMessages(conversationId, senderId, count) {
    const messageIds = [];
    for (let i = 0; i < count; i++) {
      const result = await dbRun(
        `INSERT INTO messages (conversation_id, sender_id, role, content, created_at)
         VALUES ($1, $2, 'user', $3, NOW())`,
        [conversationId, senderId, `Test message ${i + 1}`]
      );
      messageIds.push(result.lastInsertRowid);
    }
    return messageIds;
  }

  describe('getMessageCount()', () => {
    it('should return 0 for empty conversation', async () => {
      const count = await getMessageCount(testConversationId);
      expect(count).toBe(0);
    });

    it('should return correct count for conversation with messages', async () => {
      await insertMessages(testConversationId, testUserId, 15);
      const count = await getMessageCount(testConversationId);
      expect(count).toBe(15);
    });
  });

  describe('getSummarizedMessageCount()', () => {
    it('should return 0 when no summaries exist', async () => {
      const count = await getSummarizedMessageCount(testConversationId);
      expect(count).toBe(0);
    });

    it('should return sum of messages_count from all summaries', async () => {
      // Insert 2 summaries with 10 messages each
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 1, 1, 10, 10, 'Summary 1', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 1, 1, 10, 10, 'Summary 1', datetime('now'))`,
        [testConversationId]
      );
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 2, 11, 20, 10, 'Summary 2', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 2, 11, 20, 10, 'Summary 2', datetime('now'))`,
        [testConversationId]
      );

      const count = await getSummarizedMessageCount(testConversationId);
      expect(count).toBe(20);
    });
  });

  describe('shouldCreateSummary()', () => {
    it('returns false when less than CHUNK_SIZE + KEEP_RECENT messages', async () => {
      // Less than 10 + 5 = 15 messages
      await insertMessages(testConversationId, testUserId, 14);
      
      const should = await shouldCreateSummary(testConversationId);
      expect(should).toBe(false);
    });

    it('returns true when CHUNK_SIZE + KEEP_RECENT unsummarized messages exist', async () => {
      // Exactly 15 messages = CHUNK_SIZE(10) + KEEP_RECENT(5)
      await insertMessages(testConversationId, testUserId, 15);
      
      const should = await shouldCreateSummary(testConversationId);
      expect(should).toBe(true);
    });

    it('returns false when all eligible messages are summarized', async () => {
      // 25 messages, but 20 are summarized
      await insertMessages(testConversationId, testUserId, 25);
      
      // Add summary for first 20 messages
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 1, 1, 10, 10, 'Summary 1', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 1, 1, 10, 10, 'Summary 1', datetime('now'))`,
        [testConversationId]
      );
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 2, 11, 20, 10, 'Summary 2', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 2, 11, 20, 10, 'Summary 2', datetime('now'))`,
        [testConversationId]
      );

      // 25 total - 20 summarized = 5 unsummarized (= KEEP_RECENT, so no new summary needed)
      const should = await shouldCreateSummary(testConversationId);
      expect(should).toBe(false);
    });

    it('returns true when new chunk of unsummarized messages exists', async () => {
      // 35 messages, first 20 summarized
      await insertMessages(testConversationId, testUserId, 35);
      
      // Add summary for first 20 messages
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 1, 1, 10, 10, 'Summary 1', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 1, 1, 10, 10, 'Summary 1', datetime('now'))`,
        [testConversationId]
      );
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 2, 11, 20, 10, 'Summary 2', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 2, 11, 20, 10, 'Summary 2', datetime('now'))`,
        [testConversationId]
      );

      // 35 total - 20 summarized - 5 keep_recent = 10 unsummarized >= CHUNK_SIZE
      const should = await shouldCreateSummary(testConversationId);
      expect(should).toBe(true);
    });
  });

  describe('createSummary()', () => {
    it('creates summary for oldest unsummarized chunk and saves to DB', async () => {
      // Create 20 messages
      const messageIds = await insertMessages(testConversationId, testUserId, 20);
      
      // Mock the AI summary generation (we'll inject this later)
      const mockSummaryText = 'User discussed testing the chunking service.';
      
      // Create summary (should summarize first 10 messages)
      const summary = await createSummary(testConversationId, () => Promise.resolve(mockSummaryText));
      
      expect(summary).toBeDefined();
      expect(summary.chunk_number).toBe(1);
      expect(summary.messages_count).toBe(CHUNK_SIZE);
      expect(summary.summary).toBe(mockSummaryText);
      
      // Verify it was saved to DB
      const saved = await dbGet(
        isPostgres()
          ? 'SELECT * FROM conversation_summaries WHERE conversation_id = $1 AND chunk_number = 1'
          : 'SELECT * FROM conversation_summaries WHERE conversation_id = ? AND chunk_number = 1',
        [testConversationId]
      );
      expect(saved).toBeDefined();
      expect(saved.summary).toBe(mockSummaryText);
    });

    it('creates next chunk summary when previous chunks are summarized', async () => {
      // Create 30 messages
      await insertMessages(testConversationId, testUserId, 30);
      
      // Add summary for first chunk
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 1, 1, 10, 10, 'First chunk summary', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 1, 1, 10, 10, 'First chunk summary', datetime('now'))`,
        [testConversationId]
      );
      
      // Create summary for second chunk
      const summary = await createSummary(testConversationId, () => Promise.resolve('Second chunk summary'));
      
      expect(summary.chunk_number).toBe(2);
      expect(summary.summary).toBe('Second chunk summary');
    });

    it('returns null when no summarization needed', async () => {
      // Only 10 messages (less than CHUNK_SIZE + KEEP_RECENT)
      await insertMessages(testConversationId, testUserId, 10);
      
      const summary = await createSummary(testConversationId, () => Promise.resolve('Should not be called'));
      
      expect(summary).toBeNull();
    });
  });

  describe('buildAIContext()', () => {
    it('returns empty context for empty conversation', async () => {
      const context = await buildAIContext(testConversationId);
      
      expect(context.summaries).toEqual([]);
      expect(context.recentMessages).toEqual([]);
      expect(context.totalMessages).toBe(0);
    });

    it('returns only recent messages when no summaries exist', async () => {
      // Create 8 messages (less than would trigger summary)
      await insertMessages(testConversationId, testUserId, 8);
      
      const context = await buildAIContext(testConversationId);
      
      expect(context.summaries).toEqual([]);
      expect(context.recentMessages).toHaveLength(8);
      expect(context.totalMessages).toBe(8);
    });

    it('returns summaries + recent messages for long conversations', async () => {
      // Create 25 messages
      await insertMessages(testConversationId, testUserId, 25);
      
      // Add summaries for first 20
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 1, 1, 10, 10, 'Chunk 1 summary', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 1, 1, 10, 10, 'Chunk 1 summary', datetime('now'))`,
        [testConversationId]
      );
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 2, 11, 20, 10, 'Chunk 2 summary', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 2, 11, 20, 10, 'Chunk 2 summary', datetime('now'))`,
        [testConversationId]
      );
      
      const context = await buildAIContext(testConversationId);
      
      // Should have 2 summaries
      expect(context.summaries).toHaveLength(2);
      expect(context.summaries[0]).toBe('Chunk 1 summary');
      expect(context.summaries[1]).toBe('Chunk 2 summary');
      
      // Should have recent messages (KEEP_RECENT + some buffer)
      expect(context.recentMessages.length).toBeGreaterThanOrEqual(KEEP_RECENT_MESSAGES);
      
      // Total messages count
      expect(context.totalMessages).toBe(25);
      expect(context.summarizedMessages).toBe(20);
    });

    it('returns system context string for AI prompt', async () => {
      // Create messages and summaries
      await insertMessages(testConversationId, testUserId, 15);
      await dbRun(
        isPostgres()
          ? `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES ($1, 1, 1, 10, 10, 'User asked about login bug', NOW())`
          : `INSERT INTO conversation_summaries (conversation_id, chunk_number, messages_start_id, messages_end_id, messages_count, summary, created_at)
             VALUES (?, 1, 1, 10, 10, 'User asked about login bug', datetime('now'))`,
        [testConversationId]
      );
      
      const context = await buildAIContext(testConversationId);
      
      expect(context.systemContext).toContain('Previous conversation summary');
      expect(context.systemContext).toContain('User asked about login bug');
    });
  });
});
