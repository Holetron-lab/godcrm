/**
 * Connection integration tests with PostgreSQL
 * Tests DATABASE_TYPE=postgres switching
 * 
 * @requires PostgreSQL running on localhost:5432
 * @requires Database 'godcrm' with user 'godcrm'
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getAdapter, destroyAdapter, AdapterFactory } from '../connection.js';

// Skip if no POSTGRES_URL
const POSTGRES_URL = process.env.POSTGRES_URL || 'postgresql://godcrm:godcrm_dev_2026@localhost:5432/godcrm';
const runPostgresTests = process.env.TEST_POSTGRES === 'true';

describe.skipIf(!runPostgresTests)('Connection with PostgreSQL', () => {
  let adapter;

  beforeAll(async () => {
    // Force PostgreSQL type
    process.env.DATABASE_TYPE = 'postgres';
    process.env.POSTGRES_URL = POSTGRES_URL;
  });

  afterAll(async () => {
    await destroyAdapter();
    delete process.env.DATABASE_TYPE;
    delete process.env.POSTGRES_URL;
  });

  beforeEach(async () => {
    // Reset adapter between tests
    await AdapterFactory.destroy();
  });

  describe('getAdapter()', () => {
    it('should return PostgresAdapter when DATABASE_TYPE=postgres', async () => {
      adapter = await getAdapter({ type: 'postgres', url: POSTGRES_URL });
      
      expect(adapter).toBeDefined();
      expect(adapter.constructor.name).toBe('PostgresAdapter');
    });

    it('should connect and query users table', async () => {
      adapter = await getAdapter({ type: 'postgres', url: POSTGRES_URL });
      
      const users = await adapter.all('SELECT id, email FROM users LIMIT 5');
      
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThanOrEqual(0);
    });

    it('should get single user with get()', async () => {
      adapter = await getAdapter({ type: 'postgres', url: POSTGRES_URL });
      
      const user = await adapter.get('SELECT id, email FROM users LIMIT 1');
      
      // May be undefined if no users
      if (user) {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
      }
    });

    it('should return count with get()', async () => {
      adapter = await getAdapter({ type: 'postgres', url: POSTGRES_URL });
      
      const result = await adapter.get('SELECT COUNT(*) as count FROM users');
      
      expect(result).toHaveProperty('count');
      expect(typeof result.count).toBe('string'); // PostgreSQL returns bigint as string
    });
  });

  describe('CRUD operations', () => {
    const testTableName = 'test_crud_ops_' + Date.now();

    beforeEach(async () => {
      adapter = await getAdapter({ type: 'postgres', url: POSTGRES_URL });
      // Create test table
      await adapter.run(`
        CREATE TABLE IF NOT EXISTS ${testTableName} (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255),
          value INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    });

    afterAll(async () => {
      if (adapter) {
        await adapter.run(`DROP TABLE IF EXISTS ${testTableName}`);
      }
    });

    it('should INSERT a row', async () => {
      const result = await adapter.run(
        `INSERT INTO ${testTableName} (name, value) VALUES ($1, $2)`,
        ['test-item', 42]
      );
      
      expect(result.changes).toBe(1);
    });

    it('should SELECT inserted row', async () => {
      await adapter.run(
        `INSERT INTO ${testTableName} (name, value) VALUES ($1, $2)`,
        ['select-test', 100]
      );
      
      const row = await adapter.get(
        `SELECT * FROM ${testTableName} WHERE name = $1`,
        ['select-test']
      );
      
      expect(row).toBeDefined();
      expect(row.name).toBe('select-test');
      expect(row.value).toBe(100);
    });

    it('should UPDATE a row', async () => {
      await adapter.run(
        `INSERT INTO ${testTableName} (name, value) VALUES ($1, $2)`,
        ['update-test', 50]
      );
      
      const updateResult = await adapter.run(
        `UPDATE ${testTableName} SET value = $1 WHERE name = $2`,
        [999, 'update-test']
      );
      
      expect(updateResult.changes).toBe(1);
      
      const row = await adapter.get(
        `SELECT * FROM ${testTableName} WHERE name = $1`,
        ['update-test']
      );
      expect(row.value).toBe(999);
    });

    it('should DELETE a row', async () => {
      await adapter.run(
        `INSERT INTO ${testTableName} (name, value) VALUES ($1, $2)`,
        ['delete-test', 123]
      );
      
      const deleteResult = await adapter.run(
        `DELETE FROM ${testTableName} WHERE name = $1`,
        ['delete-test']
      );
      
      expect(deleteResult.changes).toBe(1);
      
      const row = await adapter.get(
        `SELECT * FROM ${testTableName} WHERE name = $1`,
        ['delete-test']
      );
      expect(row).toBeFalsy(); // null or undefined
    });
  });

  describe('Transactions', () => {
    const txTableName = 'test_transactions_' + Date.now();

    beforeEach(async () => {
      await AdapterFactory.destroy();
      adapter = await getAdapter({ type: 'postgres', url: POSTGRES_URL });
      await adapter.run(`
        CREATE TABLE IF NOT EXISTS ${txTableName} (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255),
          value INTEGER
        )
      `);
    });

    afterAll(async () => {
      if (adapter) {
        await adapter.run(`DROP TABLE IF EXISTS ${txTableName}`);
      }
    });

    it('should commit transaction on success', async () => {
      await adapter.transaction(async (trx) => {
        await trx.run(
          `INSERT INTO ${txTableName} (name, value) VALUES ($1, $2)`,
          ['tx-commit', 1]
        );
        await trx.run(
          `INSERT INTO ${txTableName} (name, value) VALUES ($1, $2)`,
          ['tx-commit', 2]
        );
      });
      
      const rows = await adapter.all(
        `SELECT * FROM ${txTableName} WHERE name = $1`,
        ['tx-commit']
      );
      
      expect(rows.length).toBe(2);
    });

    it('should rollback transaction on error', async () => {
      try {
        await adapter.transaction(async (trx) => {
          await trx.run(
            `INSERT INTO ${txTableName} (name, value) VALUES ($1, $2)`,
            ['tx-rollback', 100]
          );
          throw new Error('Force rollback');
        });
      } catch (e) {
        // Expected
      }
      
      const rows = await adapter.all(
        `SELECT * FROM ${txTableName} WHERE name = $1`,
        ['tx-rollback']
      );
      
      expect(rows.length).toBe(0);
    });
  });

  describe('Query real tables', () => {
    it('should query spaces table', async () => {
      adapter = await getAdapter({ type: 'postgres', url: POSTGRES_URL });
      
      const spaces = await adapter.all('SELECT id, name FROM spaces LIMIT 10');
      
      expect(Array.isArray(spaces)).toBe(true);
    });

    it('should query projects table', async () => {
      adapter = await getAdapter({ type: 'postgres', url: POSTGRES_URL });
      
      const projects = await adapter.all('SELECT id, name FROM projects LIMIT 10');
      
      expect(Array.isArray(projects)).toBe(true);
    });

    it('should join users and projects', async () => {
      adapter = await getAdapter({ type: 'postgres', url: POSTGRES_URL });
      
      const result = await adapter.all(`
        SELECT u.email, p.name as project_name
        FROM users u
        LEFT JOIN projects p ON p.owner_id = u.id
        LIMIT 5
      `);
      
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
