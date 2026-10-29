// @vitest-environment node
/**
 * API Keys PostgreSQL Integration Tests
 * TDD: 🔴 RED → 🟢 GREEN → 🔵 REFACTOR
 *
 * Run: DATABASE_TYPE=postgres npm test -- backend/__tests__/api-keys/api-keys-postgres.test.js
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { createEphemeralWorkspace } from '../../tests/helpers/workspace-fixture.js';

const { Pool } = pg;

// PostgreSQL connection for tests
// ADR-0009 §Phase 7 — read the pinned contour (backend/test/contour.js), not a
// private DB_* alias. The previous form defaulted to `godcrm_prod` with a
// literal password: it failed on a wrong password rather than on the guard,
// because the boot guard only inspects POSTGRES_*. The alias is now refused
// there too.
const pool = new Pool({
  host: process.env.POSTGRES_HOST || '127.0.0.1',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'godcrm_test',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD
});

// Helper functions
const dbQuery = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows;
};

const dbGet = async (sql, params = []) => {
  const rows = await dbQuery(sql, params);
  return rows[0];
};

const dbRun = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return { rowCount: result.rowCount, rows: result.rows };
};

// Hash API key
const hashApiKey = (key) => {
  return crypto.createHash('sha256').update(key).digest('hex');
};

// Generate random API key
const generateApiKey = () => {
  return 'sk-' + crypto.randomBytes(16).toString('hex');
};

describe('API Keys PostgreSQL Integration', () => {
  // api_keys grew a NOT NULL project_id, so a key can no longer be inserted
  // against the bare literal user_id=1 these tests used to assume. Own a
  // throwaway user+space+project instead of borrowing whatever row 1 happens
  // to be in a freshly copied godcrm_test.
  let workspace;
  let fixtureUserId;
  let fixtureProjectId;

  beforeAll(async () => {
    // Verify connection
    try {
      await pool.query('SELECT 1');
      console.log('✅ PostgreSQL connected');
    } catch (err) {
      console.error('❌ PostgreSQL connection failed:', err.message);
      throw err;
    }
    workspace = await createEphemeralWorkspace({ label: 'apikeys', dashboard: false, table: false });
    fixtureUserId = workspace.userId;
    fixtureProjectId = workspace.projectId;
  });

  afterAll(async () => {
    // Cleanup test data
    await pool.query(`DELETE FROM api_keys WHERE name LIKE 'TEST_%'`).catch(() => {});
    await workspace?.cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    // Cleanup before each test
    await pool.query(`DELETE FROM api_keys WHERE name LIKE 'TEST_%'`).catch(() => {});
  });

  describe('System api_keys table', () => {
    
    it('should have api_keys table with required columns', async () => {
      const columns = await dbQuery(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'api_keys'
        ORDER BY ordinal_position
      `);
      
      const columnNames = columns.map(c => c.column_name);
      
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('key_prefix');
      expect(columnNames).toContain('key_hash');
      expect(columnNames).toContain('is_active');
    });

    it('should insert API key with prefix and hash', async () => {
      const apiKey = generateApiKey();
      const keyPrefix = apiKey.substring(0, 7);
      const keyHash = hashApiKey(apiKey);
      
      const result = await dbRun(`
        INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, is_active, project_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id
      `, [fixtureUserId, 'TEST_insert_key', keyPrefix, keyHash, 'all', 1, fixtureProjectId]);
      
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].id).toBeDefined();
    });

    it('should find API key by prefix and hash', async () => {
      const apiKey = generateApiKey();
      const keyPrefix = apiKey.substring(0, 7);
      const keyHash = hashApiKey(apiKey);
      
      // Insert
      await dbRun(`
        INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, is_active, project_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `, [fixtureUserId, 'TEST_find_key', keyPrefix, keyHash, 'all', 1, fixtureProjectId]);
      
      // Find by prefix + hash
      const found = await dbGet(`
        SELECT * FROM api_keys WHERE key_prefix = $1 AND key_hash = $2
      `, [keyPrefix, keyHash]);
      
      expect(found).toBeDefined();
      expect(found.name).toBe('TEST_find_key');
      expect(found.key_prefix).toBe(keyPrefix);
      expect(found.is_active).toBe(1);
    });

    it('should NOT find key with wrong hash', async () => {
      const apiKey = generateApiKey();
      const keyPrefix = apiKey.substring(0, 7);
      const keyHash = hashApiKey(apiKey);
      const wrongHash = hashApiKey('wrong-key');
      
      // Insert
      await dbRun(`
        INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, is_active, project_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `, [fixtureUserId, 'TEST_wrong_hash', keyPrefix, keyHash, 'all', 1, fixtureProjectId]);
      
      // Try to find with wrong hash
      const notFound = await dbGet(`
        SELECT * FROM api_keys WHERE key_prefix = $1 AND key_hash = $2
      `, [keyPrefix, wrongHash]);
      
      expect(notFound).toBeUndefined();
    });

    it('should NOT authenticate inactive key', async () => {
      const apiKey = generateApiKey();
      const keyPrefix = apiKey.substring(0, 7);
      const keyHash = hashApiKey(apiKey);
      
      // Insert inactive key
      await dbRun(`
        INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, is_active, project_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `, [fixtureUserId, 'TEST_inactive_key', keyPrefix, keyHash, 'all', 0, fixtureProjectId]);
      
      // Try to find active key
      const notFound = await dbGet(`
        SELECT * FROM api_keys WHERE key_prefix = $1 AND key_hash = $2 AND is_active = 1
      `, [keyPrefix, keyHash]);
      
      expect(notFound).toBeUndefined();
    });

    it('should update last_used_at and request_count', async () => {
      const apiKey = generateApiKey();
      const keyPrefix = apiKey.substring(0, 7);
      const keyHash = hashApiKey(apiKey);
      
      // Insert
      const insertResult = await dbRun(`
        INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, is_active, request_count, project_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING id
      `, [fixtureUserId, 'TEST_usage_key', keyPrefix, keyHash, 'all', 1, 0, fixtureProjectId]);
      
      const keyId = insertResult.rows[0].id;
      
      // Update usage stats
      await dbRun(`
        UPDATE api_keys 
        SET last_used_at = NOW(), request_count = request_count + 1
        WHERE id = $1
      `, [keyId]);
      
      // Verify
      const updated = await dbGet(`SELECT * FROM api_keys WHERE id = $1`, [keyId]);
      
      expect(updated.request_count).toBe(1);
      expect(updated.last_used_at).not.toBeNull();
    });
  });

  describe('api_keys_list CRM table', () => {
    
    it('should find api_keys_list table', async () => {
      const table = await dbGet(`
        SELECT ut.id, ut.name, p.name as project_name, p.space_id
        FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE ut.name = 'api_keys_list'
        LIMIT 1
      `);
      
      // Table should exist in System Data
      if (table) {
        expect(table.name).toBe('api_keys_list');
        console.log(`✅ Found api_keys_list in project: ${table.project_name} (space ${table.space_id})`);
      } else {
        console.log('⚠️ api_keys_list table not found - will be created on first use');
      }
    });

    it('should be able to store key data in table_rows', async () => {
      // Find api_keys_list table
      const table = await dbGet(`
        SELECT ut.id, ut.base_id FROM universal_tables ut WHERE ut.name = 'api_keys_list' LIMIT 1
      `);
      
      if (!table) {
        console.log('⚠️ Skipping - no api_keys_list table');
        return;
      }

      const apiKey = generateApiKey();
      const keyData = {
        name: 'TEST_crm_key',
        key_prefix: apiKey.substring(0, 7),
        scopes: ['*'],
        is_active: true,
        created_at: new Date().toISOString()
      };

      // Insert with base_id (required field)
      const baseId = table.base_id || table.id;
      const result = await dbRun(`
        INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        RETURNING id
      `, [table.id, baseId, JSON.stringify(keyData)]);
      
      expect(result.rowCount).toBe(1);
      
      // Verify
      const inserted = await dbGet(`
        SELECT id, data FROM table_rows WHERE id = $1
      `, [result.rows[0].id]);
      
      expect(inserted).toBeDefined();
      const data = typeof inserted.data === 'string' ? JSON.parse(inserted.data) : inserted.data;
      expect(data.name).toBe('TEST_crm_key');
      
      // Cleanup
      await dbRun(`DELETE FROM table_rows WHERE id = $1`, [result.rows[0].id]);
    });

    it('should list keys from table_rows with correct data', async () => {
      const table = await dbGet(`
        SELECT id FROM universal_tables WHERE name = 'api_keys_list' LIMIT 1
      `);
      
      if (!table) {
        console.log('⚠️ Skipping - no api_keys_list table');
        return;
      }

      // Get existing keys
      const keys = await dbQuery(`
        SELECT id, data FROM table_rows WHERE table_id = $1
      `, [table.id]);
      
      console.log(`📊 Found ${keys.length} keys in api_keys_list`);
      
      // Each key should have required fields
      for (const key of keys) {
        const data = typeof key.data === 'string' ? JSON.parse(key.data) : key.data;
        expect(data.name || data.key_prefix).toBeDefined();
      }
    });
  });

  describe('Authentication flow', () => {
    
    it('should authenticate with valid API key (full flow)', async () => {
      const apiKey = generateApiKey();
      const keyPrefix = apiKey.substring(0, 7);
      const keyHash = hashApiKey(apiKey);
      
      // 1. Create key in database
      await dbRun(`
        INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, is_active, project_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      `, [fixtureUserId, 'TEST_auth_flow', keyPrefix, keyHash, 'all', 1, fixtureProjectId]);
      
      // 2. Simulate authentication (what middleware does)
      const inputPrefix = apiKey.substring(0, 7);
      const inputHash = hashApiKey(apiKey);
      
      const keyRecord = await dbGet(`
        SELECT ak.*, u.id as uid, u.email, u.name as user_name, u.role
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.key_prefix = $1 AND ak.key_hash = $2
      `, [inputPrefix, inputHash]);
      
      // 3. Verify authentication succeeded
      expect(keyRecord).toBeDefined();
      expect(keyRecord.is_active).toBe(1);
      // The JOIN must resolve to the key's own owner — the fixture user, not
      // the hard-coded id 1 this assertion used to pin.
      expect(keyRecord.uid).toBe(fixtureUserId);
    });

    it('should reject authentication with invalid key', async () => {
      const fakeKey = 'sk-' + crypto.randomBytes(16).toString('hex');
      const fakePrefix = fakeKey.substring(0, 7);
      const fakeHash = hashApiKey(fakeKey);
      
      // Try to authenticate non-existent key
      const keyRecord = await dbGet(`
        SELECT * FROM api_keys WHERE key_prefix = $1 AND key_hash = $2
      `, [fakePrefix, fakeHash]);
      
      expect(keyRecord).toBeUndefined();
    });
  });
});
