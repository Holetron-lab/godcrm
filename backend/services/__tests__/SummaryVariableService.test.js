/**
 * ADR-026: Tables Summary Variable API Tests
 * POST /api/v3/tables/:tableId/columns/:columnId/summary-variable
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock database functions
const mockDbGet = vi.fn();
const mockDbRun = vi.fn();
const mockDbAll = vi.fn();

vi.mock('../../database/connection', () => ({
  dbGet: (...args) => mockDbGet(...args),
  dbRun: (...args) => mockDbRun(...args),
  dbAll: (...args) => mockDbAll(...args),
}));

// Import after mocks
import { createSummaryVariable, AGGREGATION_FORMULAS } from '../SummaryVariableService.js';

describe('SummaryVariableService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSummaryVariable', () => {
    const mockTable = {
      id: 42,
      name: 'orders',
      project_id: 10,
    };

    const mockColumn = {
      id: 'col_revenue',
      name: 'revenue',
      type: 'number',
      table_id: 42,
    };

    const mockSpace = {
      id: 1,
      name: 'Test Space',
    };

    beforeEach(() => {
      // Setup default mocks
      mockDbGet.mockImplementation((query) => {
        if (query.includes('universal_tables')) return Promise.resolve(mockTable);
        if (query.includes('table_columns')) return Promise.resolve(mockColumn);
        if (query.includes('projects') && query.includes('spaces')) return Promise.resolve({ space_id: 1 });
        if (query.includes('spaces')) return Promise.resolve(mockSpace);
        return Promise.resolve(null);
      });
      
      mockDbAll.mockResolvedValue([]);
      mockDbRun.mockResolvedValue({ lastID: 123, changes: 1 });
    });

    it('creates variable with correct formula for SUM', async () => {
      const result = await createSummaryVariable({
        tableId: 42,
        columnId: 'col_revenue',
        aggregation: 'sum',
        userId: 1,
      });

      expect(result.success).toBe(true);
      expect(result.variable.name).toBe('$revenue_sum');
      expect(result.variable.formula).toBe('SUM({{revenue}})');
      expect(result.variable.scope).toBe('table');
      expect(result.variable.scopeRef).toBe(42);
    });

    it('creates variable with correct formula for AVG', async () => {
      const result = await createSummaryVariable({
        tableId: 42,
        columnId: 'col_revenue',
        aggregation: 'avg',
        userId: 1,
      });

      expect(result.variable.formula).toBe('AVG({{revenue}})');
      expect(result.variable.name).toBe('$revenue_avg');
    });

    it('creates variable with correct formula for MIN', async () => {
      const result = await createSummaryVariable({
        tableId: 42,
        columnId: 'col_revenue',
        aggregation: 'min',
        userId: 1,
      });

      expect(result.variable.formula).toBe('MIN({{revenue}})');
      expect(result.variable.name).toBe('$revenue_min');
    });

    it('creates variable with correct formula for MAX', async () => {
      const result = await createSummaryVariable({
        tableId: 42,
        columnId: 'col_revenue',
        aggregation: 'max',
        userId: 1,
      });

      expect(result.variable.formula).toBe('MAX({{revenue}})');
      expect(result.variable.name).toBe('$revenue_max');
    });

    it('creates variable with correct formula for COUNT', async () => {
      const result = await createSummaryVariable({
        tableId: 42,
        columnId: 'col_revenue',
        aggregation: 'count',
        userId: 1,
      });

      expect(result.variable.formula).toBe('COUNT({{revenue}})');
      expect(result.variable.name).toBe('$revenue_count');
    });

    it('throws error for invalid aggregation type', async () => {
      await expect(
        createSummaryVariable({
          tableId: 42,
          columnId: 'col_revenue',
          aggregation: 'invalid',
          userId: 1,
        })
      ).rejects.toThrow('Invalid aggregation type');
    });

    it('throws error if table not found', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('universal_tables')) return Promise.resolve(null);
        return Promise.resolve(null);
      });

      await expect(
        createSummaryVariable({
          tableId: 999,
          columnId: 'col_revenue',
          aggregation: 'sum',
          userId: 1,
        })
      ).rejects.toThrow('Table not found');
    });

    it('throws error if column not found', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('universal_tables')) return Promise.resolve(mockTable);
        if (query.includes('table_columns')) return Promise.resolve(null);
        return Promise.resolve(null);
      });

      await expect(
        createSummaryVariable({
          tableId: 42,
          columnId: 'nonexistent',
          aggregation: 'sum',
          userId: 1,
        })
      ).rejects.toThrow('Column not found');
    });

    it('generates unique name if variable already exists', async () => {
      // First call: variable exists
      mockDbAll.mockResolvedValueOnce([{ name: '$revenue_sum' }]);
      
      const result = await createSummaryVariable({
        tableId: 42,
        columnId: 'col_revenue',
        aggregation: 'sum',
        userId: 1,
      });

      // Should have suffix to make unique
      expect(result.variable.name).toMatch(/\$revenue_sum_\d+/);
    });

    it('uses custom variable name if provided', async () => {
      const result = await createSummaryVariable({
        tableId: 42,
        columnId: 'col_revenue',
        aggregation: 'sum',
        userId: 1,
        variableName: '$my_custom_sum',
      });

      expect(result.variable.name).toBe('$my_custom_sum');
    });
  });

  describe('AGGREGATION_FORMULAS', () => {
    it('has all required aggregation types', () => {
      expect(AGGREGATION_FORMULAS).toHaveProperty('sum');
      expect(AGGREGATION_FORMULAS).toHaveProperty('avg');
      expect(AGGREGATION_FORMULAS).toHaveProperty('min');
      expect(AGGREGATION_FORMULAS).toHaveProperty('max');
      expect(AGGREGATION_FORMULAS).toHaveProperty('count');
      expect(AGGREGATION_FORMULAS).toHaveProperty('countUnique');
      expect(AGGREGATION_FORMULAS).toHaveProperty('countEmpty');
      expect(AGGREGATION_FORMULAS).toHaveProperty('countFilled');
    });

    it('generates correct formula templates', () => {
      expect(AGGREGATION_FORMULAS.sum('amount')).toBe('SUM({{amount}})');
      expect(AGGREGATION_FORMULAS.avg('price')).toBe('AVG({{price}})');
      expect(AGGREGATION_FORMULAS.min('date')).toBe('MIN({{date}})');
      expect(AGGREGATION_FORMULAS.max('score')).toBe('MAX({{score}})');
      expect(AGGREGATION_FORMULAS.count('items')).toBe('COUNT({{items}})');
    });
  });
});
