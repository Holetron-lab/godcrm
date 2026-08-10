/**
 * Tests for MissingColumnResolver service
 * ADR-031: Missing Column Resolution Dialog
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MissingColumnResolver,
  SimilarColumn,
  MissingColumnContext
} from '../MissingColumnResolver';
import { ColumnType } from '@/shared/types';

describe('MissingColumnResolver', () => {
  let resolver: MissingColumnResolver;

  beforeEach(() => {
    resolver = new MissingColumnResolver();
  });

  describe('findSimilarColumns', () => {
    const mockColumns = [
      { id: '1', name: 'status', type: 'select' as ColumnType },
      { id: '2', name: 'user_status', type: 'select' as ColumnType },
      { id: '3', name: 'state', type: 'select' as ColumnType },
      { id: '4', name: 'priority', type: 'select' as ColumnType },
      { id: '5', name: 'title', type: 'text' as ColumnType },
      { id: '6', name: 'name', type: 'text' as ColumnType }
    ];

    it('should find exact match with highest score', () => {
      const similar = resolver.findSimilarColumns(mockColumns, 'status');
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].column.name).toBe('status');
      // Score = 0.5 (name) + 0.2 (partial) + 0.15 (synonym) = 0.85
      expect(similar[0].score).toBeGreaterThan(0.8);
    });

    it('should find partial match (contains)', () => {
      const similar = resolver.findSimilarColumns(mockColumns, 'status');
      const userStatus = similar.find(s => s.column.name === 'user_status');
      expect(userStatus).toBeDefined();
      expect(userStatus!.reasons).toContain('частичное совпадение');
    });

    it('should find synonym match', () => {
      const similar = resolver.findSimilarColumns(mockColumns, 'status');
      const state = similar.find(s => s.column.name === 'state');
      expect(state).toBeDefined();
      expect(state!.reasons).toContain('семантическое совпадение');
    });

    it('should boost score for type match', () => {
      const similar = resolver.findSimilarColumns(mockColumns, 'status', 'select');
      // All select types should have higher scores
      const selectColumns = similar.filter(s => s.column.type === 'select');
      expect(selectColumns.every(s => s.reasons.includes('совпадает тип'))).toBe(true);
    });

    it('should return empty array for no matches', () => {
      const similar = resolver.findSimilarColumns(mockColumns, 'zzz_nonexistent_zzz');
      expect(similar).toEqual([]);
    });

    it('should sort by score descending', () => {
      const similar = resolver.findSimilarColumns(mockColumns, 'status');
      for (let i = 1; i < similar.length; i++) {
        expect(similar[i - 1].score).toBeGreaterThanOrEqual(similar[i].score);
      }
    });
  });

  describe('detectColumnType', () => {
    it('should detect number type', () => {
      expect(resolver.detectColumnType([1, 2, 3])).toBe('number');
      expect(resolver.detectColumnType(['1', '2.5', '100'])).toBe('number');
    });

    it('should detect checkbox type', () => {
      // String values work correctly
      expect(resolver.detectColumnType(['true', 'false', 'true'])).toBe('checkbox');
      expect(resolver.detectColumnType(['yes', 'no'])).toBe('checkbox');
    });

    it('should detect datetime type', () => {
      expect(resolver.detectColumnType(['2025-01-21', '2025-12-31'])).toBe('datetime');
      expect(resolver.detectColumnType(['2025-01-21T10:30:00'])).toBe('datetime');
    });

    it('should detect email type', () => {
      expect(resolver.detectColumnType(['a@b.com', 'x@y.org'])).toBe('email');
    });

    it('should detect url type', () => {
      expect(resolver.detectColumnType(['https://example.com', 'http://test.org'])).toBe('url');
    });

    it('should default to text for mixed values', () => {
      expect(resolver.detectColumnType(['hello', 123, true])).toBe('text');
    });

    it('should default to text for empty array', () => {
      expect(resolver.detectColumnType([])).toBe('text');
    });

    it('should ignore null/undefined values', () => {
      expect(resolver.detectColumnType([null, 1, undefined, 2, 3])).toBe('number');
    });
  });

  describe('calculateSimilarity', () => {
    const mockColumn = { id: '1', name: 'status', type: 'select' as ColumnType };

    it('should calculate high similarity for same name', () => {
      const result = resolver.calculateSimilarity(mockColumn, 'status');
      // Score = 0.5 (name) + 0.2 (partial) + 0.15 (synonym) = 0.85
      expect(result.score).toBeGreaterThan(0.8);
      expect(result.reasons).toContain('похожее название');
    });

    it('should calculate moderate similarity for similar names', () => {
      const result = resolver.calculateSimilarity(mockColumn, 'statuz');
      expect(result.score).toBeGreaterThan(0.4);
      expect(result.score).toBeLessThan(1);
    });

    it('should add type match bonus', () => {
      const withType = resolver.calculateSimilarity(mockColumn, 'status', 'select');
      const withoutType = resolver.calculateSimilarity(mockColumn, 'status');
      expect(withType.score).toBeGreaterThan(withoutType.score);
    });

    it('should detect partial matches', () => {
      const column = { id: '2', name: 'user_status', type: 'select' as ColumnType };
      const result = resolver.calculateSimilarity(column, 'status');
      expect(result.reasons).toContain('частичное совпадение');
    });
  });

  describe('caching', () => {
    it('should cache resolution results when applyToAll is true', () => {
      const context: MissingColumnContext = {
        source: 'import',
        tableId: 1,
        tableName: 'Tasks',
        missingColumnKey: 'status_id'
      };

      // Mock resolution
      resolver.cacheResolution(context, {
        action: 'map',
        mappedColumnId: '123',
        mappedColumnName: 'status',
        applyToAll: true
      });

      const cached = resolver.getCachedResolution(context);
      expect(cached).toBeDefined();
      expect(cached!.mappedColumnId).toBe('123');
    });

    it('should not cache when applyToAll is false', () => {
      const context: MissingColumnContext = {
        source: 'import',
        tableId: 1,
        tableName: 'Tasks',
        missingColumnKey: 'priority'
      };

      resolver.cacheResolution(context, {
        action: 'create',
        newColumn: { name: 'priority', type: 'select' },
        applyToAll: false
      });

      const cached = resolver.getCachedResolution(context);
      expect(cached).toBeUndefined();
    });

    it('should clear cache', () => {
      const context: MissingColumnContext = {
        source: 'widget',
        tableId: 2,
        tableName: 'Users',
        missingColumnKey: 'role'
      };

      resolver.cacheResolution(context, {
        action: 'map',
        mappedColumnId: '456',
        applyToAll: true
      });

      resolver.clearCache();
      expect(resolver.getCachedResolution(context)).toBeUndefined();
    });
  });
});
