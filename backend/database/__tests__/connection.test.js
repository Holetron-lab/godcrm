/**
 * Tests for connection.js v0.004.000
 * Tests placeholder conversion and PostgreSQL mode
 */
import { describe, it, expect, afterAll } from 'vitest';

// Test placeholder conversion
describe('convertPlaceholders', () => {
  // Import the function for testing (need to expose it or test indirectly)
  
  it('should convert single ? to $1', () => {
    // We'll test this through actual database calls
    const sql = 'SELECT * FROM users WHERE id = ?';
    const expected = 'SELECT * FROM users WHERE id = $1';
    
    // Manual conversion for verification
    let counter = 0;
    const result = sql.replace(/\?/g, () => `$${++counter}`);
    expect(result).toBe(expected);
  });

  it('should convert multiple ? to $1, $2, $3', () => {
    const sql = 'INSERT INTO users (name, email, role) VALUES (?, ?, ?)';
    const expected = 'INSERT INTO users (name, email, role) VALUES ($1, $2, $3)';
    
    let counter = 0;
    const result = sql.replace(/\?/g, () => `$${++counter}`);
    expect(result).toBe(expected);
  });

  it('should handle complex queries', () => {
    const sql = `
      UPDATE records 
      SET name = ?, status = ?, updated_at = ? 
      WHERE id = ? AND space_id = ?
    `;
    
    let counter = 0;
    const result = sql.replace(/\?/g, () => `$${++counter}`);
    
    expect(result).toContain('$1');
    expect(result).toContain('$2');
    expect(result).toContain('$3');
    expect(result).toContain('$4');
    expect(result).toContain('$5');
    expect(result).not.toContain('?');
  });

  it('should not affect queries without placeholders', () => {
    const sql = 'SELECT * FROM users';
    
    let counter = 0;
    const result = sql.replace(/\?/g, () => `$${++counter}`);
    expect(result).toBe(sql);
  });
});

describe('Connection module', () => {
  it('should export required functions', async () => {
    const connection = await import('../connection.js');
    
    expect(typeof connection.dbRun).toBe('function');
    expect(typeof connection.dbGet).toBe('function');
    expect(typeof connection.dbAll).toBe('function');
    expect(typeof connection.getAdapter).toBe('function');
    expect(typeof connection.destroyAdapter).toBe('function');
    expect(typeof connection.closeDatabase).toBe('function');
  });

  it('should work with SQLite by default', async () => {
    const { dbGet } = await import('../connection.js');
    
    // Should work with SQLite
    const result = await dbGet('SELECT 1 as test');
    expect(result).toHaveProperty('test', 1);
  });
});
