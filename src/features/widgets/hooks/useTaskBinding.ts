/**
 * useTaskBinding Hook - ADR-038
 * 
 * React hook for managing task bindings in documents
 * 
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import {
  linkTaskToItem,
  createTaskFromItem,
  unlinkTaskFromItem,
  exportItemsToTasks,
  getItemsWithTasks,
  type CreateTaskFromDocRequest,
  type ExportTasksRequest,
} from '../api/documents-task-binding.api';

// === QUERY KEYS ===

export const TASK_BINDING_KEYS = {
  all: ['task-binding'] as const,
  itemsWithTasks: (projectId: number, docId: number) => 
    [...TASK_BINDING_KEYS.all, 'items-with-tasks', projectId, docId] as const,
};

// === TYPES ===

export interface UseTaskBindingOptions {
  projectId: number;
  documentId: number | null;
  taskTableId?: number;
  enabled?: boolean;
}

// === HOOK ===

export function useTaskBinding(options: UseTaskBindingOptions) {
  const { projectId, documentId, taskTableId, enabled = true } = options;
  const queryClient = useQueryClient();

  // === QUERY: Items with Tasks ===
  const itemsWithTasksQuery = useQuery({
    queryKey: TASK_BINDING_KEYS.itemsWithTasks(projectId, documentId || 0),
    queryFn: () => getItemsWithTasks(projectId, documentId!, taskTableId),
    enabled: enabled && !!documentId,
    staleTime: 30000, // 30 seconds
  });

  // === MUTATION: Link Task ===
  const linkTaskMutation = useMutation({
    mutationFn: async ({ itemId, taskId }: { itemId: number; taskId: number }) => {
      if (!documentId) throw new Error('Document ID is required');
      return linkTaskToItem(projectId, documentId, itemId, taskId);
    },
    onSuccess: () => {
      logger.debug({ projectId, documentId }, '[useTaskBinding] Task linked, invalidating queries');
      // Invalidate items query to refresh
      if (documentId) {
        queryClient.invalidateQueries({ 
          queryKey: TASK_BINDING_KEYS.itemsWithTasks(projectId, documentId) 
        });
      }
    },
    onError: (error) => {
      logger.error({ error }, '[useTaskBinding] Failed to link task');
    },
  });

  // === MUTATION: Create Task ===
  const createTaskMutation = useMutation({
    mutationFn: async ({ itemId, request }: { itemId: number; request: CreateTaskFromDocRequest }) => {
      if (!documentId) throw new Error('Document ID is required');
      return createTaskFromItem(projectId, documentId, itemId, request);
    },
    onSuccess: () => {
      logger.debug({ projectId, documentId }, '[useTaskBinding] Task created, invalidating queries');
      if (documentId) {
        queryClient.invalidateQueries({ 
          queryKey: TASK_BINDING_KEYS.itemsWithTasks(projectId, documentId) 
        });
      }
    },
    onError: (error) => {
      logger.error({ error }, '[useTaskBinding] Failed to create task');
    },
  });

  // === MUTATION: Unlink Task ===
  const unlinkTaskMutation = useMutation({
    mutationFn: async ({ itemId }: { itemId: number }) => {
      if (!documentId) throw new Error('Document ID is required');
      return unlinkTaskFromItem(projectId, documentId, itemId);
    },
    onSuccess: () => {
      logger.debug({ projectId, documentId }, '[useTaskBinding] Task unlinked, invalidating queries');
      if (documentId) {
        queryClient.invalidateQueries({ 
          queryKey: TASK_BINDING_KEYS.itemsWithTasks(projectId, documentId) 
        });
      }
    },
    onError: (error) => {
      logger.error({ error }, '[useTaskBinding] Failed to unlink task');
    },
  });

  // === MUTATION: Bulk Export ===
  const exportTasksMutation = useMutation({
    mutationFn: async (request: ExportTasksRequest) => {
      if (!documentId) throw new Error('Document ID is required');
      return exportItemsToTasks(projectId, documentId, request);
    },
    onSuccess: (result) => {
      logger.info({ 
        projectId, 
        documentId,
        created: result.data.created_count,
        skipped: result.data.skipped_count 
      }, '[useTaskBinding] Bulk export completed');
      
      if (documentId) {
        queryClient.invalidateQueries({ 
          queryKey: TASK_BINDING_KEYS.itemsWithTasks(projectId, documentId) 
        });
      }
    },
    onError: (error) => {
      logger.error({ error }, '[useTaskBinding] Failed to export tasks');
    },
  });

  // === HELPERS ===

  const linkTask = async (itemId: number, taskId: number) => {
    return linkTaskMutation.mutateAsync({ itemId, taskId });
  };

  const createTask = async (itemId: number, request: CreateTaskFromDocRequest) => {
    return createTaskMutation.mutateAsync({ itemId, request });
  };

  const unlinkTask = async (itemId: number) => {
    return unlinkTaskMutation.mutateAsync({ itemId });
  };

  const exportTasks = async (request: ExportTasksRequest) => {
    return exportTasksMutation.mutateAsync(request);
  };

  const refreshItems = () => {
    if (documentId) {
      queryClient.invalidateQueries({ 
        queryKey: TASK_BINDING_KEYS.itemsWithTasks(projectId, documentId) 
      });
    }
  };

  // === RETURN ===

  return {
    // Query data
    itemsWithTasks: itemsWithTasksQuery.data?.data?.items || [],
    linkedCount: itemsWithTasksQuery.data?.data?.linked_count || 0,
    isLoading: itemsWithTasksQuery.isLoading,
    isError: itemsWithTasksQuery.isError,
    error: itemsWithTasksQuery.error,

    // Mutations
    linkTask,
    createTask,
    unlinkTask,
    exportTasks,
    
    // Mutation states
    isLinking: linkTaskMutation.isPending,
    isCreating: createTaskMutation.isPending,
    isUnlinking: unlinkTaskMutation.isPending,
    isExporting: exportTasksMutation.isPending,

    // Helpers
    refreshItems,
  };
}

export default useTaskBinding;
