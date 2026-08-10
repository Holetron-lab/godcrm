import { useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/shared/hooks/useToast';
import { tablesApi } from '../api/tablesApi';
import { useTablesStore } from '../store/tablesStore';
import type { BulkReplaceConfig, BulkReplaceResult } from '../types/selection.types';
import type { ColumnModel, RowModel } from '../types/table.types';
import { getTargetRowIds, prepareBatchUpdatePayload } from '../utils/bulkReplaceUtils';
import { BATCH_UPDATE_LIMIT, BATCH_UPDATE_LIMIT_MESSAGE } from '../constants';

/**
 * Thrown by useBulkReplace when the requested batch exceeds BATCH_UPDATE_LIMIT.
 * Callers (e.g. BulkReplaceModal) can `instanceof`-check to render a richer
 * UI; otherwise the message is already user-friendly.
 */
export class BatchLimitExceededError extends Error {
  readonly code = 'BATCH_LIMIT_EXCEEDED' as const;
  readonly limit: number;
  readonly requested: number;
  constructor(requested: number, limit: number = BATCH_UPDATE_LIMIT) {
    super(BATCH_UPDATE_LIMIT_MESSAGE);
    this.name = 'BatchLimitExceededError';
    this.limit = limit;
    this.requested = requested;
  }
}

export interface UseBulkReplaceOptions {
  tableId: string | number | null;
  columns: ColumnModel[];
  rows: RowModel[];
  selectedRowIds: Set<string | number>;
  filteredRowIds: (string | number)[];
  allRowIds: (string | number)[];
}

export interface UseBulkReplaceReturn {
  executeBulkReplace: (config: BulkReplaceConfig) => Promise<BulkReplaceResult>;
  isProcessing: boolean;
}

/**
 * Hook для выполнения массовой замены значений
 */
export function useBulkReplace({
  tableId,
  columns,
  rows,
  selectedRowIds,
  filteredRowIds,
  allRowIds
}: UseBulkReplaceOptions): UseBulkReplaceReturn {
  const queryClient = useQueryClient();
  const updateCell = useTablesStore((state) => state.updateCell);
  
  const mutation = useMutation({
    mutationFn: async (config: BulkReplaceConfig): Promise<BulkReplaceResult> => {
      if (!tableId) {
        throw new Error('Table ID is required');
      }
      
      // Get target row IDs based on scope
      const targetIds = getTargetRowIds(config.targetScope, {
        selected: selectedRowIds,
        filtered: filteredRowIds,
        all: allRowIds
      });
      
      if (targetIds.size === 0) {
        return {
          success: true,
          totalProcessed: 0,
          totalChanged: 0
        };
      }
      
      // Prepare batch update payload
      const updates = prepareBatchUpdatePayload(config, rows, columns, targetIds);

      if (updates.length === 0) {
        return {
          success: true,
          totalProcessed: targetIds.size,
          totalChanged: 0
        };
      }

      // Pre-flight: same cap as backend (BATCH_LIMIT_EXCEEDED). Block before
      // hitting the network so users get a clear error, not a 400.
      if (updates.length > BATCH_UPDATE_LIMIT) {
        throw new BatchLimitExceededError(updates.length);
      }

      // Execute batch update
      const result = await tablesApi.batchUpdateRows(String(tableId), updates);
      
      // Optimistically update local state
      const column = columns.find(c => c.id === config.columnId);
      if (column) {
        for (const update of updates) {
          const newValue = update.data[column.id];
          updateCell(String(tableId), String(update.rowId), column.id, newValue);
        }
      }
      
      return {
        success: result.success,
        totalProcessed: targetIds.size,
        totalChanged: result.updated,
        errors: result.errors
      };
    },
    onSuccess: (result) => {
      if (result.totalChanged > 0) {
        showToast(
          `Успешно изменено ${result.totalChanged} из ${result.totalProcessed} строк`,
          'success'
        );
        // Invalidate queries to refetch data
        queryClient.invalidateQueries({ queryKey: ['rows', tableId] });
      } else {
        showToast('Нет данных для изменения', 'info');
      }
    },
    onError: (error: Error) => {
      logger.error('[useBulkReplace] Error:', error);
      // Recognise both our pre-flight sentinel and the backend's structured
      // BATCH_LIMIT_EXCEEDED response — show the friendly message in both.
      const isLimitError =
        error instanceof BatchLimitExceededError ||
        error.message.includes('BATCH_LIMIT_EXCEEDED') ||
        error.message.includes('Batch size exceeds limit');
      if (isLimitError) {
        showToast(BATCH_UPDATE_LIMIT_MESSAGE, 'error');
      } else {
        showToast(`Ошибка массовой замены: ${error.message}`, 'error');
      }
    }
  });
  
  const executeBulkReplace = useCallback(async (config: BulkReplaceConfig): Promise<BulkReplaceResult> => {
    return mutation.mutateAsync(config);
  }, [mutation]);
  
  return {
    executeBulkReplace,
    isProcessing: mutation.isPending
  };
}
