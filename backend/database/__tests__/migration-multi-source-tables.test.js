// Test for Multi-Source Tables Schema (PostgreSQL)
// Verifies tables: user_settings, data_sources, sync_logs exist with correct columns
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { dbGet, dbAll, destroyAdapter, resetAdapter } from '../connection.js';

// Set test mode
process.env.TEST_MODE = 'true';
process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-32-characters!!';

describe('Migration: Multi-Source Tables Schema (PostgreSQL)', () => {

  beforeEach(async () => {
    await resetAdapter();
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  describe('Table: user_settings', () => {
    test('should have user_settings table', async () => {
      const table = await dbGet(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'user_settings'
      `);
      expect(table).not.toBeNull();
      expect(table.tablename).toBe('user_settings');
    });

    test('should have correct columns', async () => {
      const columns = await dbAll(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user_settings'
      `);
      const columnNames = columns.map(col => col.column_name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('user_id');
      expect(columnNames).toContain('setting_key');
      expect(columnNames).toContain('setting_value_encrypted');
      expect(columnNames).toContain('setting_type');
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('last_used_at');
    });
  });

  describe('Table: data_sources', () => {
    test('should have data_sources table', async () => {
      const table = await dbGet(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'data_sources'
      `);
      expect(table).not.toBeNull();
      expect(table.tablename).toBe('data_sources');
    });

    test('should have correct columns', async () => {
      const columns = await dbAll(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'data_sources'
      `);
      const columnNames = columns.map(col => col.column_name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('workspace_id');
      expect(columnNames).toContain('created_by');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('type');
      expect(columnNames).toContain('ssh_host');
      expect(columnNames).toContain('ssh_port');
      expect(columnNames).toContain('ssh_username');
      expect(columnNames).toContain('ssh_key_name');
      expect(columnNames).toContain('db_host');
      expect(columnNames).toContain('db_port');
      expect(columnNames).toContain('db_name');
      expect(columnNames).toContain('db_username');
      expect(columnNames).toContain('db_password_key');
      expect(columnNames).toContain('sync_enabled');
      expect(columnNames).toContain('sync_interval_minutes');
    });
  });

  describe('Table: sync_logs', () => {
    test('should have sync_logs table', async () => {
      const table = await dbGet(`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'sync_logs'
      `);
      expect(table).not.toBeNull();
      expect(table.tablename).toBe('sync_logs');
    });

    test('should have correct columns', async () => {
      const columns = await dbAll(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'sync_logs'
      `);
      const columnNames = columns.map(col => col.column_name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('data_source_id');
      expect(columnNames).toContain('table_id');
      expect(columnNames).toContain('status');
      expect(columnNames).toContain('new_records');
      expect(columnNames).toContain('updated_records');
      expect(columnNames).toContain('archived_records');
      expect(columnNames).toContain('total_active_records');
      expect(columnNames).toContain('error_message');
      expect(columnNames).toContain('duration_ms');
      expect(columnNames).toContain('synced_at');
    });
  });
});
