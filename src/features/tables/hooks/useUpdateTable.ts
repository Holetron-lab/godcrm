import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { tablesApi } from '../api/tablesApi';
import toast from 'react-hot-toast';

interface UpdateTableData {
  name?: string;
  displayName?: string;
  icon?: string | null;
  description?: string;
}

export function useUpdateTable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ tableId, data }: { tableId: string; data: UpdateTableData }) => 
      tablesApi.updateTable(tableId, data),
    onSuccess: (updatedTable) => {
      // Invalidate queries for immediate UI update
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['project-tables'] });
      
      if (updatedTable.projectId) {
        queryClient.invalidateQueries({ queryKey: ['project-tables', updatedTable.projectId] });
        queryClient.invalidateQueries({ queryKey: ['project-tables', String(updatedTable.projectId)] });
      }
      
      toast.success('Таблица обновлена');
    },
    onError: (error) => {
      logger.error('Failed to update table:', error);
      toast.error('Ошибка обновления таблицы');
    }
  });
}
