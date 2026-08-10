// backend/utils/__tests__/sqlSanitizer.test.js
// SEC-001: SQL Sanitizer Tests - ADR-015
import { describe, it, expect } from 'vitest';
import { 
  validateTableName, 
  escapeIdentifier,
  buildWhereClause,
  buildInClause,
  ALLOWED_TABLES
} from '../sqlSanitizer.js';

describe('SQL Sanitizer', () => {
  describe('validateTableName', () => {
    it('should accept valid table names', () => {
      const validTables = [
        'users',
        'spaces',
        'projects',
        'dashboards',
        'universal_tables',
        'table_columns',
        'table_rows',
        'widgets',
        'api_keys',
        'webhooks',
        'webhook_logs',
        'files',
        'folders',
        'chat_threads',
        'chat_participants',
        'chat_messages',
        'audit_log',
        'system_settings',
        'user_settings',
        'data_sources',
        'sync_logs',
        'schema_layouts',
        'monitoring_runs',
        'monitoring_events'
      ];
      
      for (const table of validTables) {
        expect(() => validateTableName(table)).not.toThrow();
        expect(validateTableName(table)).toBe(table);
      }
    });

    it('should reject invalid table names', () => {
      const invalidTables = [
        'nonexistent_table',
        'users; DROP TABLE users;--',
        "users' OR '1'='1",
        'users UNION SELECT * FROM passwords',
        '../../../etc/passwd',
        '',
        null,
        undefined,
        123,
        'SELECT * FROM users',
        'users--',
        'users/*',
        'table"name'
      ];
      
      for (const table of invalidTables) {
        expect(() => validateTableName(table)).toThrow(/Invalid table name/);
      }
    });
  });

  describe('escapeIdentifier', () => {
    it('should escape valid column/table names', () => {
      expect(escapeIdentifier('column_name')).toBe('"column_name"');
      expect(escapeIdentifier('TableName')).toBe('"TableName"');
      expect(escapeIdentifier('_private')).toBe('"_private"');
      expect(escapeIdentifier('column123')).toBe('"column123"');
    });

    it('should escape double quotes in identifiers', () => {
      expect(escapeIdentifier('col"name')).toBe('"col""name"');
      expect(escapeIdentifier('a"b"c')).toBe('"a""b""c"');
    });

    it('should reject dangerous identifiers', () => {
      expect(() => escapeIdentifier('col; DROP TABLE')).toThrow();
      expect(() => escapeIdentifier("col' OR '1'='1")).toThrow();
      expect(() => escapeIdentifier('col--comment')).toThrow();
      expect(() => escapeIdentifier('123start')).toThrow();
      expect(() => escapeIdentifier('')).toThrow();
      expect(() => escapeIdentifier(null)).toThrow();
      expect(() => escapeIdentifier(undefined)).toThrow();
      expect(() => escapeIdentifier('col/*comment*/')).toThrow();
    });
  });

  describe('buildWhereClause', () => {
    it('should build parameterized WHERE clause', () => {
      const filters = { status: 'active', type: 'user' };
      const { clause, params } = buildWhereClause(filters, ['status', 'type']);
      
      expect(clause).toBe('WHERE "status" = ? AND "type" = ?');
      expect(params).toEqual(['active', 'user']);
    });

    it('should handle empty filters', () => {
      const { clause, params } = buildWhereClause({}, ['status']);
      
      expect(clause).toBe('');
      expect(params).toEqual([]);
    });

    it('should ignore non-whitelisted fields', () => {
      const filters = { status: 'active', injected: 'DROP TABLE users' };
      const { clause, params } = buildWhereClause(filters, ['status']);
      
      expect(clause).toBe('WHERE "status" = ?');
      expect(params).toEqual(['active']);
      expect(params).not.toContain('DROP TABLE users');
    });

    it('should handle null and undefined values', () => {
      const filters = { status: 'active', type: null, name: undefined };
      const { clause, params } = buildWhereClause(filters, ['status', 'type', 'name']);
      
      expect(clause).toBe('WHERE "status" = ?');
      expect(params).toEqual(['active']);
    });

    it('should handle null/undefined filters object', () => {
      expect(buildWhereClause(null, ['status'])).toEqual({ clause: '', params: [] });
      expect(buildWhereClause(undefined, ['status'])).toEqual({ clause: '', params: [] });
    });
  });

  describe('buildInClause', () => {
    it('should build IN clause with placeholders', () => {
      const { clause, params } = buildInClause('id', [1, 2, 3]);
      
      expect(clause).toBe('"id" IN (?, ?, ?)');
      expect(params).toEqual([1, 2, 3]);
    });

    it('should handle single value', () => {
      const { clause, params } = buildInClause('status', ['active']);
      
      expect(clause).toBe('"status" IN (?)');
      expect(params).toEqual(['active']);
    });

    it('should reject empty array', () => {
      expect(() => buildInClause('id', [])).toThrow('Values must be a non-empty array');
    });

    it('should reject non-array values', () => {
      expect(() => buildInClause('id', null)).toThrow();
      expect(() => buildInClause('id', 'value')).toThrow();
    });
  });

  describe('ALLOWED_TABLES constant', () => {
    it('should be a Set', () => {
      expect(ALLOWED_TABLES).toBeInstanceOf(Set);
    });

    it('should contain core tables', () => {
      expect(ALLOWED_TABLES.has('users')).toBe(true);
      expect(ALLOWED_TABLES.has('spaces')).toBe(true);
      expect(ALLOWED_TABLES.has('projects')).toBe(true);
    });

    it('should not contain dangerous values', () => {
      expect(ALLOWED_TABLES.has('DROP')).toBe(false);
      expect(ALLOWED_TABLES.has('; --')).toBe(false);
    });
  });
});
