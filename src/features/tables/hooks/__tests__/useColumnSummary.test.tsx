import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import { useColumnSummary } from '../useColumnSummary';
import { apiClient } from '@/shared/utils/apiClient';

const mockApiPost = apiClient.post as ReturnType<typeof vi.fn>;

describe('useColumnSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockColumn = {
    id: 'col_1',
    name: 'amount',
    type: 'number' as const,
    config: {},
  };

  const mockRows = [
    { id: '1', data: { amount: 100 } },
    { id: '2', data: { amount: 200 } },
    { id: '3', data: { amount: 300 } },
  ];

  it('calculates all aggregations for numeric column', () => {
    const { result } = renderHook(() =>
      useColumnSummary({
        column: mockColumn,
        rows: mockRows,
      })
    );

    expect(result.current.values).toEqual({
      sum: 600,
      avg: 200,
      min: 100,
      max: 300,
      count: 3,
      countEmpty: 0,
      countFilled: 3,
    });
  });

  it('respects enabled aggregations from config', () => {
    const columnWithConfig = {
      ...mockColumn,
      config: { summary: { sum: true, avg: false, min: true } },
    };

    const { result } = renderHook(() =>
      useColumnSummary({
        column: columnWithConfig,
        rows: mockRows,
      })
    );

    expect(result.current.enabled).toContain('sum');
    expect(result.current.enabled).toContain('min');
    expect(result.current.enabled).not.toContain('avg');
  });

  it('provides exportToVariable function', () => {
    const { result } = renderHook(() =>
      useColumnSummary({
        column: mockColumn,
        rows: mockRows,
        tableId: 42,
        spaceId: 1,
      })
    );

    expect(typeof result.current.exportToVariable).toBe('function');
  });

  it('exportToVariable calls API with correct params', async () => {
    mockApiPost.mockResolvedValueOnce({
      success: true,
      data: { variable: { id: 1, name: '$amount_sum', formula: 'SUM({{amount}})' } },
    });

    const { result } = renderHook(() =>
      useColumnSummary({
        column: mockColumn,
        rows: mockRows,
        tableId: 42,
        spaceId: 1,
      })
    );

    await result.current.exportToVariable('sum');

    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/v3/tables/42/columns/col_1/summary-variable',
      { aggregation: 'sum' }
    );
  });

  it('returns linkedVariables from config', () => {
    const columnWithLinked = {
      ...mockColumn,
      config: {
        summary: {
          sum: true,
          linkedVariables: { sum: { variableId: 1, variableName: '$sum' } },
        },
      },
    };

    const { result } = renderHook(() =>
      useColumnSummary({
        column: columnWithLinked,
        rows: mockRows,
      })
    );

    expect(result.current.linkedVariables.sum).toEqual({
      variableId: 1,
      variableName: '$sum',
    });
  });

  it('handles empty rows correctly', () => {
    const { result } = renderHook(() =>
      useColumnSummary({
        column: mockColumn,
        rows: [],
      })
    );

    expect(result.current.values.sum).toBe(0);
    expect(result.current.values.count).toBe(0);
    expect(result.current.values.avg).toBe(0);
  });

  it('handles null/undefined values in rows', () => {
    const rowsWithNulls = [
      { id: '1', data: { amount: 100 } },
      { id: '2', data: { amount: null } },
      { id: '3', data: { amount: undefined } },
      { id: '4', data: {} },
    ];

    const { result } = renderHook(() =>
      useColumnSummary({
        column: mockColumn,
        rows: rowsWithNulls,
      })
    );

    expect(result.current.values.sum).toBe(100);
    expect(result.current.values.count).toBe(4);
    expect(result.current.values.countEmpty).toBe(3);
    expect(result.current.values.countFilled).toBe(1);
  });
});
