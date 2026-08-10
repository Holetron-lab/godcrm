// backend/database/__tests__/transaction.test.js
// SEC-010: Transaction Wrapper Tests - ADR-015
import { describe, it, expect, beforeEach } from 'vitest';
import { withTransaction, dbRun, dbGet, dbAll, resetDatabase, getDb } from '../connection.js';

describe.skip('Transaction Support', () => {
  beforeEach(() => {
    resetDatabase();
  });

  describe.skip('withTransaction', () => {
    it('should commit on success', () => {
      const uniqueEmail = `tx-${Date.now()}@test.com`;
      const result = withTransaction((db) => {
        const stmt = db.prepare(`
          INSERT INTO users (email, password_hash, name, encryption_key_encrypted) 
          VALUES (?, ?, ?, ?)
        `);
        return stmt.run(uniqueEmail, 'hash123', 'TX User', 'enc_key');
      });
      
      expect(result.changes).toBe(1);
      
      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(uniqueEmail);
      expect(user).toBeDefined();
      expect(user.name).toBe('TX User');
    });

    it('should rollback on error', () => {
      try {
        withTransaction((db) => {
          const stmt = db.prepare(`
            INSERT INTO users (email, password_hash, name, encryption_key_encrypted) 
            VALUES (?, ?, ?, ?)
          `);
          stmt.run('rollback@test.com', 'hash123', 'Rollback User', 'enc_key');
          throw new Error('Intentional rollback');
        });
      } catch (e) {
        expect(e.message).toBe('Intentional rollback');
      }
      
      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get('rollback@test.com');
      expect(user).toBeUndefined();
    });

    it('should handle nested operations atomically', () => {
      const result = withTransaction((db) => {
        // Create space
        const spaceStmt = db.prepare(`
          INSERT INTO spaces (name, type, owner_id) 
          VALUES (?, ?, ?)
        `);
        const spaceResult = spaceStmt.run('Test Space', 'business', 1);
        const spaceId = spaceResult.lastInsertRowid;
        
        // Create project in space
        const projectStmt = db.prepare(`
          INSERT INTO projects (name, type, space_id, owner_id) 
          VALUES (?, ?, ?, ?)
        `);
        const projectResult = projectStmt.run('Test Project', 'table', spaceId, 1);
        
        return { spaceId, projectId: projectResult.lastInsertRowid };
      });
      
      expect(result.spaceId).toBeGreaterThan(0);
      expect(result.projectId).toBeGreaterThan(0);
      
      // Verify both exist
      const db = getDb();
      const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(result.spaceId);
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.projectId);
      
      expect(space).toBeDefined();
      expect(project).toBeDefined();
      expect(project.space_id).toBe(Number(result.spaceId));
    });

    it('should rollback all nested operations on error', () => {
      let spaceId;
      
      try {
        withTransaction((db) => {
          // Create space
          const spaceStmt = db.prepare(`
            INSERT INTO spaces (name, type, owner_id) 
            VALUES (?, ?, ?)
          `);
          const spaceResult = spaceStmt.run('Partial Space', 'business', 1);
          spaceId = spaceResult.lastInsertRowid;
          
          // Create project - this succeeds
          const projectStmt = db.prepare(`
            INSERT INTO projects (name, type, space_id, owner_id) 
            VALUES (?, ?, ?, ?)
          `);
          projectStmt.run('Partial Project', 'table', spaceId, 1);
          
          // This throws - should rollback everything
          throw new Error('Rollback nested');
        });
      } catch (e) {
        expect(e.message).toBe('Rollback nested');
      }
      
      // Verify both were rolled back
      const db = getDb();
      const space = db.prepare('SELECT * FROM spaces WHERE name = ?').get('Partial Space');
      const project = db.prepare('SELECT * FROM projects WHERE name = ?').get('Partial Project');
      
      expect(space).toBeUndefined();
      expect(project).toBeUndefined();
    });

    it('should return value from callback', () => {
      const result = withTransaction((db) => {
        return { success: true, value: 42 };
      });
      
      expect(result).toEqual({ success: true, value: 42 });
    });
  });

  describe.skip('withTransactionAsync', () => {
    it('should work with async wrapper', async () => {
      const { withTransactionAsync } = await import('../connection.js');
      
      const result = await withTransactionAsync((db) => {
        const stmt = db.prepare(`
          INSERT INTO spaces (name, type, owner_id) 
          VALUES (?, ?, ?)
        `);
        return stmt.run('Async Space', 'personal', 1);
      });
      
      expect(result.changes).toBe(1);
    });
  });
});
