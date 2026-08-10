import { useMemo } from 'react';
import { useTablesStore } from '../store/tablesStore';

export const useActiveTable = () => {
  const { tables, activeTableId } = useTablesStore((state) => ({
    tables: state.tables,
    activeTableId: state.activeTableId
  }));

  return useMemo(() => tables.find((table) => table.id === activeTableId) ?? null, [tables, activeTableId]);
};
