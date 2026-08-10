// src/shared/hooks/__tests__/useAsync.test.ts
// TDD: RED → GREEN → REFACTOR
// ADR-030: DRY Refactoring - Phase 2

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsync } from '../useAsync';

describe('useAsync', () => {
  describe('Initial state', () => {
    it('starts with loading=false, data=null, error=null', () => {
      const { result } = renderHook(() => useAsync());
      
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBe(null);
      expect(result.current.error).toBe(null);
    });

    it('accepts initial data value', () => {
      const { result } = renderHook(() => useAsync({ initialData: 'initial' }));
      
      expect(result.current.data).toBe('initial');
    });
  });

  describe('execute()', () => {
    it('sets loading=true while async function is running', async () => {
      const asyncFn = vi.fn(() => new Promise(resolve => setTimeout(() => resolve('done'), 50)));
      const { result } = renderHook(() => useAsync<string>());

      act(() => {
        result.current.execute(asyncFn);
      });

      expect(result.current.loading).toBe(true);
      
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('sets data on successful completion', async () => {
      const asyncFn = vi.fn(() => Promise.resolve({ id: 1, name: 'Test' }));
      const { result } = renderHook(() => useAsync<{ id: number; name: string }>());

      await act(async () => {
        await result.current.execute(asyncFn);
      });

      expect(result.current.data).toEqual({ id: 1, name: 'Test' });
      expect(result.current.error).toBe(null);
      expect(result.current.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const asyncFn = vi.fn(() => Promise.reject(new Error('Network error')));
      const { result } = renderHook(() => useAsync<string>());

      await act(async () => {
        await result.current.execute(asyncFn);
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.data).toBe(null);
      expect(result.current.loading).toBe(false);
    });

    it('returns the result of async function', async () => {
      const asyncFn = vi.fn(() => Promise.resolve(42));
      const { result } = renderHook(() => useAsync<number>());

      let returnValue: number | undefined;
      await act(async () => {
        returnValue = await result.current.execute(asyncFn);
      });

      expect(returnValue).toBe(42);
    });

    it('clears previous error on new execute', async () => {
      const failingFn = vi.fn(() => Promise.reject(new Error('First error')));
      const successFn = vi.fn(() => Promise.resolve('success'));
      const { result } = renderHook(() => useAsync<string>());

      // First call fails
      await act(async () => {
        await result.current.execute(failingFn);
      });
      expect(result.current.error).toBe('First error');

      // Second call succeeds, error should be cleared
      await act(async () => {
        await result.current.execute(successFn);
      });
      expect(result.current.error).toBe(null);
      expect(result.current.data).toBe('success');
    });
  });

  describe('reset()', () => {
    it('resets state to initial values', async () => {
      const asyncFn = vi.fn(() => Promise.resolve('data'));
      const { result } = renderHook(() => useAsync<string>());

      await act(async () => {
        await result.current.execute(asyncFn);
      });
      expect(result.current.data).toBe('data');

      act(() => {
        result.current.reset();
      });

      expect(result.current.data).toBe(null);
      expect(result.current.error).toBe(null);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('setData()', () => {
    it('allows manual data update', () => {
      const { result } = renderHook(() => useAsync<string>());

      act(() => {
        result.current.setData('manual data');
      });

      expect(result.current.data).toBe('manual data');
    });
  });

  describe('setError()', () => {
    it('allows manual error setting', () => {
      const { result } = renderHook(() => useAsync<string>());

      act(() => {
        result.current.setError('Manual error');
      });

      expect(result.current.error).toBe('Manual error');
    });
  });

  describe('Function reference stability', () => {
    it('execute, reset, setData, setError are stable across renders', () => {
      const { result, rerender } = renderHook(() => useAsync<string>());
      
      const { execute, reset, setData, setError } = result.current;
      
      rerender();
      
      expect(result.current.execute).toBe(execute);
      expect(result.current.reset).toBe(reset);
      expect(result.current.setData).toBe(setData);
      expect(result.current.setError).toBe(setError);
    });
  });
});
