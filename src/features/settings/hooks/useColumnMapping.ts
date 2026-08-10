import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { columnMappingService } from '../services/columnMappingService';
import { logger } from '@/shared/utils/logger';

export function useColumnMappingDefaults() {
  return useQuery({
    queryKey: ['column-mapping', 'defaults'],
    queryFn: () => columnMappingService.getDefaults(),
  });
}

export function useColumnMapping(tableId: number) {
  return useQuery({
    queryKey: ['column-mapping', tableId],
    queryFn: () => columnMappingService.getMapping(tableId),
    enabled: tableId > 0,
  });
}

export function useSaveColumnMapping(tableId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mappings: Record<string, string>) => 
      columnMappingService.saveMapping(tableId, mappings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['column-mapping', tableId] });
      logger.debug('Column mapping saved', { tableId });
    },
    onError: (error) => {
      logger.error('Failed to save column mapping', { error, tableId });
    },
  });
}
