import { useMemo } from 'react';
import { useTablesStore } from '../store/tablesStore';

export const useColumnConfig = (tableId: string | null) => {
  const columns = useTablesStore((state) => (tableId ? state.columns[tableId] || [] : []));
  return useMemo(() => columns, [columns]);
};
