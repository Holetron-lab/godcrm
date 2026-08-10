import { describe, test, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRowSelection } from '../useRowSelection';

describe('useRowSelection', () => {
  describe('toggleRowSelection', () => {
    test('adds row to selection when not selected', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.toggleRowSelection('row-1');
      });
      
      expect(result.current.isRowSelected('row-1')).toBe(true);
      expect(result.current.getSelectedCount()).toBe(1);
    });
    
    test('removes row from selection when already selected', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.toggleRowSelection('row-1');
      });
      
      expect(result.current.isRowSelected('row-1')).toBe(true);
      
      act(() => {
        result.current.toggleRowSelection('row-1');
      });
      
      expect(result.current.isRowSelected('row-1')).toBe(false);
      expect(result.current.getSelectedCount()).toBe(0);
    });
    
    test('handles multiple row selections', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.toggleRowSelection('row-1');
        result.current.toggleRowSelection('row-2');
        result.current.toggleRowSelection('row-3');
      });
      
      expect(result.current.getSelectedCount()).toBe(3);
      expect(result.current.isRowSelected('row-1')).toBe(true);
      expect(result.current.isRowSelected('row-2')).toBe(true);
      expect(result.current.isRowSelected('row-3')).toBe(true);
    });
  });
  
  describe('selectAll', () => {
    test('selects all provided row IDs', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.selectAll(['row-1', 'row-2', 'row-3']);
      });
      
      expect(result.current.getSelectedCount()).toBe(3);
      expect(result.current.isRowSelected('row-1')).toBe(true);
      expect(result.current.isRowSelected('row-2')).toBe(true);
      expect(result.current.isRowSelected('row-3')).toBe(true);
    });
    
    test('replaces existing selection', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.toggleRowSelection('old-row');
      });
      
      expect(result.current.isRowSelected('old-row')).toBe(true);
      
      act(() => {
        result.current.selectAll(['new-row-1', 'new-row-2']);
      });
      
      expect(result.current.isRowSelected('old-row')).toBe(false);
      expect(result.current.isRowSelected('new-row-1')).toBe(true);
      expect(result.current.isRowSelected('new-row-2')).toBe(true);
      expect(result.current.getSelectedCount()).toBe(2);
    });
  });
  
  describe('selectAllFiltered', () => {
    test('adds filtered rows to existing selection', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.toggleRowSelection('existing-row');
      });
      
      act(() => {
        result.current.selectAllFiltered(['filtered-1', 'filtered-2']);
      });
      
      expect(result.current.isRowSelected('existing-row')).toBe(true);
      expect(result.current.isRowSelected('filtered-1')).toBe(true);
      expect(result.current.isRowSelected('filtered-2')).toBe(true);
      expect(result.current.getSelectedCount()).toBe(3);
    });
  });
  
  describe('clearSelection', () => {
    test('removes all selections', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.selectAll(['row-1', 'row-2', 'row-3']);
      });
      
      expect(result.current.getSelectedCount()).toBe(3);
      
      act(() => {
        result.current.clearSelection();
      });
      
      expect(result.current.getSelectedCount()).toBe(0);
      expect(result.current.isRowSelected('row-1')).toBe(false);
    });
  });
  
  describe('isAllSelected', () => {
    test('returns true when all visible rows are selected', () => {
      const { result } = renderHook(() => useRowSelection());
      const visibleRows = ['row-1', 'row-2', 'row-3'];
      
      act(() => {
        result.current.selectAll(visibleRows);
      });
      
      expect(result.current.isAllSelected(visibleRows)).toBe(true);
    });
    
    test('returns false when not all visible rows are selected', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.toggleRowSelection('row-1');
        result.current.toggleRowSelection('row-2');
      });
      
      expect(result.current.isAllSelected(['row-1', 'row-2', 'row-3'])).toBe(false);
    });
    
    test('returns false for empty visible rows', () => {
      const { result } = renderHook(() => useRowSelection());
      
      expect(result.current.isAllSelected([])).toBe(false);
    });
  });
  
  describe('isIndeterminate', () => {
    test('returns true when some but not all rows are selected', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.toggleRowSelection('row-1');
      });
      
      expect(result.current.isIndeterminate(['row-1', 'row-2', 'row-3'])).toBe(true);
    });
    
    test('returns false when all rows are selected', () => {
      const { result } = renderHook(() => useRowSelection());
      const visibleRows = ['row-1', 'row-2', 'row-3'];
      
      act(() => {
        result.current.selectAll(visibleRows);
      });
      
      expect(result.current.isIndeterminate(visibleRows)).toBe(false);
    });
    
    test('returns false when no rows are selected', () => {
      const { result } = renderHook(() => useRowSelection());
      
      expect(result.current.isIndeterminate(['row-1', 'row-2', 'row-3'])).toBe(false);
    });
  });
  
  describe('getSelectionMode', () => {
    test('returns "none" when no rows are selected', () => {
      const { result } = renderHook(() => useRowSelection());
      
      expect(result.current.getSelectionMode(['row-1', 'row-2'])).toBe('none');
    });
    
    test('returns "some" when some rows are selected', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.toggleRowSelection('row-1');
      });
      
      expect(result.current.getSelectionMode(['row-1', 'row-2'])).toBe('some');
    });
    
    test('returns "all" when all rows are selected', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.selectAll(['row-1', 'row-2']);
      });
      
      expect(result.current.getSelectionMode(['row-1', 'row-2'])).toBe('all');
    });
  });
  
  describe('selectionSort', () => {
    test('defaults to "default"', () => {
      const { result } = renderHook(() => useRowSelection());
      
      expect(result.current.selectionSort).toBe('default');
    });
    
    test('can be changed to "selected-first"', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.setSelectionSort('selected-first');
      });
      
      expect(result.current.selectionSort).toBe('selected-first');
    });
    
    test('can be changed to "selected-last"', () => {
      const { result } = renderHook(() => useRowSelection());
      
      act(() => {
        result.current.setSelectionSort('selected-last');
      });
      
      expect(result.current.selectionSort).toBe('selected-last');
    });
  });
  
  describe('initial options', () => {
    test('accepts initial selected IDs', () => {
      const { result } = renderHook(() => useRowSelection({
        initialSelectedIds: ['row-1', 'row-2']
      }));
      
      expect(result.current.getSelectedCount()).toBe(2);
      expect(result.current.isRowSelected('row-1')).toBe(true);
      expect(result.current.isRowSelected('row-2')).toBe(true);
    });
    
    test('accepts initial sort mode', () => {
      const { result } = renderHook(() => useRowSelection({
        initialSort: 'selected-first'
      }));
      
      expect(result.current.selectionSort).toBe('selected-first');
    });
  });
});
