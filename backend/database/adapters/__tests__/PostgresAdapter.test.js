// backend/database/adapters/__tests__/PostgresAdapter.test.js
// TDD: Tests for PostgresAdapter implementation
// Tests are skipped if PostgreSQL is not available (POSTGRES_URL not set)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgresAdapter } from '../PostgresAdapter.js';
import { DatabaseAdapter } from '../DatabaseAdapter.js';

// Skip tests if PostgreSQL is not available
const PG_AVAILABLE = !!process.env.POSTGRES_URL;

describe('PostgresAdapter', () => {
  describe.skipIf(!PG_AVAILABLE)('with PostgreSQL connection', () => {
    let adapter;

    beforeAll(async () => {
      adapter = new PostgresAdapter({
        connectionString: process.env.POSTGRES_URL
      });
      await adapter.initialize();
      await adapter.query(`
        DROP TABLE IF EXISTS test_pg_users;
        CREATE TABLE test_pg_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        )
      `);
    });

    beforeEach(async () => {
      await adapter.query('TRUNCATE test_pg_users RESTART IDENTITY');
    });

    afterAll(async () => {
      await adapter.query('DROP TABLE IF EXISTS test_pg_users');
      await adapter.close();
    });

    it('should extend DatabaseAdapter', () => {
      expect(adapter).toBeInstanceOf(DatabaseAdapter);
    });

    describe('query()', () => {
      it('should execute raw SQL', async () => {
        const result = await adapter.query('SELECT 1 as num');
        expect(result.rows).toEqual([{ num: 1 }]);
      });

      it('should use parameterized queries with $1 syntax', async () => {
        await adapter.run(
          'INSERT INTO test_pg_users (name, email) VALUES ($1, $2)', 
          ['John', 'john@test.com']
        );
        
        const result = await adapter.query(
          'SELECT * FROM test_pg_users WHERE email = $1', 
          ['john@test.com']
        );
        expect(result.rows[0].name).toBe('John');
      });
    });

    describe('get()', () => {
      it('should return single row', async () => {
        await adapter.run(
          'INSERT INTO test_pg_users (name, email) VALUES ($1, $2)', 
          ['Alice', 'alice@test.com']
        );
        
        const user = await adapter.get(
          'SELECT * FROM test_pg_users WHERE email = $1', 
          ['alice@test.com']
        );
        expect(user.name).toBe('Alice');
      });

      it('should return null for no match', async () => {
        const user = await adapter.get(
          'SELECT * FROM test_pg_users WHERE email = $1', 
          ['nobody@test.com']
        );
        expect(user).toBeNull();
      });
    });

    describe('all()', () => {
      it('should return all rows', async () => {
        await adapter.run('INSERT INTO test_pg_users (name, email) VALUES ($1, $2)', 
          ['User1', 'user1@test.com']);
        await adapter.run('INSERT INTO test_pg_users (name, email) VALUES ($1, $2)', 
          ['User2', 'user2@test.com']);
        
        const users = await adapter.all('SELECT * FROM test_pg_users ORDER BY id');
        expect(users).toHaveLength(2);
      });
    });

    describe('run()', () => {
      it('should return changes and lastInsertRowid for INSERT', async () => {
        const result = await adapter.run(
          'INSERT INTO test_pg_users (name, email) VALUES ($1, $2)',
          ['Bob', 'bob@test.com']
        );
        expect(result.changes).toBe(1);
        expect(result.lastInsertRowid).toBeGreaterThan(0);
      });
    });

    describe('transaction()', () => {
      it('should commit successful transaction', async () => {
        await adapter.transaction(async (trx) => {
          await trx.run('INSERT INTO test_pg_users (name, email) VALUES ($1, $2)', 
            ['Tx1', 'tx1@test.com']);
          await trx.run('INSERT INTO test_pg_users (name, email) VALUES ($1, $2)', 
            ['Tx2', 'tx2@test.com']);
        });

        const users = await adapter.all('SELECT * FROM test_pg_users');
        expect(users).toHaveLength(2);
      });

      it('should rollback on error', async () => {
        await expect(
          adapter.transaction(async (trx) => {
            await trx.run('INSERT INTO test_pg_users (name, email) VALUES ($1, $2)', 
              ['WillRollback', 'rollback@test.com']);
            throw new Error('Intentional error');
          })
        ).rejects.toThrow('Intentional error');

        const users = await adapter.all('SELECT * FROM test_pg_users');
        expect(users).toHaveLength(0);
      });
    });

    describe('ping()', () => {
      it('should return true for healthy connection', async () => {
        const isHealthy = await adapter.ping();
        expect(isHealthy).toBe(true);
      });
    });
  });

  // These tests run without PostgreSQL
  describe('without PostgreSQL connection', () => {
    it('should extend DatabaseAdapter', () => {
      const adapter = new PostgresAdapter({});
      expect(adapter).toBeInstanceOf(DatabaseAdapter);
    });

    it('should have all required methods', () => {
      const adapter = new PostgresAdapter({});
      expect(typeof adapter.query).toBe('function');
      expect(typeof adapter.get).toBe('function');
      expect(typeof adapter.all).toBe('function');
      expect(typeof adapter.run).toBe('function');
      expect(typeof adapter.transaction).toBe('function');
      expect(typeof adapter.ping).toBe('function');
      expect(typeof adapter.close).toBe('function');
      expect(typeof adapter.getKnex).toBe('function');
    });

    it('ping should return false when not initialized', async () => {
      const adapter = new PostgresAdapter({});
      const result = await adapter.ping();
      expect(result).toBe(false);
    });
  });
});
