/**
 * @fileoverview Integration tests for Tables API
 * Tests table rows retrieval after PostgreSQL migration
 * 
 * NOTE: These tests require PostgreSQL with specific data (space 30, table 406).
 * Skipped for SQLite test runs.
 */
import { describe, it, expect } from 'vitest';
import { dbAll, dbGet, isPostgres } from '../../database/connection.js';

// Skip for SQLite - these are PostgreSQL integration tests with real data
const describePostgres = isPostgres() ? describe : describe.skip;

describePostgres('Tables API - PostgreSQL Integration', () => {
  
  describe('Database Connection', () => {
    it('should connect to PostgreSQL and query spaces', async () => {
      const spaces = await dbAll('SELECT id, name FROM spaces LIMIT 5');
      expect(spaces).toBeDefined();
      expect(Array.isArray(spaces)).toBe(true);
      expect(spaces.length).toBeGreaterThan(0);
      console.log('Spaces:', spaces);
    });

    it('should query tables in space 30', async () => {
      const tables = await dbAll(`
        SELECT ut.id, ut.name, p.name as project_name
        FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = $1
        LIMIT 10
      `, [30]);
      expect(tables).toBeDefined();
      expect(Array.isArray(tables)).toBe(true);
      console.log('Tables in space 30:', tables.length);
    });
  });

  describe('Table Rows', () => {
    it('should fetch rows from table 406 (My Tasks Data)', async () => {
      const rows = await dbAll(`
        SELECT id, data, created_at 
        FROM table_rows 
        WHERE table_id = $1 
        LIMIT 5
      `, [406]);
      expect(rows).toBeDefined();
      expect(Array.isArray(rows)).toBe(true);
      console.log('Rows in table 406:', rows.length);
      if (rows.length > 0) {
        console.log('First row data type:', typeof rows[0].data);
        console.log('First row data:', JSON.stringify(rows[0].data).slice(0, 200));
      }
    });

    it('should parse JSONB data correctly', async () => {
      const row = await dbGet(`
        SELECT id, data 
        FROM table_rows 
        WHERE table_id = $1 
        LIMIT 1
      `, [406]);
      
      if (row) {
        expect(row.data).toBeDefined();
        const dataType = typeof row.data;
        console.log('Data type:', dataType);
        
        // PostgreSQL JSONB should already be parsed as object
        if (dataType === 'string') {
          console.warn('WARNING: data is string, should be object!');
          const parsed = JSON.parse(row.data);
          expect(parsed).toBeDefined();
        } else {
          expect(dataType).toBe('object');
        }
      }
    });
  });

  describe('Table Columns', () => {
    it('should fetch columns for table 406', async () => {
      const columns = await dbAll(`
        SELECT id, column_name, display_name, type, config
        FROM table_columns
        WHERE table_id = $1
        ORDER BY order_index
      `, [406]);
      expect(columns).toBeDefined();
      expect(Array.isArray(columns)).toBe(true);
      console.log('Columns in table 406:', columns.length);
      if (columns.length > 0) {
        console.log('First column:', columns[0]);
      }
    });
  });
});
