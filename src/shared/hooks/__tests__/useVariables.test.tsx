/**
 * useVariables Hook Tests - ADR-026
 * TDD: Tests first!
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { evaluateFormulaWithVariables } from '../useVariables';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from '@/shared/utils/apiClient';
import { useVariables } from '../useVariables';
import type { Variable, VariablesResponse } from '../useVariables';

// ============================================================
// Test Setup
// ============================================================

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

const mockVariables: Variable[] = [
  {
    id: 1,
    name: '$tax_rate',
    value: 0.20,
    scope: 'space',
    scopeRef: null,
    formula: '0.20',
    streamId: 1,
  },
  {
    id: 2,
    name: '$total_revenue',
    value: 150000,
    scope: 'table',
    scopeRef: 15,
    formula: 'SUM({{amount}})',
    streamId: 1,
  },
  {
    id: 3,
    name: '$margin',
    value: 45000,
    scope: 'table',
    scopeRef: 15,
    formula: '$total_revenue * 0.3',
    streamId: 2,
  },
];

const mockResponse: VariablesResponse = {
  tableId: 42,
  variables: mockVariables,
};

// ============================================================
// useVariables Hook Tests
// ============================================================

describe('useVariables Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as any).mockResolvedValue(mockResponse);
  });

  describe('Basic Functionality', () => {
    it('should fetch variables for a space', async () => {
      const { result } = renderHook(() => useVariables(1), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(apiClient.get).toHaveBeenCalledWith('/spaces/1/variables');
      expect(result.current.variables).toHaveLength(3);
      expect(result.current.tableId).toBe(42);
    });

    it('should not fetch when spaceId is null', () => {
      const { result } = renderHook(() => useVariables(null), { wrapper: createWrapper() });

      expect(apiClient.get).not.toHaveBeenCalled();
      expect(result.current.variables).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('getVariable', () => {
    it('should return variable value by name', async () => {
      const { result } = renderHook(() => useVariables(1), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.getVariable('$tax_rate')).toBe(0.20);
      expect(result.current.getVariable('$total_revenue')).toBe(150000);
    });

    it('should return null for unknown variable', async () => {
      const { result } = renderHook(() => useVariables(1), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.getVariable('$unknown')).toBeNull();
    });

    it('should handle names without $ prefix', async () => {
      const { result } = renderHook(() => useVariables(1), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.getVariable('tax_rate')).toBe(0.20);
    });
  });

  describe('variablesMap', () => {
    it('should provide map for formula evaluation', async () => {
      const { result } = renderHook(() => useVariables(1), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const map = result.current.variablesMap;
      expect(map['$tax_rate']).toBe(0.20);
      expect(map['$total_revenue']).toBe(150000);
      expect(map['$margin']).toBe(45000);
    });
  });

  describe('Filtering', () => {
    it('should filter by tableId', async () => {
      const { result } = renderHook(
        () => useVariables(1, { tableId: 15 }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should include: $tax_rate (space), $total_revenue (table 15), $margin (table 15)
      expect(result.current.variables).toHaveLength(3);
    });

    it('should exclude space vars when includeSpaceVars is false', async () => {
      const { result } = renderHook(
        () => useVariables(1, { tableId: 15, includeSpaceVars: false }),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should include only table 15 vars
      expect(result.current.variables).toHaveLength(2);
      expect(result.current.variables.every(v => v.scope === 'table')).toBe(true);
    });
  });

  describe('Recalculate', () => {
    it('should call recalculate API', async () => {
      (apiClient.post as any).mockResolvedValue({ calculated: 3, cached: 0, errors: [] });
      
      const { result } = renderHook(() => useVariables(1), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const recalcResult = await result.current.recalculate();
      
      expect(apiClient.post).toHaveBeenCalledWith('/spaces/1/variables/recalculate');
      expect(recalcResult.calculated).toBe(3);
    });
  });
});

// ============================================================
// evaluateFormulaWithVariables Tests
// ============================================================

describe('evaluateFormulaWithVariables', () => {
  const variablesMap = {
    '$tax_rate': 0.20,
    '$total': 1000,
    '$discount': 100,
  };

  describe('Basic Evaluation', () => {
    it('should evaluate numeric constants', () => {
      expect(evaluateFormulaWithVariables('42', {})).toBe(42);
      expect(evaluateFormulaWithVariables('3.14', {})).toBe(3.14);
    });

    it('should substitute variables', () => {
      expect(evaluateFormulaWithVariables('$tax_rate', variablesMap)).toBe(0.20);
      expect(evaluateFormulaWithVariables('$total', variablesMap)).toBe(1000);
    });

    it('should evaluate arithmetic with variables', () => {
      expect(evaluateFormulaWithVariables('$total * $tax_rate', variablesMap)).toBe(200);
      expect(evaluateFormulaWithVariables('$total - $discount', variablesMap)).toBe(900);
    });

    it('should handle parentheses', () => {
      expect(evaluateFormulaWithVariables('($total - $discount) * $tax_rate', variablesMap)).toBe(180);
    });
  });

  describe('Edge Cases', () => {
    it('should return 0 for empty formula', () => {
      expect(evaluateFormulaWithVariables('', {})).toBe(0);
      expect(evaluateFormulaWithVariables('   ', {})).toBe(0);
    });

    it('should handle missing variables gracefully', () => {
      // Should warn and use 0
      expect(evaluateFormulaWithVariables('$unknown', {})).toBe(0);
    });

    it('should handle complex expressions', () => {
      expect(evaluateFormulaWithVariables('($total + $discount) / 2', variablesMap)).toBe(550);
    });
  });
});
