/**
 * Tests for Chat Database Schema (ADR-024)
 * Messenger-style architecture: conversations + messages
 * 
 * TDD: These tests are written FIRST, before implementation
 * Phase 1: Test that tables exist and have correct structure
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Set env vars BEFORE imports
process.env.SKIP_DEV_USER = 'true';  // Don't create dev user (avoids NeoMetal dependency)

import { dbRun, dbGet, dbAll, isPostgres } from '../../../database/connection.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../tests/helpers/test-db.js';

// Mock user for tests
const TEST_USER_ID = 1;

/**
 * Helper to get table columns (works for both SQLite and PostgreSQL)
 */
async function getTableColumns(tableName) {
  if (isPostgres()) {
    const result = await dbAll(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);
    return result.map(r => r.column_name);
  } else {
    // SQLite: PRAGMA table_info
    const result = await dbAll(`PRAGMA table_info(${tableName})`);
    return result.map(r => r.name);
  }
}

/**
 * Helper to get table indexes (works for both SQLite and PostgreSQL)
 */
async function getTableIndexes(tableName) {
  if (isPostgres()) {
    const result = await dbAll(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1
    `, [tableName]);
    return result;
  } else {
    // SQLite: PRAGMA index_list
    const result = await dbAll(`PRAGMA index_list(${tableName})`);
    return result.map(r => ({ indexname: r.name, indexdef: '' }));
  }
}

describe('Chat Database Schema (ADR-024)', () => {
  
  beforeAll(async () => {
    // Initialize database with schema
    await setupTestDatabase();
  });
  
  afterAll(async () => {
    await cleanupTestDatabase();
  });
  
  describe('Phase 1: Tables Exist', () => {
    
    it('should have conversations table', async () => {
      const columnNames = await getTableColumns('conversations');
      
      expect(columnNames.length).toBeGreaterThan(0);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('type');
      expect(columnNames).toContain('title');
      expect(columnNames).toContain('created_by');
      expect(columnNames).toContain('space_id');
      expect(columnNames).toContain('agent_id');
      expect(columnNames).toContain('bound_table_id');
      expect(columnNames).toContain('bound_row_id');
      expect(columnNames).toContain('last_message_id');
      expect(columnNames).toContain('messages_count');
      expect(columnNames).toContain('settings');
      expect(columnNames).toContain('created_at');
    });

    it('should have messages table', async () => {
      const columnNames = await getTableColumns('messages');
      
      expect(columnNames.length).toBeGreaterThan(0);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('conversation_id');
      expect(columnNames).toContain('sender_id');
      expect(columnNames).toContain('sender_type');
      expect(columnNames).toContain('role');
      expect(columnNames).toContain('content');
      expect(columnNames).toContain('content_type');
      expect(columnNames).toContain('parent_id');
      expect(columnNames).toContain('mentions');
      expect(columnNames).toContain('attachments');
      expect(columnNames).toContain('is_edited');
      expect(columnNames).toContain('is_deleted');
      expect(columnNames).toContain('created_at');
    });

    it('should have conversation_participants table', async () => {
      const columnNames = await getTableColumns('conversation_participants');
      
      expect(columnNames.length).toBeGreaterThan(0);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('conversation_id');
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('role');
      expect(columnNames).toContain('last_read_message_id');
      expect(columnNames).toContain('unread_count');
    });

    it('should have message_reactions table', async () => {
      const columnNames = await getTableColumns('message_reactions');
      
      expect(columnNames.length).toBeGreaterThan(0);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('message_id');
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('emoji');
    });
  });

  describe('Phase 2: CRUD Operations', () => {
    let testConversationId;
    let testMessageId;
    let testUserId;

    beforeAll(async () => {
      // Create test user for FK constraints
      const userResult = await dbRun(`
        INSERT INTO users (email, password_hash, name, encryption_key_encrypted, created_at, updated_at)
        VALUES ('chat-test@test.com', 'hash123', 'Chat Test User', 'encrypted_key', datetime('now'), datetime('now'))
      `);
      testUserId = userResult.lastInsertRowid || 1;
    });

    afterAll(async () => {
      // Cleanup
      try {
        if (testMessageId) {
          await dbRun('DELETE FROM messages WHERE id = ?', [testMessageId]);
        }
        if (testConversationId) {
          await dbRun('DELETE FROM conversations WHERE id = ?', [testConversationId]);
        }
        if (testUserId) {
          await dbRun('DELETE FROM users WHERE id = ?', [testUserId]);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    });

    it('should create a conversation', async () => {
      // Ticket #41154: Use unified 'chat' type (ADR-091)
      const result = await dbRun(`
        INSERT INTO conversations (type, title, created_by, settings, created_at, updated_at)
        VALUES ('chat', 'Test Conversation', ?, '{}', datetime('now'), datetime('now'))
      `, [testUserId]);

      testConversationId = result.id || result.lastInsertRowid;
      expect(testConversationId).toBeDefined();

      // Verify it was created
      const conversation = await dbGet('SELECT * FROM conversations WHERE id = ?', [testConversationId]);
      expect(conversation).toBeDefined();
      expect(conversation.title).toBe('Test Conversation');
      expect(conversation.type).toBe('chat');
    });

    it('should create a message in conversation', async () => {
      const result = await dbRun(`
        INSERT INTO messages (
          conversation_id, sender_id, sender_type, role, content, 
          content_type, mentions, attachments, created_at, updated_at
        )
        VALUES (?, ?, 'human', 'user', 'Hello, test message', 'text', '[]', '[]', datetime('now'), datetime('now'))
      `, [testConversationId, testUserId]);
      
      testMessageId = result.id || result.lastInsertRowid;
      expect(testMessageId).toBeDefined();
      
      // Verify
      const message = await dbGet('SELECT * FROM messages WHERE id = ?', [testMessageId]);
      expect(message).toBeDefined();
      expect(message.content).toBe('Hello, test message');
      expect(message.role).toBe('user');
      expect(message.conversation_id).toBe(testConversationId);
    });

    it('should support message threading (parent_id)', async () => {
      // Create parent message
      const parentResult = await dbRun(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, created_at, updated_at)
        VALUES (?, ?, 'human', 'user', 'Parent message', 'text', '[]', '[]', datetime('now'), datetime('now'))
      `, [testConversationId, testUserId]);
      
      const parentId = parentResult.id || parentResult.lastInsertRowid;
      
      // Create reply
      const replyResult = await dbRun(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, parent_id, mentions, attachments, created_at, updated_at)
        VALUES (?, ?, 'human', 'user', 'Reply message', 'text', ?, '[]', '[]', datetime('now'), datetime('now'))
      `, [testConversationId, testUserId, parentId]);
      
      const replyId = replyResult.id || replyResult.lastInsertRowid;
      
      // Verify threading
      const reply = await dbGet('SELECT * FROM messages WHERE id = ?', [replyId]);
      expect(reply.parent_id).toBe(parentId);
      
      // Cleanup
      await dbRun('DELETE FROM messages WHERE id = ?', [replyId]);
      await dbRun('DELETE FROM messages WHERE id = ?', [parentId]);
    });

    it('should support task binding on conversation', async () => {
      // Update conversation with task binding
      await dbRun(`
        UPDATE conversations 
        SET bound_table_id = ?, bound_row_id = ?, type = 'task', updated_at = datetime('now')
        WHERE id = ?
      `, [100, 200, testConversationId]);
      
      const conversation = await dbGet('SELECT * FROM conversations WHERE id = ?', [testConversationId]);
      expect(conversation.bound_table_id).toBe(100);
      expect(conversation.bound_row_id).toBe(200);
      expect(conversation.type).toBe('task');
      
      // Reset to unified 'chat' type (Ticket #41154 / ADR-091)
      await dbRun(`
        UPDATE conversations
        SET bound_table_id = NULL, bound_row_id = NULL, type = 'chat', updated_at = datetime('now')
        WHERE id = ?
      `, [testConversationId]);
    });

    it('should store mentions as JSON', async () => {
      const mentions = JSON.stringify([
        { user_id: 1, type: 'human' },
        { agent_id: 42, type: 'agent' }
      ]);
      
      const result = await dbRun(`
        INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, mentions, attachments, created_at, updated_at)
        VALUES (?, ?, 'human', 'user', '@dev-agent please help', 'text', ?, '[]', datetime('now'), datetime('now'))
      `, [testConversationId, testUserId, mentions]);
      
      const msgId = result.id || result.lastInsertRowid;
      const message = await dbGet('SELECT * FROM messages WHERE id = ?', [msgId]);
      
      // Parse mentions back
      const parsedMentions = typeof message.mentions === 'string' 
        ? JSON.parse(message.mentions) 
        : message.mentions;
      
      expect(parsedMentions).toHaveLength(2);
      expect(parsedMentions[0].user_id).toBe(1);
      
      // Cleanup
      await dbRun('DELETE FROM messages WHERE id = ?', [msgId]);
    });

    it('should add participant to conversation', async () => {
      const result = await dbRun(`
        INSERT INTO conversation_participants (conversation_id, user_id, role, user_type, unread_count, joined_at)
        VALUES (?, ?, 'owner', 'human', 0, datetime('now'))
      `, [testConversationId, testUserId]);
      
      const participantId = result.id || result.lastInsertRowid;
      expect(participantId).toBeDefined();
      
      // Verify
      const participant = await dbGet(
        'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
        [testConversationId, testUserId]
      );
      expect(participant).toBeDefined();
      expect(participant.role).toBe('owner');
      
      // Cleanup
      await dbRun('DELETE FROM conversation_participants WHERE id = ?', [participantId]);
    });

    it('should find conversation by bound task', async () => {
      // Create conversation bound to task
      const createResult = await dbRun(`
        INSERT INTO conversations (type, title, created_by, bound_table_id, bound_row_id, settings, created_at, updated_at)
        VALUES ('task', 'Task Chat', ?, 15, 123, '{}', datetime('now'), datetime('now'))
      `, [testUserId]);
      
      const convId = createResult.id || createResult.lastInsertRowid;
      
      // Find by task binding
      const found = await dbGet(`
        SELECT * FROM conversations 
        WHERE bound_table_id = ? AND bound_row_id = ?
      `, [15, 123]);
      
      expect(found).toBeDefined();
      expect(found.id).toBe(convId);
      expect(found.type).toBe('task');
      
      // Cleanup
      await dbRun('DELETE FROM conversations WHERE id = ?', [convId]);
    });
  });

  describe('Phase 3: Indexes', () => {
    
    it('should have index on conversations(space_id)', async () => {
      const indexes = await getTableIndexes('conversations');
      const indexNames = indexes.map(i => i.indexname);
      expect(indexNames.some(n => n.includes('space'))).toBe(true);
    });

    it.skip('should have index on conversations(bound) - index removed in PG schema', async () => {
      const indexes = await getTableIndexes('conversations');
      const indexNames = indexes.map(i => i.indexname);
      expect(indexNames.some(n => n.includes('bound'))).toBe(true);
    });

    it('should have index on messages(conversation_id)', async () => {
      const indexes = await getTableIndexes('messages');
      const indexNames = indexes.map(i => i.indexname);
      expect(indexNames.some(n => n.includes('conversation'))).toBe(true);
    });

    it('should have index on messages(sender_id)', async () => {
      const indexes = await getTableIndexes('messages');
      const indexNames = indexes.map(i => i.indexname);
      expect(indexNames.some(n => n.includes('sender'))).toBe(true);
    });

    it('should have index on conversation_participants', async () => {
      const indexes = await getTableIndexes('conversation_participants');
      const indexNames = indexes.map(i => i.indexname);
      expect(indexNames.some(n => n.includes('participant') || n.includes('user') || n.includes('conversation'))).toBe(true);
    });
  });
});
