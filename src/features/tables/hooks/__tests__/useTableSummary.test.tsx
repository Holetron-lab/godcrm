import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: vi.fn() } }));

import { apiClient } from '@/shared/utils/apiClient';
import { useTablesStore } from '../../store/tablesStore';
import { buildSummaryRequest, summarizeRows, useTableSummary, type TableSummaryData } from '../useTableSummary';
import type { ColumnModel, RowModel } from '../../types/table.types';

const post = apiClient.post as ReturnType<typeof vi.fn>;

const column = (id: string, type: ColumnModel['type'] = 'text'): ColumnModel => ({
  id, tableId: '100684', name: `col_${id}`, displayName: id, type, config: {},
  isRequired: false, isReadonly: false, orderIndex: 0, width: 100, isVisible: true,
});
const columns = [column('11', 'number'), column('12', 'select'), column('13', 'date'), column('id'), column('_created_at')];

const payload: TableSummaryData = {
  total: 120,
  columns: { '11': { count: 120, countFilled: 100, countEmpty: 20, countUnique: 50, percentFilled: 83, numericCount: 100, sum: 600, avg: 6, min: 1, max: 20, checked: 0, unchecked: 100, percentChecked: 0, dateCount: 0, earliest: null, latest: null, dateRange: null, valueCounts: {} } },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('buildSummaryRequest', () => {
  it('sends only real column ids and the instants the client filter uses', () => {
    const request = buildSummaryRequest({
      columns,
      searchQuery: 'needle',
      searchColumns: ['12', 'id'],
      selectFilters: { '12': ['a', 'b'], '13': [], id: ['x'] },
      dateFilters: { '13': { from: '2026-01-01', to: '2026-01-31' }, '11': {} },
    });
    const to = new Date('2026-01-31');
    to.setHours(23, 59, 59, 999);
    expect(request).toEqual({
      columnIds: ['11', '12', '13'],
      searchQuery: 'needle',
      searchColumns: ['12'],
      selectFilters: { '12': ['a', 'b'] },
      dateFilters: { '13': { from: new Date('2026-01-01').toISOString(), to: to.toISOString() } },
    });
  });

  it('keeps an explicit empty selection and drops synthetic row ids', () => {
    expect(buildSummaryRequest({ columns, rowIds: ['7', 'ext_9'] })?.rowIds).toEqual(['7']);
    expect(buildSummaryRequest({ columns, rowIds: [] })?.rowIds).toEqual([]);
    expect(buildSummaryRequest({ columns: [column('id')] })).toBeNull();
  });
});

describe('useTableSummary', () => {
  beforeEach(() => {
    post.mockReset();
    useTablesStore.setState({ rowsVersion: 0 });
  });

  it('posts the request once for identical scopes and exposes server values', async () => {
    post.mockResolvedValue({ success: true, data: payload });
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useTableSummary({ tableId: 100684, columns, searchQuery: q, selectFilters: {}, dateFilters: {} }),
      { wrapper, initialProps: { q: '' } },
    );
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.total).toBe(120);
    expect(post).toHaveBeenCalledWith('/tables/100684/summary', { data: { columnIds: ['11', '12', '13'] } }, expect.anything());

    rerender({ q: '' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(post).toHaveBeenCalledTimes(1);

    rerender({ q: 'needle' });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toEqual({ data: { columnIds: ['11', '12', '13'], searchQuery: 'needle' } });
  });

  it('refetches when rows change locally', async () => {
    post.mockResolvedValue({ success: true, data: payload });
    const { result } = renderHook(() => useTableSummary({ tableId: 100684, columns }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    useTablesStore.setState({ rowsVersion: 1 });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  });

  it('reports unavailable without a request for unsupported tables', () => {
    const { result } = renderHook(() => useTableSummary({ tableId: 100684, columns, unsupported: true }), { wrapper });
    expect(result.current.status).toBe('unavailable');
    expect(post).not.toHaveBeenCalled();
  });

  it('reports unavailable instead of partial values when the server refuses', async () => {
    post.mockRejectedValue(new Error('Full summary is not available for this data source'));
    const { result } = renderHook(() => useTableSummary({ tableId: 100684, columns }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.reason).toMatch(/not available/);
    expect(result.current.data).toBeUndefined();
  });

  it('stays idle when disabled', () => {
    const { result } = renderHook(() => useTableSummary({ tableId: 100684, columns, enabled: false }), { wrapper });
    expect(result.current.status).toBe('idle');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('summarizeRows (external sources: totals over the loaded rows)', () => {
  const row = (id: string, data: Record<string, unknown>): RowModel =>
    ({ id, tableId: '100986', data, createdAt: '', updatedAt: '', createdBy: '' });
  const external = [column('11', 'number'), column('12', 'select'), column('13', 'date'), column('14', 'checkbox'), column('15', 'text')];
  // External rows carry source field names; an older shape keys cells by column id.
  const rows = [
    row('ext_1', { col_11: '10', col_12: 'Russia', col_13: '2026-01-10', col_14: 1, col_15: 'a' }),
    row('ext_2', { col_11: 30, col_12: 'Russia', col_13: '2026-01-20', col_14: 0, col_15: 'b' }),
    row('ext_3', { '11': null, col_12: 'Canada', col_13: '', col_14: '', col_15: 'a' }),
  ];

  it('aggregates numbers, options, dates, checkboxes and text like the server does', () => {
    const summary = summarizeRows(external, rows);
    expect(summary.total).toBe(3);
    expect(summary.columns['11']).toMatchObject({ count: 3, countFilled: 2, countEmpty: 1, numericCount: 2, sum: 40, avg: 20, min: 10, max: 30 });
    expect(summary.columns['12']).toMatchObject({ countUnique: 2, valueCounts: { Russia: 2, Canada: 1 } });
    expect(summary.columns['13']).toMatchObject({ dateCount: 2, earliest: '2026-01-10T00:00:00.000Z', latest: '2026-01-20T00:00:00.000Z', dateRange: 10 });
    expect(summary.columns['14']).toMatchObject({ checked: 1, unchecked: 1, percentChecked: 50 });
    expect(summary.columns['15']).toMatchObject({ countUnique: 2, percentFilled: 100 });
  });

  it('returns zero totals for an empty selection', () => {
    const summary = summarizeRows(external, []);
    expect(summary.total).toBe(0);
    expect(summary.columns['11']).toMatchObject({ count: 0, numericCount: 0, avg: null, min: null, earliest: null, valueCounts: {} });
  });
});
