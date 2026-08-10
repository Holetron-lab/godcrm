/**
 * Documents Task Binding API - ADR-038
 * 
 * API functions for linking documents to tasks
 * 
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */

import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import type { LinkedTaskData } from '../types/documents.types';

// === TYPES ===

export interface LinkTaskRequest {
  task_id: number;
}

export interface LinkTaskResponse {
  success: boolean;
  data: {
    item_id: number;
    task_ref: number;
    previous_task_ref: number | null;
  };
  timestamp: string;
}

export interface CreateTaskFromDocRequest {
  table_id: number;
  data: {
    title: string;
    description?: string;
    status?: string;
    due_date?: string;
    priority?: string;
  };
}

export interface CreateTaskFromDocResponse {
  success: boolean;
  data: {
    task_id: number;
    item_id: number;
    task_ref: number;
    base_id: string;
  };
  timestamp: string;
}

export interface UnlinkTaskResponse {
  success: boolean;
  data: {
    item_id: number;
    previous_task_ref: number;
  };
  timestamp: string;
}

export interface ExportTasksRequest {
  table_id: number;
  item_ids: number[];
  options?: {
    include_content?: boolean;
    default_status?: string;
    default_priority?: string;
    skip_linked?: boolean;
  };
}

export interface ExportTasksResponse {
  success: boolean;
  data: {
    created_count: number;
    skipped_count: number;
    error_count: number;
    created: Array<{ item_id: number; task_id: number; title: string }>;
    skipped: Array<{ item_id: number; reason: string; task_ref?: number }>;
    errors: Array<{ item_id: number; reason: string }>;
  };
  timestamp: string;
}

export interface GetItemsWithTasksResponse {
  success: boolean;
  data: {
    document_id: number;
    table_id: number;
    items: Array<{
      id: number;
      order: number;
      level: string;
      content_en?: string;
      content?: string;
      task_ref?: number | null;
      linked_task: LinkedTaskData | null;
    }>;
    count: number;
    linked_count: number;
  };
  timestamp: string;
}

// === API FUNCTIONS ===

/**
 * Link an existing task to a document item
 */
export async function linkTaskToItem(
  projectId: number,
  docId: number,
  itemId: number,
  taskId: number
): Promise<LinkTaskResponse> {
  logger.debug({ projectId, docId, itemId, taskId }, '[TaskBindingAPI] Linking task');
  
  return apiClient.request<LinkTaskResponse>(
    `/projects/${projectId}/documents/${docId}/items/${itemId}/link-task`,
    {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId }),
    }
  );
}

/**
 * Create a new task from a document item and link it
 */
export async function createTaskFromItem(
  projectId: number,
  docId: number,
  itemId: number,
  request: CreateTaskFromDocRequest
): Promise<CreateTaskFromDocResponse> {
  logger.debug({ projectId, docId, itemId, tableId: request.table_id }, '[TaskBindingAPI] Creating task from item');
  
  return apiClient.request<CreateTaskFromDocResponse>(
    `/projects/${projectId}/documents/${docId}/items/${itemId}/create-task`,
    {
      method: 'POST',
      body: JSON.stringify(request),
    }
  );
}

/**
 * Unlink a task from a document item (does NOT delete the task)
 */
export async function unlinkTaskFromItem(
  projectId: number,
  docId: number,
  itemId: number
): Promise<UnlinkTaskResponse> {
  logger.debug({ projectId, docId, itemId }, '[TaskBindingAPI] Unlinking task');
  
  return apiClient.request<UnlinkTaskResponse>(
    `/projects/${projectId}/documents/${docId}/items/${itemId}/unlink-task`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * Bulk export multiple document items to tasks
 */
export async function exportItemsToTasks(
  projectId: number,
  docId: number,
  request: ExportTasksRequest
): Promise<ExportTasksResponse> {
  logger.debug({ 
    projectId, 
    docId, 
    tableId: request.table_id, 
    itemCount: request.item_ids.length 
  }, '[TaskBindingAPI] Exporting items to tasks');
  
  return apiClient.request<ExportTasksResponse>(
    `/projects/${projectId}/documents/${docId}/export-tasks`,
    {
      method: 'POST',
      body: JSON.stringify(request),
    }
  );
}

/**
 * Get document items enriched with linked task data
 */
export async function getItemsWithTasks(
  projectId: number,
  docId: number,
  taskTableId?: number
): Promise<GetItemsWithTasksResponse> {
  logger.debug({ projectId, docId, taskTableId }, '[TaskBindingAPI] Fetching items with tasks');
  
  const params = taskTableId ? `?task_table_id=${taskTableId}` : '';
  
  return apiClient.request<GetItemsWithTasksResponse>(
    `/projects/${projectId}/documents/${docId}/items/with-tasks${params}`,
    {
      method: 'GET',
    }
  );
}
