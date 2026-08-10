import { useCallback, useMemo, useState } from 'react';
import type { SelectionSortMode } from '../types/selection.types';

export interface UseRowSelectionOptions {
  initialSelectedIds?: (string | number)[];
  initialSort?: SelectionSortMode;
}

export interface UseRowSelectionReturn {
  // State
  selectedRowIds: Set<string | number>;
  selectionSort: SelectionSortMode;
  
  // Actions
  toggleRowSelection: (rowId: string | number) => void;
  selectRow: (rowId: string | number) => void;
  deselectRow: (rowId: string | number) => void;
  selectAll: (rowIds: (string | number)[]) => void;
  selectAllFiltered: (filteredRowIds: (string | number)[]) => void;
  clearSelection: () => void;
  setSelectionSort: (sort: SelectionSortMode) => void;
  
  // Computed
  getSelectedCount: () => number;
  isRowSelected: (rowId: string | number) => boolean;
  isAllSelected: (visibleRowIds: (string | number)[]) => boolean;
  isIndeterminate: (visibleRowIds: (string | number)[]) => boolean;
  getSelectionMode: (visibleRowIds: (string | number)[]) => 'none' | 'some' | 'all';
}

/**
 * Hook для управления выделением строк в таблице
 */
export function useRowSelection(options: UseRowSelectionOptions = {}): UseRowSelectionReturn {
  const { initialSelectedIds = [], initialSort = 'default' } = options;
  
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string | number>>(
    () => new Set(initialSelectedIds)
  );
  const [selectionSort, setSelectionSort] = useState<SelectionSortMode>(initialSort);
  
  // Toggle selection for a single row
  const toggleRowSelection = useCallback((rowId: string | number) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);
  
  // Select a single row
  const selectRow = useCallback((rowId: string | number) => {
    setSelectedRowIds(prev => {
      if (prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.add(rowId);
      return next;
    });
  }, []);
  
  // Deselect a single row
  const deselectRow = useCallback((rowId: string | number) => {
    setSelectedRowIds(prev => {
      if (!prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  }, []);
  
  // Select all provided row IDs
  const selectAll = useCallback((rowIds: (string | number)[]) => {
    setSelectedRowIds(new Set(rowIds));
  }, []);
  
  // Select all filtered rows (add to existing selection)
  const selectAllFiltered = useCallback((filteredRowIds: (string | number)[]) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      filteredRowIds.forEach(id => next.add(id));
      return next;
    });
  }, []);
  
  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedRowIds(new Set());
  }, []);
  
  // Get count of selected rows
  const getSelectedCount = useCallback(() => {
    return selectedRowIds.size;
  }, [selectedRowIds]);
  
  // Check if a specific row is selected
  const isRowSelected = useCallback((rowId: string | number) => {
    return selectedRowIds.has(rowId);
  }, [selectedRowIds]);
  
  // Check if all visible rows are selected
  const isAllSelected = useCallback((visibleRowIds: (string | number)[]) => {
    if (visibleRowIds.length === 0) return false;
    return visibleRowIds.every(id => selectedRowIds.has(id));
  }, [selectedRowIds]);
  
  // Check if selection is indeterminate (some but not all selected)
  const isIndeterminate = useCallback((visibleRowIds: (string | number)[]) => {
    if (visibleRowIds.length === 0) return false;
    const selectedCount = visibleRowIds.filter(id => selectedRowIds.has(id)).length;
    return selectedCount > 0 && selectedCount < visibleRowIds.length;
  }, [selectedRowIds]);
  
  // Get selection mode
  const getSelectionMode = useCallback((visibleRowIds: (string | number)[]): 'none' | 'some' | 'all' => {
    if (visibleRowIds.length === 0) return 'none';
    const selectedCount = visibleRowIds.filter(id => selectedRowIds.has(id)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === visibleRowIds.length) return 'all';
    return 'some';
  }, [selectedRowIds]);
  
  return {
    selectedRowIds,
    selectionSort,
    toggleRowSelection,
    selectRow,
    deselectRow,
    selectAll,
    selectAllFiltered,
    clearSelection,
    setSelectionSort,
    getSelectedCount,
    isRowSelected,
    isAllSelected,
    isIndeterminate,
    getSelectionMode,
  };
}
