/**
 * Tests for PublicViewContext + guardMutation (ADR-0060 P5c).
 *
 * Belt-and-braces guard: even if a UI-hide regresses, mutate/mutateAsync must
 * not reach the API when the surrounding scope is public read-only.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, render, screen, waitFor } from '@testing-library/react';
import { useMutation } from '@tanstack/react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  PublicViewProvider,
  guardMutation,
  useIsPublicReadOnly,
  usePublicView,
} from '../PublicViewContext';

function wrap(readOnly: boolean, publicSlug: string | null = null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <PublicViewProvider readOnly={readOnly} publicSlug={publicSlug}>
          {children}
        </PublicViewProvider>
      </QueryClientProvider>
    );
  };
}

describe('PublicViewContext', () => {
  it('useIsPublicReadOnly returns false outside any provider', () => {
    const { result } = renderHook(() => useIsPublicReadOnly());
    expect(result.current).toBe(false);
  });

  it('useIsPublicReadOnly returns the provider value', () => {
    const { result } = renderHook(() => useIsPublicReadOnly(), {
      wrapper: wrap(true, 'help'),
    });
    expect(result.current).toBe(true);
  });

  it('usePublicView exposes both readOnly and publicSlug', () => {
    const { result } = renderHook(() => usePublicView(), {
      wrapper: wrap(true, 'kb'),
    });
    expect(result.current).toEqual({ readOnly: true, publicSlug: 'kb' });
  });

  it('default state is non-public', () => {
    const { result } = renderHook(() => usePublicView());
    expect(result.current).toEqual({ readOnly: false, publicSlug: null });
  });
});

describe('guardMutation', () => {
  it('passes mutation through untouched when readOnly=false', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const { result } = renderHook(
      () => {
        const mutation = useMutation({ mutationFn: fn });
        return guardMutation(mutation, false, 'test');
      },
      { wrapper: wrap(false) },
    );

    result.current.mutate('payload');
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(fn.mock.calls[0][0]).toBe('payload');
  });

  it('suppresses mutate calls when readOnly=true', () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(
      () => {
        const mutation = useMutation({ mutationFn: fn });
        return guardMutation(mutation, true, 'test.mutate');
      },
      { wrapper: wrap(true) },
    );

    result.current.mutate('payload');
    expect(fn).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[publicView] mutation suppressed: test.mutate'),
    );
    warnSpy.mockRestore();
  });

  it('suppresses mutateAsync and resolves to undefined when readOnly=true', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(
      () => {
        const mutation = useMutation({ mutationFn: fn });
        return guardMutation(mutation, true, 'test.async');
      },
      { wrapper: wrap(true) },
    );

    const value = await result.current.mutateAsync('payload');
    expect(value).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('PublicViewProvider', () => {
  function Probe() {
    const { readOnly, publicSlug } = usePublicView();
    return (
      <div>
        <span data-testid="ro">{readOnly ? 'yes' : 'no'}</span>
        <span data-testid="slug">{publicSlug ?? ''}</span>
      </div>
    );
  }

  it('propagates readOnly + publicSlug', () => {
    render(
      <PublicViewProvider readOnly publicSlug="kb">
        <Probe />
      </PublicViewProvider>,
    );
    expect(screen.getByTestId('ro').textContent).toBe('yes');
    expect(screen.getByTestId('slug').textContent).toBe('kb');
  });
});
