import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { tablesApi } from '../api/tablesApi';
import { useTablesStore } from '../store/tablesStore';
import type { ColumnModel } from '../types/table.types';
import {
  guardMutation,
  useIsPublicReadOnly,
} from '@/features/public/PublicViewContext';

interface VisibilityPayload {
  columnId: string;
  isVisible: boolean;
}

interface WidthPayload {
  columnId: string;
  width: number;
}

interface SettingsPayload {
  columnId: string;
  payload: Partial<ColumnModel>;
}

export const useColumnMutations = (tableId: string | null) => {
  const readOnly = useIsPublicReadOnly();
  const queryClient = useQueryClient();
  const upsertColumn = useTablesStore((state) => state.upsertColumn);
  const setError = useTablesStore((state) => state.setError);

  const mutateColumn = async (columnId: string, payload: Partial<ColumnModel>) => {
    if (!tableId) {
      throw new Error('TableId is required');
    }
    return tablesApi.updateColumn(tableId, columnId, payload);
  };

  const visibilityMutation = useMutation({
    mutationFn: ({ columnId, isVisible }: VisibilityPayload) => mutateColumn(columnId, { isVisible }),
    onSuccess: (column) => {
      if (!tableId) return;
      upsertColumn(tableId, column);
    },
    onError: (error: unknown) => {
      // Silently ignore errors for system tables (they are read-only)
      logger.warn('Column visibility update failed (system table?):', error);
    }
  });

  const widthMutation = useMutation({
    mutationFn: ({ columnId, width }: WidthPayload) => mutateColumn(columnId, { width }),
    onSuccess: (column) => {
      if (!tableId) return;
      upsertColumn(tableId, column);
    },
    onError: (error: unknown) => {
      // Silently ignore errors for system tables (they are read-only)
      logger.warn('Column width update failed (system table?):', error);
    }
  });

  const settingsMutation = useMutation({
    mutationFn: ({ columnId, payload }: SettingsPayload) => mutateColumn(columnId, payload),
    onSuccess: (column) => {
      if (!tableId) return;
      upsertColumn(tableId, column);
      // Update cache directly instead of refetching
      queryClient.setQueryData(['columns', tableId], (old: ColumnModel[] | undefined) => {
        if (!old) return old;
        return old.map(c => c.id === column.id ? column : c);
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Не удалось сохранить настройки столбца';
      setError(message);
    }
  });

  const reorderMutation = useMutation({
    mutationFn: ({ columnId, newIndex }: { columnId: string; newIndex: number }) => 
      mutateColumn(columnId, { orderIndex: newIndex }),
    onSuccess: () => {
      if (!tableId) return;
      // Invalidate columns query to refetch with new order
      queryClient.invalidateQueries({ queryKey: ['columns', tableId] });
    },
    onError: (error: unknown) => {
      logger.warn('Column reorder failed:', error);
    }
  });

  return {
    visibilityMutation: guardMutation(visibilityMutation, readOnly, 'useColumnMutations.visibility'),
    widthMutation: guardMutation(widthMutation, readOnly, 'useColumnMutations.width'),
    settingsMutation: guardMutation(settingsMutation, readOnly, 'useColumnMutations.settings'),
    reorderMutation: guardMutation(reorderMutation, readOnly, 'useColumnMutations.reorder')
  };
};
