// backend/database/migrations/knex/__tests__/migrations.test.js
// TDD: Tests for Knex migrations
// SKIP: These tests require isolated database for migration testing
// They conflict with the shared test database
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import knex from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import knexfile directly
const knexConfig = (await import(path.join(__dirname, '../../..', 'knexfile.js'))).default;

describe.skip('Knex Migrations', () => {
  let db;

  beforeAll(async () => {
    db = knex(knexConfig.getConfig('test'));
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('migration execution', () => {
    it('should run all migrations successfully', async () => {
      // Rollback all first (in case of previous failed runs)
      await db.migrate.rollback(undefined, true);
      
      // Run migrations
      const [batchNo, log] = await db.migrate.latest();
      
      expect(batchNo).toBeGreaterThan(0);
      expect(log.length).toBeGreaterThan(0);
    });

    it('should create users table', async () => {
      const hasTable = await db.schema.hasTable('users');
      expect(hasTable).toBe(true);
    });

    it('should create spaces table', async () => {
      const hasTable = await db.schema.hasTable('spaces');
      expect(hasTable).toBe(true);
    });

    it('should create projects table', async () => {
      const hasTable = await db.schema.hasTable('projects');
      expect(hasTable).toBe(true);
    });

    it('should create dashboards table', async () => {
      const hasTable = await db.schema.hasTable('dashboards');
      expect(hasTable).toBe(true);
    });

    it('should create universal_tables table', async () => {
      const hasTable = await db.schema.hasTable('universal_tables');
      expect(hasTable).toBe(true);
    });

    it('should create table_columns table', async () => {
      const hasTable = await db.schema.hasTable('table_columns');
      expect(hasTable).toBe(true);
    });

    it('should create table_rows table', async () => {
      const hasTable = await db.schema.hasTable('table_rows');
      expect(hasTable).toBe(true);
    });

    it('should create widgets table', async () => {
      const hasTable = await db.schema.hasTable('widgets');
      expect(hasTable).toBe(true);
    });

    it('should create chat system tables', async () => {
      const hasChatThreads = await db.schema.hasTable('chat_threads');
      const hasChatParticipants = await db.schema.hasTable('chat_participants');
      const hasChatMessages = await db.schema.hasTable('chat_messages');
      
      expect(hasChatThreads).toBe(true);
      expect(hasChatParticipants).toBe(true);
      expect(hasChatMessages).toBe(true);
    });

    it('should create system tables', async () => {
      const hasAuditLog = await db.schema.hasTable('audit_log');
      const hasSystemSettings = await db.schema.hasTable('system_settings');
      const hasApiKeys = await db.schema.hasTable('api_keys');
      const hasSchemaLayouts = await db.schema.hasTable('schema_layouts');
      
      expect(hasAuditLog).toBe(true);
      expect(hasSystemSettings).toBe(true);
      expect(hasApiKeys).toBe(true);
      expect(hasSchemaLayouts).toBe(true);
    });

    it('should create webhooks tables', async () => {
      const hasWebhooks = await db.schema.hasTable('webhooks');
      const hasWebhookLogs = await db.schema.hasTable('webhook_logs');
      
      expect(hasWebhooks).toBe(true);
      expect(hasWebhookLogs).toBe(true);
    });

    it('should create files and folders tables', async () => {
      const hasFolders = await db.schema.hasTable('folders');
      const hasFiles = await db.schema.hasTable('files');
      
      expect(hasFolders).toBe(true);
      expect(hasFiles).toBe(true);
    });

    it('should create data sources tables', async () => {
      const hasUserSettings = await db.schema.hasTable('user_settings');
      const hasDataSources = await db.schema.hasTable('data_sources');
      const hasSyncLogs = await db.schema.hasTable('sync_logs');
      
      expect(hasUserSettings).toBe(true);
      expect(hasDataSources).toBe(true);
      expect(hasSyncLogs).toBe(true);
    });
  });

  describe('CRUD operations', () => {
    it('should insert and query user', async () => {
      const [id] = await db('users').insert({
        email: 'test@example.com',
        password_hash: 'hash123',
        name: 'Test User',
        encryption_key_encrypted: 'enc_key'
      });
      
      const user = await db('users').where({ id }).first();
      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Test User');
    });

    it('should respect foreign key constraints', async () => {
      // Try to insert space with non-existent owner
      await expect(
        db('spaces').insert({
          name: 'Test Space',
          type: 'business',
          owner_id: 99999
        })
      ).rejects.toThrow();
    });
  });

  describe('rollback', () => {
    it('should rollback all migrations', async () => {
      await db.migrate.rollback(undefined, true);
      
      const hasUsers = await db.schema.hasTable('users');
      expect(hasUsers).toBe(false);
    });
  });
});
