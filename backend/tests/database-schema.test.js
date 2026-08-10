// Test 1.1: Create users table with encryption_key_encrypted
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';
import { dbGet, dbAll, dbRun } from '../database/connection.js';

// Set env vars for tests
process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-32-chars-long!!';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SKIP_DEV_USER = 'true'; // Don't create dev user in tests

// Helper to generate unique email
const uniqueEmail = (prefix = 'test') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@hltrn.cc`;

describe.skip('Database Schema - Users Table', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  test('should create users table with all required columns', async () => {
    // Check if table exists
    const tableInfo = await dbAll(`PRAGMA table_info(users)`);
    
    expect(tableInfo).toBeDefined();
    expect(tableInfo.length).toBeGreaterThan(0);

    // Verify columns
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('email');
    expect(columnNames).toContain('password_hash');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('avatar');
    expect(columnNames).toContain('role');
    expect(columnNames).toContain('encryption_key_encrypted'); // NEW!
    expect(columnNames).toContain('totp_secret');
    expect(columnNames).toContain('totp_enabled');
    expect(columnNames).toContain('email_verification_code');
    expect(columnNames).toContain('email_verified');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  test('should enforce email uniqueness', async () => {
    const testEmail = uniqueEmail('unique');
    await dbRun(`
      INSERT INTO users (email, password_hash, name, encryption_key_encrypted)
      VALUES (?, ?, ?, ?)
    `, [testEmail, 'hash123', 'Test User', 'encrypted_key_123']);

    // Try to insert duplicate email
    await expect(
      dbRun(`
        INSERT INTO users (email, password_hash, name, encryption_key_encrypted)
        VALUES (?, ?, ?, ?)
      `, [testEmail, 'hash456', 'Another User', 'encrypted_key_456'])
    ).rejects.toThrow();
  });

  test('should set default values correctly', async () => {
    const result = await dbRun(`
      INSERT INTO users (email, password_hash, name, encryption_key_encrypted)
      VALUES (?, ?, ?, ?)
    `, [uniqueEmail('default'), 'hash', 'Default User', 'enc_key']);

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);

    expect(user.role).toBe('user');
    expect(user.totp_enabled).toBe(0);
    expect(user.email_verified).toBe(0);
    expect(user.created_at).toBeDefined();
    expect(user.updated_at).toBeDefined();
  });

  test('should require encryption_key_encrypted', async () => {
    // Try to insert without encryption key
    await expect(
      dbRun(`
        INSERT INTO users (email, password_hash, name)
        VALUES (?, ?, ?)
      `, [uniqueEmail('nokey'), 'hash', 'No Key User'])
    ).rejects.toThrow();
  });
});

// Test 1.2: Projects table with 3 theme colors
describe.skip('Database Schema - Projects Table', () => {
  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    await setupTestDatabase();
    // Create a test user first
    await dbRun(`
      INSERT INTO users (email, password_hash, name, encryption_key_encrypted)
      VALUES (?, ?, ?, ?)
    `, [uniqueEmail('owner'), 'hash', 'Owner', 'key123']);
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  test('should create projects table with theme colors', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(projects)`);
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('description');
    expect(columnNames).toContain('icon');
    expect(columnNames).toContain('type');
    expect(columnNames).toContain('owner_id');
    expect(columnNames).toContain('theme_primary');
    expect(columnNames).toContain('theme_secondary');
    expect(columnNames).toContain('theme_tertiary');
    expect(columnNames).toContain('settings');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  test('should set default theme colors', async () => {
    const result = await dbRun(`
      INSERT INTO projects (name, type, owner_id)
      VALUES (?, ?, ?)
    `, ['Test Project', 'custom', 1]);

    const project = await dbGet('SELECT * FROM projects WHERE id = ?', [result.lastInsertRowid]);

    expect(project.theme_primary).toBe('#0ea5e9');
    expect(project.theme_secondary).toBe('#8b5cf6');
    expect(project.theme_tertiary).toBe('#10b981');
  });

  test('should allow custom theme colors', async () => {
    const result = await dbRun(`
      INSERT INTO projects (name, type, owner_id, theme_primary, theme_secondary, theme_tertiary)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['Custom Project', 'custom', 1, '#ff0000', '#00ff00', '#0000ff']);

    const project = await dbGet('SELECT * FROM projects WHERE id = ?', [result.lastInsertRowid]);

    expect(project.theme_primary).toBe('#ff0000');
    expect(project.theme_secondary).toBe('#00ff00');
    expect(project.theme_tertiary).toBe('#0000ff');
  });

  test('should cascade delete when user is deleted', async () => {
    await dbRun(`
      INSERT INTO projects (name, type, owner_id)
      VALUES (?, ?, ?)
    `, ['Project to Delete', 'custom', 1]);

    await dbRun('DELETE FROM users WHERE id = ?', [1]);

    const projects = await dbAll('SELECT * FROM projects');
    expect(projects.length).toBe(0);
  });
});

// Test 1.3: Universal Tables
describe.skip('Database Schema - Universal Tables', () => {
  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    await setupTestDatabase();
    await dbRun(`INSERT INTO users (email, password_hash, name, encryption_key_encrypted) VALUES (?, ?, ?, ?)`, [uniqueEmail('ut'), 'h', 'U', 'k']);
    await dbRun(`INSERT INTO projects (name, type, owner_id) VALUES (?, ?, ?)`, ['P', 'custom', 1]);
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  test('should create universal_tables with sync_target', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(universal_tables)`);
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('sync_target');
    expect(columnNames).toContain('is_system');
  });

  test('should create system table with sync_target', async () => {
    const result = await dbRun(`
      INSERT INTO universal_tables (project_id, name, is_system, sync_target)
      VALUES (?, ?, ?, ?)
    `, [1, 'Users', 1, 'users']);

    const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [result.lastInsertRowid]);
    expect(table.is_system).toBe(1);
    expect(table.sync_target).toBe('users');
  });
});

// Test 1.4: Table Columns
describe.skip('Database Schema - Table Columns', () => {
  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    await setupTestDatabase();
    await dbRun(`INSERT INTO users (email, password_hash, name, encryption_key_encrypted) VALUES (?, ?, ?, ?)`, [uniqueEmail('tc'), 'h', 'U', 'k']);
    await dbRun(`INSERT INTO projects (name, type, owner_id) VALUES (?, ?, ?)`, ['P', 'custom', 1]);
    await dbRun(`INSERT INTO universal_tables (project_id, name) VALUES (?, ?)`, [1, 'TestTable']);
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  test('should create table_columns with all fields', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(table_columns)`);
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('column_name');
    expect(columnNames).toContain('display_name');
    expect(columnNames).toContain('type');
    expect(columnNames).toContain('config');
    expect(columnNames).toContain('is_system');
  });

  test('should store column configuration as JSON', async () => {
    const config = JSON.stringify({ max_length: 255, multiline: false });
    const result = await dbRun(`
      INSERT INTO table_columns (table_id, column_name, display_name, type, config)
      VALUES (?, ?, ?, ?, ?)
    `, [1, 'description', 'Description', 'text', config]);

    const column = await dbGet('SELECT * FROM table_columns WHERE id = ?', [result.lastInsertRowid]);
    expect(column.config).toBe(config);
  });
});

// Test 1.5: Table Rows with base_id
describe.skip('Database Schema - Table Rows', () => {
  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    await setupTestDatabase();
    await dbRun(`INSERT INTO users (email, password_hash, name, encryption_key_encrypted) VALUES (?, ?, ?, ?)`, [uniqueEmail('tr'), 'h', 'U', 'k']);
    await dbRun(`INSERT INTO projects (name, type, owner_id) VALUES (?, ?, ?)`, ['P', 'custom', 1]);
    await dbRun(`INSERT INTO universal_tables (project_id, name) VALUES (?, ?)`, [1, 'T']);
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  test('should create table_rows with base_id', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(table_rows)`);
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('base_id');
    expect(columnNames).toContain('data');
  });

  test('should enforce unique base_id', async () => {
    const baseId = 'proj_1_tbl_1_row_1_aBcD123456';
    await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data)
      VALUES (?, ?, ?)
    `, [1, baseId, '{}']);

    await expect(
      dbRun(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `, [1, baseId, '{}'])
    ).rejects.toThrow();
  });
});

// Test 1.6-1.8: Chat System
describe.skip('Database Schema - Chat System', () => {
  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  test('should create chat_threads table', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(chat_threads)`);
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('thread_id');
    expect(columnNames).toContain('type');
    expect(columnNames).toContain('encrypted_with_keys');
  });

  test('should create chat_participants table', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(chat_participants)`);
    expect(tableInfo.length).toBeGreaterThan(0);
  });

  test('should create chat_messages with encryption', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(chat_messages)`);
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('content_encrypted');
    expect(columnNames).toContain('encryption_method');
  });
});

// Test 1.9-1.11: Audit, Settings, Widgets
describe.skip('Database Schema - System Tables', () => {
  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  test('should create audit_log table', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(audit_log)`);
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('action');
    expect(columnNames).toContain('entity_type');
    expect(columnNames).toContain('entity_id');
  });

  test('should create system_settings table', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(system_settings)`);
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('key');
    expect(columnNames).toContain('value');
    expect(columnNames).toContain('type');
  });

  test('should create dashboard_widgets table', async () => {
    const tableInfo = await dbAll(`PRAGMA table_info(dashboard_widgets)`);
    const columnNames = tableInfo.map(col => col.name);
    
    expect(columnNames).toContain('type');
    expect(columnNames).toContain('config');
    expect(columnNames).toContain('position');
  });
});
