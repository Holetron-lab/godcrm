import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { useRelationOptions } from '../utils';
import type { ColumnModel } from '../../../types/table.types';

/** ADR-205 AC6 — filter dropdowns load a relation only once the user reaches that dropdown. */
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const relation = { enabled: true, tableId: '101035', valueColumn: 'id', labelColumn: 'name' };
const lensColumn: ColumnModel = {
  id: 'status', tableId: '101036', name: 'status', displayName: 'Status', type: 'select', config: { relation },
  isRequired: false, isReadonly: false, orderIndex: 0, width: 100, isVisible: true,
};
const staticColumn: ColumnModel = {
  ...lensColumn, id: 'kind', name: 'kind', displayName: 'Kind',
  config: { options: [{ value: 'x', label: 'X' }] },
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe('TableFilters useRelationOptions (lazy)', () => {
  it('makes no request while no dropdown has been opened and falls back to static options', () => {
    const { result } = renderHook(() => useRelationOptions([lensColumn, staticColumn], []), { wrapper: wrapper() });
    expect(apiClient.request).not.toHaveBeenCalled();
    expect(result.current.getColumnOptions(staticColumn)).toEqual([{ value: 'x', label: 'X' }]);
    expect(result.current.getColumnOptions(lensColumn)).toEqual([]);
  });

  it('loads the complete list for a column once its dropdown is opened', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ data: { rows: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] } });
    const { result, rerender } = renderHook(
      ({ opened }: { opened: string[] }) => useRelationOptions([lensColumn, staticColumn], opened),
      { wrapper: wrapper(), initialProps: { opened: [] as string[] } },
    );
    expect(apiClient.request).not.toHaveBeenCalled();

    rerender({ opened: ['status'] });
    await waitFor(() => expect(result.current.getColumnOptions(lensColumn)).toHaveLength(2));
    expect(apiClient.request).toHaveBeenCalledTimes(1);
    expect(apiClient.request).toHaveBeenCalledWith('/tables/101035/rows?limit=5000');
  });
});
