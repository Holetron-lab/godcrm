import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useRelationLookup } from '../useRelationLookup';
import type { ColumnRelationConfig } from '../../types/table.types';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
const relation: ColumnRelationConfig = {
  enabled: true, tableId: '99', valueColumn: 'id', labelColumn: 'name',
  colorColumn: 'color', descriptionColumn: 'description',
};
const row = { id: '42', originalId: 7, data: {
  id: 8, name: 'Ready', color: '#112233', alternateColor: '#abcdef',
  description: 'First', alternateDescription: 'Second', system_user_id: 0,
} };
let client: QueryClient;
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(apiClient.request).mockReset().mockResolvedValue({ data: { rows: [row] } });
});
afterEach(() => { cleanup(); client.clear(); });

describe('useRelationLookup', () => {
  it('resolves original, data and row IDs through the v3 path', async () => {
    const { result } = renderHook(() => useRelationLookup(relation), { wrapper });
    await waitFor(() => expect(result.current.lookup(42)?.label).toBe('Ready'));
    for (const id of [7, 8, '42']) expect(result.current.lookup(id)).toEqual({
      label: 'Ready', color: '#112233', description: 'First',
    });
    expect(apiClient.request).toHaveBeenCalledWith('/tables/99/rows?limit=5000');
    expect(result.current.lookup(null)).toBeNull();
    expect(result.current.lookup('missing')).toBeNull();
  });

  it.each([
    ['colorColumn', 'alternateColor', 'color', '#abcdef'],
    ['descriptionColumn', 'alternateDescription', 'description', 'Second'],
  ] as const)('reloads when %s changes while cached data is fresh', async (column, selected, field, expected) => {
    const { result, rerender } = renderHook((config: ColumnRelationConfig) => useRelationLookup(config), {
      wrapper, initialProps: relation,
    });
    await waitFor(() => expect(result.current.lookup(42)?.label).toBe('Ready'));
    rerender({ ...relation, [column]: selected });
    await waitFor(() => expect(result.current.lookup(42)?.[field]).toBe(expected));
  });

  it('supports flat rows and zero as a custom key', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ data: [row.data] });
    const { result } = renderHook(() => useRelationLookup({ ...relation, valueColumn: 'system_user_id' }), { wrapper });
    await waitFor(() => expect(result.current.lookup(0)?.label).toBe('Ready'));
    expect(result.current.getAllItems()).toHaveLength(1);
  });

  it.each([undefined, { ...relation, enabled: false }, { ...relation, labelColumn: undefined }, { ...relation, valueColumn: undefined }])(
    'does not request rows for an incomplete or disabled configuration', (config) => {
      const { result } = renderHook(() => useRelationLookup(config), { wrapper });
      expect(apiClient.request).not.toHaveBeenCalled();
      expect(result.current.lookup(42)).toBeNull();
    },
  );
});
