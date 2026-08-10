/**
 * useBatchOperations Hook
 * Handles batch operations (move, duplicate, delete, reorder)
 */

import { logger } from '@/shared/utils/logger';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { spaceManagerApi } from '../api/spaceManagerApi';
import { useSpaceManagerStore, selectionToBatchItems } from '../store/spaceManagerStore';
import type { BatchOperation, MoveTarget } from '../types/space-manager.types';

export const useBatchOperations = (spaceId: number | null) => {
  const queryClient = useQueryClient();
  const { selectedItems, deselectAll, closeMoveModal, closeDeleteConfirm } = useSpaceManagerStore();
  
  // Generic batch mutation
  const batchMutation = useMutation({
    mutationFn: async ({ operation, items, target, options }: {
      operation: BatchOperation;
      items: string[];
      target?: MoveTarget;
      options?: { newName?: string; newTitle?: string; includeData?: boolean };
    }) => {
      if (!spaceId) throw new Error('No space selected');
      
      const batchItems = items.map(id => {
        const [type, numId] = id.split(':');
        return { type: type as 'project' | 'folder' | 'table' | 'widget', id: parseInt(numId, 10) };
      });
      
      logger.debug('[BatchOps] Operation:', operation, 'Items:', batchItems, 'Target:', target);
      
      return spaceManagerApi.batch(spaceId, {
        operation,
        items: batchItems,
        target: target ? { project_id: target.projectId, folder_id: target.folderId } : undefined,
        options
      });
    },
    onSuccess: (result, variables) => {
      const successCount = result.success.length;
      const failCount = result.failed.length;
      
      if (successCount > 0) {
        const actionVerb = {
          move: 'moved',
          duplicate: 'duplicated',
          delete: 'deleted',
          reorder: 'reordered'
        }[variables.operation];
        
        toast.success(`${successCount} item${successCount > 1 ? 's' : ''} ${actionVerb}`);
      }
      
      if (failCount > 0) {
        toast.error(`${failCount} item${failCount > 1 ? 's' : ''} failed`);
      }
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['space-tree', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      
      // Clean up UI state
      deselectAll();
      closeMoveModal();
      closeDeleteConfirm();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Operation failed');
    }
  });
  
  // Move items
  const moveItems = (items: string[], target: MoveTarget) => {
    return batchMutation.mutateAsync({ operation: 'move', items, target });
  };
  
  // Duplicate items
  const duplicateItems = (items: string[], options?: { newName?: string }) => {
    return batchMutation.mutateAsync({ operation: 'duplicate', items, options });
  };
  
  // Delete items
  const deleteItems = (items: string[]) => {
    return batchMutation.mutateAsync({ operation: 'delete', items });
  };
  
  // Reorder items
  const reorderItems = (items: { id: string; order_index: number }[]) => {
    const batchItems = items.map(item => {
      const [type, numId] = item.id.split(':');
      return { 
        type: type as 'project' | 'folder' | 'table' | 'widget', 
        id: parseInt(numId, 10),
        order_index: item.order_index
      };
    });
    
    return spaceManagerApi.batch(spaceId!, {
      operation: 'reorder',
      items: batchItems
    });
  };
  
  // Move selected items
  const moveSelected = (target: MoveTarget) => {
    return moveItems(Array.from(selectedItems), target);
  };
  
  // Delete selected items
  const deleteSelected = () => {
    return deleteItems(Array.from(selectedItems));
  };
  
  return {
    moveItems,
    duplicateItems,
    deleteItems,
    reorderItems,
    moveSelected,
    deleteSelected,
    isLoading: batchMutation.isPending
  };
};

export default useBatchOperations;
