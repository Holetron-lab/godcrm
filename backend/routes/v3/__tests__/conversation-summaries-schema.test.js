/**
 * ADR-024 Phase 2: conversation_summaries Table Schema Tests
 * 
 * TDD: RED Phase - Tests for the new table that stores AI-generated
 * summaries of conversation chunks for efficient context loading.
 * 
 * Table: conversation_summaries
 * Purpose: Cache AI summaries for old message chunks
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// Set env vars BEFORE imports
process.env.SKIP_DEV_USER = 'true';

import { dbRun, dbGet, dbAll, isPostgres } from '../../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';

/**
 * Helper to get table columns
 */
async function getTableColumns(tableName) {
  if (isPostgres()) {
    const result = await dbAll(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);
    return result;
  } else {
    const result = await dbAll(`PRAGMA table_info(${tableName})`);
    return result.map(r => ({
      column_name: r.name,
      data_type: r.type.toLowerCase(),
      is_nullable: r.notnull === 0 ? 'YES' : 'NO'
    }));
  }
}

/**
 * Helper to check if index exists
 */
async function indexExists(tableName, indexName) {
  if (isPostgres()) {
    const result = await dbGet(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = $1 AND indexname = $2
    `, [tableName, indexName]);
    return !!result;
  } else {
    const result = await dbAll(`PRAGMA index_list(${tableName})`);
    return result.some(r => r.name === indexName);
  }
}

describe('ADR-024 Phase 2: conversation_summaries Schema', () => {
  
  beforeAll(async () => {
    await setupTestDatabase();
  });
  
  afterAll(async () => {
    await cleanupTestDatabase();
  });

  describe('Table Structure', () => {
    
    it('should have conversation_summaries table with required columns', async () => {
      const columns = await getTableColumns('conversation_summaries');
      const columnNames = columns.map(c => c.column_name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('conversation_id');
      expect(columnNames).toContain('summary');
      expect(columnNames).toContain('message_range_start');
      expect(columnNames).toContain('message_range_end');
      expect(columnNames).toContain('tokens_saved');
      expect(columnNames).toContain('created_at');
    });

    it('should have index on conversation_id', async () => {
      const hasIndex = await indexExists('conversation_summaries', 'idx_summaries_conversation');
      expect(hasIndex).toBe(true);
    });
  });

  describe('CRUD Operations', () => {
    let testConversationId;
    let testUserId;

    beforeEach(async () => {
      // Create test user
      const ts = Date.now();
      const userResult = await dbRun(
        `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, created_at)
         VALUES ($1, 'hash', 'Test', 'enc', NOW())`,
        [`summary-test-${ts}@test.com`]
      );
      testUserId = userResult.lastInsertRowid;

      // Ticket #41154: Use unified 'chat' type (ADR-091)
      const convResult = await dbRun(
        `INSERT INTO conversations (type, created_by, created_at)
         VALUES ('chat', $1, NOW())`,
        [testUserId]
      );
      testConversationId = convResult.lastInsertRowid;
    });

    afterEach(async () => {
      // Cleanup in order (summaries first due to FK)
      if (testConversationId) {
        await dbRun('DELETE FROM conversation_summaries WHERE conversation_id = $1', [testConversationId]);
        await dbRun('DELETE FROM conversations WHERE id = $1', [testConversationId]);
      }
      if (testUserId) {
        await dbRun('DELETE FROM users WHERE id = $1', [testUserId]);
      }
    });

    it('should insert and retrieve summary', async () => {
      const insertResult = await dbRun(
        `INSERT INTO conversation_summaries
         (conversation_id, summary, message_range_start, message_range_end, tokens_saved, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [testConversationId, 'User discussed login bug', 1, 10, 500]
      );

      const summaryId = insertResult.lastInsertRowid;
      expect(summaryId).toBeGreaterThan(0);

      // Retrieve
      const summary = await dbGet(
        'SELECT * FROM conversation_summaries WHERE id = $1',
        [summaryId]
      );

      expect(summary).toBeDefined();
      expect(summary.conversation_id).toBe(testConversationId);
      expect(summary.message_range_start).toBe(1);
      expect(summary.message_range_end).toBe(10);
      expect(summary.summary).toBe('User discussed login bug');
    });

    it.skip('should enforce unique constraint on (conversation_id, chunk_number) - chunk_number removed in PG schema', async () => {
    });

    it('should cascade delete summaries when conversation is deleted', async () => {
      // Insert summary
      await dbRun(
        `INSERT INTO conversation_summaries
         (conversation_id, summary, message_range_start, message_range_end, created_at)
         VALUES ($1, 'Summary to delete', 1, 10, NOW())`,
        [testConversationId]
      );

      // Verify it exists
      const beforeDelete = await dbGet(
        'SELECT * FROM conversation_summaries WHERE conversation_id = $1',
        [testConversationId]
      );
      expect(beforeDelete).toBeDefined();

      // Delete conversation
      await dbRun(
        'DELETE FROM conversations WHERE id = $1',
        [testConversationId]
      );

      // Summary should be cascade deleted
      const afterDelete = await dbGet(
        'SELECT * FROM conversation_summaries WHERE conversation_id = $1',
        [testConversationId]
      );
      expect(afterDelete).toBeFalsy();

      // Mark as already deleted
      testConversationId = null;
    });

    it('should support multiple summaries for same conversation', async () => {
      // Insert 3 summaries with different ranges
      for (let i = 1; i <= 3; i++) {
        await dbRun(
          `INSERT INTO conversation_summaries
           (conversation_id, summary, message_range_start, message_range_end, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [testConversationId, `Summary for range ${i}`, (i - 1) * 10 + 1, i * 10]
        );
      }

      // Retrieve all summaries
      const summaries = await dbAll(
        'SELECT * FROM conversation_summaries WHERE conversation_id = $1 ORDER BY message_range_start',
        [testConversationId]
      );

      expect(summaries).toHaveLength(3);
      expect(summaries[0].message_range_start).toBe(1);
      expect(summaries[1].message_range_start).toBe(11);
      expect(summaries[2].message_range_start).toBe(21);
    });
  });
});
