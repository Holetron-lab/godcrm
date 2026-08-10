import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { tablesApi } from '../api/tablesApi';
import { useTablesStore } from '../store/tablesStore';

export function useDeleteTable() {
  const queryClient = useQueryClient();
  const { tables, setTables, selectTable, activeTableId } = useTablesStore();

  return useMutation({
    mutationFn: (tableId: string) => tablesApi.deleteTable(tableId),
    onSuccess: (_, deletedTableId) => {
      // Find the deleted table to get its project_id
      const deletedTable = tables.find(t => t.id === deletedTableId);
      
      // Remove table from store
      const updatedTables = tables.filter(t => t.id !== deletedTableId);
      setTables(updatedTables);

      // If deleted table was active, clear selection
      if (activeTableId === deletedTableId) {
        selectTable(null);
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      
      // Invalidate project-specific tables query for immediate sidebar update
      if (deletedTable?.projectId) {
        queryClient.invalidateQueries({ queryKey: ['project-tables', deletedTable.projectId] });
      }
    },
    onError: (error) => {
      logger.error('Failed to delete table:', error);
    }
  });
}
