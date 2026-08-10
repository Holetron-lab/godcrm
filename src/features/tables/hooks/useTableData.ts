import { useTablesStore } from '../store/tablesStore';
import { useMemo } from 'react';

export const useTableData = (tableId: string | null) => {
  // Subscribe to rowsVersion to ensure updates trigger re-renders
  const rowsVersion = useTablesStore((state) => state.rowsVersion);
  // Get rows for this table
  const rows = useTablesStore((state) => (tableId ? state.rows[tableId] || [] : []));
  
  // Create a new array reference when rowsVersion changes
  // This forces React to see the change even if individual row objects were mutated
  return useMemo(() => {
    return [...rows];
  }, [rows, rowsVersion]);
};
