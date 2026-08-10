/**
 * ADR-0060 P5c / P5d AC14 — Hook-level guard wiring.
 *
 * The scrubber + guardMutation function are unit-tested separately. This file
 * is the integration test that locks in the *wiring*: when the mutation hooks
 * are mounted inside <PublicViewProvider readOnly>, calling .mutate / .mutateAsync
 * must NOT reach `tablesApi` and must emit the documented console.warn.
 *
 * Belt-and-braces: even if a future preset forgets to hide an edit affordance,
 * the API never receives a write.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the API surface BEFORE importing the hooks (vi.mock is hoisted).
vi.mock('../../api/tablesApi', () => ({
  tablesApi: {
    updateRow: vi.fn().mockResolvedValue(undefined),
    updateColumn: vi.fn().mockResolvedValue({}),
  },
}));

// Stub zustand selectors used by useRowMutations / useColumnMutations.
// We don't care about store semantics here, only that the guard short-circuits
// before any store / API mutation can run.
vi.mock('../../store/tablesStore', () => {
  const fakeStore = {
    rows: {},
    updateCell: vi.fn(),
    flashCellSuccess: vi.fn(),
    setError: vi.fn(),
    openVerificationGate: vi.fn(),
    upsertColumn: vi.fn(),
  };
  type Selector<T> = (s: typeof fakeStore) => T;
  const useTablesStore = <T,>(selector: Selector<T>): T => selector(fakeStore);
  // mimic the static getState API used by useRowMutations.onMutate
  useTablesStore.getState = () => fakeStore;
  return { useTablesStore };
});

import { tablesApi } from '../../api/tablesApi';
import { useRowMutations } from '../useRowMutations';
import { useColumnMutations } from '../useColumnMutations';
import { PublicViewProvider } from '@/features/public/PublicViewContext';

function makeWrapper(readOnly: boolean) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <PublicViewProvider readOnly={readOnly} publicSlug={readOnly ? 'help' : null}>
          {children}
        </PublicViewProvider>
      </QueryClientProvider>
    );
  };
}

describe('useRowMutations — public read-only guard (P5c)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('does NOT call tablesApi.updateRow when inside a public read-only scope', async () => {
    const { result } = renderHook(() => useRowMutations('99'), {
      wrapper: makeWrapper(true),
    });

    result.current.mutate({
      rowId: 'r1',
      columnId: 'c1',
      value: 'never-sent',
      data: { c1: 'never-sent' },
    });

    // Give any swallowed promise / debounce a chance to leak.
    await new Promise((r) => setTimeout(r, 30));

    expect(tablesApi.updateRow).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[publicView] mutation suppressed: useRowMutations'),
    );
  });

  it('mutateAsync resolves to undefined (suppressed) without hitting the API', async () => {
    const { result } = renderHook(() => useRowMutations('99'), {
      wrapper: makeWrapper(true),
    });

    const value = await result.current.mutateAsync({
      rowId: 'r1',
      columnId: 'c1',
      value: 'x',
      data: { c1: 'x' },
    });

    expect(value).toBeUndefined();
    expect(tablesApi.updateRow).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('passes through to the real mutation pipeline when readOnly=false', async () => {
    const { result } = renderHook(() => useRowMutations('99'), {
      wrapper: makeWrapper(false),
    });

    result.current.mutate({
      rowId: 'r1',
      columnId: 'c1',
      value: 'real',
      data: { c1: 'real' },
    });

    // The hook debounces the API call by 1s, so we only assert that the
    // mutation pipeline ran (no console.warn from guardMutation).
    await waitFor(() => {
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[publicView] mutation suppressed'),
      );
    });
  });
});

describe('useColumnMutations — public read-only guard (P5c)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('suppresses every column mutation (visibility/width/settings/reorder) under readOnly', () => {
    const { result } = renderHook(() => useColumnMutations('99'), {
      wrapper: makeWrapper(true),
    });

    result.current.visibilityMutation.mutate({ columnId: 'c1', isVisible: false });
    result.current.widthMutation.mutate({ columnId: 'c1', width: 200 });
    result.current.settingsMutation.mutate({ columnId: 'c1', payload: { width: 200 } });
    result.current.reorderMutation.mutate({ columnId: 'c1', newIndex: 3 });

    expect(tablesApi.updateColumn).not.toHaveBeenCalled();

    // Each of the four suppressed mutations should have logged its own
    // hook-name marker — verify the union.
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('useColumnMutations.visibility'))).toBe(true);
    expect(messages.some((m) => m.includes('useColumnMutations.width'))).toBe(true);
    expect(messages.some((m) => m.includes('useColumnMutations.settings'))).toBe(true);
    expect(messages.some((m) => m.includes('useColumnMutations.reorder'))).toBe(true);
  });

  it('passes mutations through when not inside a public scope', async () => {
    const { result } = renderHook(() => useColumnMutations('99'), {
      wrapper: makeWrapper(false),
    });

    result.current.visibilityMutation.mutate({ columnId: 'c1', isVisible: false });

    await waitFor(() => expect(tablesApi.updateColumn).toHaveBeenCalledTimes(1));
    expect(tablesApi.updateColumn).toHaveBeenCalledWith(
      '99',
      'c1',
      expect.objectContaining({ isVisible: false }),
    );
  });
});
