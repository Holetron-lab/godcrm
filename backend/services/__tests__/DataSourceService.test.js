// 🔴 RED Phase: Tests for DataSourceService
// Test-Driven Development: Write tests FIRST
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, cleanupTestDatabase } from '../../tests/helpers/test-db.js';
import DataSourceService from '../DataSourceService.js';

// Set test mode
process.env.TEST_MODE = 'true';
process.env.SKIP_DEV_USER = 'true';
process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-32-characters!!';

describe.skip('DataSourceService', () => {
  let service;
  let testWorkspaceId;
  let testUserId;

  beforeEach(async () => {
    await setupTestDatabase();
    service = new DataSourceService();
    
    // Create test workspace and user
    const { dbRun, getDb } = await import('../../database/connection.js');
    const db = getDb();
    
    // Run migration to create data_sources table
    const { runMigration } = await import('../../database/migrations/001-multi-source-tables.js');
    await runMigration(db);
    
    // Create user with unique email (to avoid conflicts between tests)
    const uniqueEmail = `test_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`;
    const userResult = await dbRun(
      'INSERT INTO users (email, password_hash, name, encryption_key_encrypted) VALUES (?, ?, ?, ?)',
      [uniqueEmail, 'hash', 'Test User', 'encrypted_key']
    );
    testUserId = userResult.lastInsertRowid;
    
    // Create workspace (need spaces table first)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS spaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'business'
      )
    `);
    
    const spaceResult = await dbRun(
      'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
      [testUserId, 'Test Space', 'business']
    );
    testWorkspaceId = `ws_${spaceResult.lastInsertRowid}`;
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe.skip('create', () => {
    test('should create data source with valid parameters', async () => {
      const params = {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        name: 'Neometal Shop CRM',
        description: 'External MySQL database',
        type: 'ssh+mysql',
        sshHost: '203.0.113.10',
        sshPort: 22,
        sshUsername: 'root',
        sshKeyName: 'ssh_key_neometal',
        dbHost: 'localhost',
        dbPort: 3306,
        dbName: 'shop_crm',
        dbUsername: 'crm_user',
        dbPasswordKey: 'db_password_neometal'
      };

      const dataSource = await service.create(params);

      expect(dataSource).toBeDefined();
      expect(dataSource.id).toMatch(/^ds_[a-zA-Z0-9]+$/);
      expect(dataSource.name).toBe('Neometal Shop CRM');
      expect(dataSource.type).toBe('ssh+mysql');
      expect(dataSource.workspace_id).toBe(testWorkspaceId);
      expect(dataSource.created_by).toBe(testUserId);
    });

    test('should throw error if name is missing', async () => {
      const params = {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        type: 'ssh+mysql'
      };

      await expect(service.create(params)).rejects.toThrow('name is required');
    });

    test('should throw error if type is invalid', async () => {
      const params = {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        name: 'Test DB',
        type: 'invalid_type'
      };

      await expect(service.create(params)).rejects.toThrow('Invalid type');
    });

    test('should throw error if SSH parameters are missing for ssh+ type', async () => {
      const params = {
        workspaceId: testWorkspaceId,
        userId: testUserId,
        name: 'Test DB',
        type: 'ssh+mysql',
        dbHost: 'localhost'
        // Missing SSH parameters
      };

      await expect(service.create(params)).rejects.toThrow('SSH parameters are required');
    });
  });

  describe.skip('get', () => {
    test('should retrieve data source by ID', async () => {
      // Create a data source first
      const created = await service.create({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        name: 'Test DB',
        type: 'direct+mysql',
        dbHost: 'localhost',
        dbPort: 3306,
        dbName: 'testdb',
        dbUsername: 'user',
        dbPasswordKey: 'pwd_key'
      });

      const retrieved = await service.get(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Test DB');
    });

    test('should throw error if data source not found', async () => {
      await expect(service.get('ds_nonexistent')).rejects.toThrow('Data source not found');
    });
  });

  describe.skip('list', () => {
    test('should list all data sources for workspace', async () => {
      // Create multiple data sources
      await service.create({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        name: 'DB 1',
        type: 'direct+mysql',
        dbHost: 'localhost',
        dbPort: 3306,
        dbName: 'db1',
        dbUsername: 'user1',
        dbPasswordKey: 'pwd1'
      });

      await service.create({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        name: 'DB 2',
        type: 'ssh+postgres',
        sshHost: '1.2.3.4',
        sshPort: 22,
        sshUsername: 'root',
        sshKeyName: 'key_2',
        dbHost: 'localhost',
        dbPort: 5432,
        dbName: 'db2',
        dbUsername: 'user2',
        dbPasswordKey: 'pwd2'
      });

      const dataSources = await service.list(testWorkspaceId);

      expect(dataSources.length).toBeGreaterThanOrEqual(2);
      
      // Find our created data sources
      const db1 = dataSources.find(ds => ds.name === 'DB 1');
      const db2 = dataSources.find(ds => ds.name === 'DB 2');
      
      expect(db1).toBeDefined();
      expect(db2).toBeDefined();
      expect(db1.type).toBe('direct+mysql');
      expect(db2.type).toBe('ssh+postgres');
    });

    test('should return empty array if no data sources for non-existent workspace', async () => {
      const dataSources = await service.list('ws_nonexistent_999');
      expect(dataSources).toEqual([]);
    });
  });

  describe.skip('update', () => {
    test('should update data source', async () => {
      const created = await service.create({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        name: 'Original Name',
        type: 'direct+mysql',
        dbHost: 'localhost',
        dbPort: 3306,
        dbName: 'testdb',
        dbUsername: 'user',
        dbPasswordKey: 'pwd_key'
      });

      const updated = await service.update(created.id, {
        name: 'Updated Name',
        description: 'New description'
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('New description');
      expect(updated.type).toBe('direct+mysql'); // unchanged
    });

    test('should throw error if trying to update non-existent data source', async () => {
      await expect(service.update('ds_nonexistent', { name: 'New Name' }))
        .rejects.toThrow('Data source not found');
    });
  });

  describe.skip('delete', () => {
    test('should delete data source', async () => {
      const created = await service.create({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        name: 'To Delete',
        type: 'direct+mysql',
        dbHost: 'localhost',
        dbPort: 3306,
        dbName: 'testdb',
        dbUsername: 'user',
        dbPasswordKey: 'pwd_key'
      });

      await service.delete(created.id);

      await expect(service.get(created.id)).rejects.toThrow('Data source not found');
    });

    test('should throw error if deleting non-existent data source', async () => {
      await expect(service.delete('ds_nonexistent')).rejects.toThrow('Data source not found');
    });
  });

  describe.skip('testConnection', () => {
    test('should test connection and update status', async () => {
      const created = await service.create({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        name: 'Test DB',
        type: 'direct+mysql',
        dbHost: 'localhost',
        dbPort: 3306,
        dbName: 'testdb',
        dbUsername: 'user',
        dbPasswordKey: 'pwd_key'
      });

      // Mock test - in real implementation this would actually connect
      const result = await service.testConnection(created.id);

      expect(result).toBeDefined();
      expect(result.status).toMatch(/^(success|failed)$/);
      expect(result.tested_at).toBeDefined();
      
      if (result.status === 'failed') {
        expect(result.error).toBeDefined();
      }
    });

    test('should throw error if testing non-existent data source', async () => {
      await expect(service.testConnection('ds_nonexistent'))
        .rejects.toThrow('Data source not found');
    });
  });

  describe.skip('validation', () => {
    test('should validate SSH+MySQL configuration', () => {
      const config = {
        type: 'ssh+mysql',
        sshHost: '1.2.3.4',
        sshPort: 22,
        sshUsername: 'root',
        sshKeyName: 'key_1',
        dbHost: 'localhost',
        dbPort: 3306,
        dbName: 'testdb',
        dbUsername: 'user',
        dbPasswordKey: 'pwd_key'
      };

      expect(service.validateConfig(config)).toBe(true);
    });

    test('should validate Direct PostgreSQL configuration', () => {
      const config = {
        type: 'direct+postgres',
        dbHost: '1.2.3.4',
        dbPort: 5432,
        dbName: 'testdb',
        dbUsername: 'user',
        dbPasswordKey: 'pwd_key'
      };

      expect(service.validateConfig(config)).toBe(true);
    });

    test('should fail validation for incomplete SSH config', () => {
      const config = {
        type: 'ssh+mysql',
        sshHost: '1.2.3.4',
        // Missing sshPort, sshUsername, sshKeyName
        dbHost: 'localhost'
      };

      expect(() => service.validateConfig(config)).toThrow();
    });

    test('should fail validation for incomplete DB config', () => {
      const config = {
        type: 'direct+mysql',
        dbHost: 'localhost',
        // Missing dbPort, dbName, dbUsername, dbPasswordKey
      };

      expect(() => service.validateConfig(config)).toThrow();
    });
  });
});
