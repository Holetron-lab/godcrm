import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { tablesApi } from '../api/tablesApi';
import { useTablesStore } from '../store/tablesStore';
import type { CreateTablePayload } from '../types/table.types';

export const useCreateTable = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const addTable = useTablesStore((state) => state.addTable);
  const setColumns = useTablesStore((state) => state.setColumns);
  const selectTable = useTablesStore((state) => state.selectTable);
  const setError = useTablesStore((state) => state.setError);

  return useMutation({
    mutationFn: (payload: CreateTablePayload) => tablesApi.createTable(payload),
    onSuccess: ({ table, columns }) => {
      addTable(table);
      setColumns(table.id, columns);
      selectTable(table.id);
      
      // Invalidate project-tables cache to update sidebar immediately
      if (table.projectId) {
        queryClient.invalidateQueries({ queryKey: ['project-tables', table.projectId] });
      }
      
      // Navigate to the new table
      navigate(`/tables/${table.id}`);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Не удалось создать таблицу';
      setError(message);
    }
  });
};
