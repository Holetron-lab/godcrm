// src/shared/hooks/__tests__/useModal.test.ts
// TDD: RED → GREEN → REFACTOR
// ADR-030: DRY Refactoring

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModal } from '../useModal';

describe('useModal', () => {
  describe('Initial state', () => {
    it('starts closed by default', () => {
      const { result } = renderHook(() => useModal());
      expect(result.current.isOpen).toBe(false);
    });

    it('can start open when initialState is true', () => {
      const { result } = renderHook(() => useModal(true));
      expect(result.current.isOpen).toBe(true);
    });
  });

  describe('open()', () => {
    it('sets isOpen to true', () => {
      const { result } = renderHook(() => useModal());
      
      act(() => {
        result.current.open();
      });
      
      expect(result.current.isOpen).toBe(true);
    });

    it('is stable across renders (no new reference)', () => {
      const { result, rerender } = renderHook(() => useModal());
      const openFn = result.current.open;
      
      rerender();
      
      expect(result.current.open).toBe(openFn);
    });
  });

  describe('close()', () => {
    it('sets isOpen to false', () => {
      const { result } = renderHook(() => useModal(true));
      
      act(() => {
        result.current.close();
      });
      
      expect(result.current.isOpen).toBe(false);
    });

    it('is stable across renders', () => {
      const { result, rerender } = renderHook(() => useModal());
      const closeFn = result.current.close;
      
      rerender();
      
      expect(result.current.close).toBe(closeFn);
    });
  });

  describe('toggle()', () => {
    it('toggles from closed to open', () => {
      const { result } = renderHook(() => useModal());
      
      act(() => {
        result.current.toggle();
      });
      
      expect(result.current.isOpen).toBe(true);
    });

    it('toggles from open to closed', () => {
      const { result } = renderHook(() => useModal(true));
      
      act(() => {
        result.current.toggle();
      });
      
      expect(result.current.isOpen).toBe(false);
    });

    it('is stable across renders', () => {
      const { result, rerender } = renderHook(() => useModal());
      const toggleFn = result.current.toggle;
      
      rerender();
      
      expect(result.current.toggle).toBe(toggleFn);
    });
  });

  describe('Integration', () => {
    it('open → close → toggle flow works correctly', () => {
      const { result } = renderHook(() => useModal());
      
      // Start closed
      expect(result.current.isOpen).toBe(false);
      
      // Open
      act(() => result.current.open());
      expect(result.current.isOpen).toBe(true);
      
      // Close
      act(() => result.current.close());
      expect(result.current.isOpen).toBe(false);
      
      // Toggle twice
      act(() => result.current.toggle());
      expect(result.current.isOpen).toBe(true);
      
      act(() => result.current.toggle());
      expect(result.current.isOpen).toBe(false);
    });
  });
});
