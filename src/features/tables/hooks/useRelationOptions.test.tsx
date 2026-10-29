import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { useMultiRelationOptions } from './useRelationOptions';
import { relationLookupQueryKey } from './useRelationLookup';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const relation = { enabled: true, tableId: '42', valueColumn: 'id', labelColumn: 'name' };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('useMultiRelationOptions', () => {
  it('supports adding and removing enabled relations between renders', async () => {
    vi.mocked(apiClient.request).mockResolvedValue({ data: { rows: [{ id: 7, name: 'Seven' }] } });
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ enabled }) => useMultiRelationOptions(enabled ? [{ columnId: 'status', relation }] : []),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(result.current.size).toBe(0);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.get('status')).toEqual([{ value: '7', label: 'Seven', color: undefined }]));
    rerender({ enabled: false });
    expect(result.current.size).toBe(0);
  });

  it('reads the lookup cache shared with useRelationLookup for each column (ADR-205: one fetch per relation)', () => {
    const warn = vi.spyOn(console, 'warn');
    const { client, wrapper } = setup();
    const options = [{ value: '7', label: 'Seven', color: undefined }];
    client.setQueryData(relationLookupQueryKey(relation), {
      map: new Map([['7', { label: 'Seven' }]]), items: [{ value: '7', label: 'Seven' }], reverse: new Map(),
    });
    const { result } = renderHook(() => useMultiRelationOptions([
      { columnId: 'first', relation }, { columnId: 'second', relation },
    ]), { wrapper });
    expect(result.current.get('first')).toEqual(options);
    expect(result.current.get('second')).toEqual(options);
    expect(apiClient.request).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
