import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { useRelationOptions } from '../useColumnSummaries';
import type { ServerColumnSummary, TableSummaryState } from '../../../hooks/useTableSummary';
import type { ColumnModel } from '../../../types/table.types';

/**
 * ADR-205 AC6 — the grid must not download a related table while the server
 * map (GET /rows?include=relations) already resolves everything it shows.
 */
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const relation = { enabled: true, tableId: '101035', valueColumn: 'id', labelColumn: 'name' };
const column = (id: string, name: string, type: ColumnModel['type'] = 'select'): ColumnModel => ({
  id, tableId: '101036', name, displayName: name, type, config: { relation },
  isRequired: false, isReadonly: false, orderIndex: 0, width: 100, isVisible: true,
});
const columns = [column('c1', 'select_comma'), column('c2', 'select_json', 'multi-select')];
const serverMap = {
  select_comma: { 'qa-a': { value: 'A', label: 'A', color: '#111' }, 'qa-b': { value: 'B', label: 'B' } },
  select_json: { 'qa-a': { value: 'A', label: 'A' }, 'qa-b': { value: 'B', label: 'B' } },
};

const summaryBase: ServerColumnSummary = {
  count: 2, countFilled: 2, countEmpty: 0, countUnique: 2, percentFilled: 100,
  numericCount: 0, sum: 0, avg: null, min: null, max: null,
  checked: 0, unchecked: 0, percentChecked: 0,
  dateCount: 0, earliest: null, latest: null, dateRange: null, valueCounts: {},
};
const summaryWith = (valueCounts: Record<string, number>, total = 2, columnId = 'c1'): TableSummaryState => ({
  status: 'ready',
  data: { total, columns: { [columnId]: { ...summaryBase, valueCounts } } },
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe('useRelationOptions (grid) with a server map', () => {
  it('derives options from the server map and makes no request', () => {
    const { result } = renderHook(
      () => useRelationOptions(columns, 2, { relations: serverMap, summary: summaryWith({ 'qa-a': 1, 'qa-b': 1 }) }),
      { wrapper: wrapper() },
    );
    expect(apiClient.request).not.toHaveBeenCalled();
    expect(result.current.get('c1')).toEqual([
      { value: 'qa-a', label: 'A', color: '#111' },
      { value: 'qa-b', label: 'B', color: undefined },
    ]);
    expect(result.current.get('c2')).toHaveLength(2);
  });

  it('downloads the related table once when there is no server map', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ data: { rows: [{ id: 'qa-a', name: 'A' }] } });
    const { result } = renderHook(() => useRelationOptions(columns, 2), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.get('c1')).toEqual([{ value: 'qa-a', label: 'A', color: undefined }]));
    expect(apiClient.request).toHaveBeenCalledTimes(1);
    expect(apiClient.request).toHaveBeenCalledWith('/tables/101035/rows?limit=5000');
  });

  it('downloads when a footer top value of a select column lives on a page that is not loaded', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ data: { rows: [{ id: 'qa-off-page', name: 'Off page' }] } });
    const { result } = renderHook(
      () => useRelationOptions([columns[0]], 2, { relations: serverMap, summary: summaryWith({ 'qa-off-page': 5, 'qa-a': 1 }, 50) }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.get('c1')).toEqual([{ value: 'qa-off-page', label: 'Off page', color: undefined }]));
    expect(apiClient.request).toHaveBeenCalledTimes(1);
  });

  it('does not download for a key the related table simply lacks (all rows loaded, QA fixture qa-ghost)', () => {
    const { result } = renderHook(
      () => useRelationOptions([columns[0]], 2, { relations: serverMap, summary: summaryWith({ 'qa-a': 1, 'qa-b': 1, 'qa-ghost': 1 }, 2) }),
      { wrapper: wrapper() },
    );
    expect(apiClient.request).not.toHaveBeenCalled();
    expect(result.current.get('c1')).toHaveLength(2);
  });

  it('does not download for a multi-select column, whose footer never labels its values', () => {
    renderHook(
      () => useRelationOptions([columns[1]], 2, { relations: serverMap, summary: summaryWith({ 'qa-ghost': 3 }, 500, 'c2') }),
      { wrapper: wrapper() },
    );
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it('downloads the grouped column so group order follows the related table', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ data: { rows: [{ id: 'qa-b', name: 'B' }, { id: 'qa-a', name: 'A' }] } });
    const { result } = renderHook(
      () => useRelationOptions(columns, 2, { relations: serverMap, groupByColumn: 'c1' }),
      { wrapper: wrapper() },
    );
    // c2 stays on the server map while c1 loads
    expect(result.current.get('c2')).toHaveLength(2);
    await waitFor(() => expect(result.current.get('c1')?.map((o) => o.value)).toEqual(['qa-b', 'qa-a']));
    expect(apiClient.request).toHaveBeenCalledTimes(1);
  });

  it('requests nothing for an empty grid', () => {
    renderHook(() => useRelationOptions(columns, 0), { wrapper: wrapper() });
    expect(apiClient.request).not.toHaveBeenCalled();
  });
});
