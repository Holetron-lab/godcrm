/**
 * Space Manager API Client
 * Based on ADR-004: Space Manager XL Modal
 */

import { apiClient } from '@/shared/utils/apiClient';
import type { BatchRequest, BatchResult, Folder, TreeNode } from '../types/space-manager.types';

export const spaceManagerApi = {
  /**
   * Get full tree structure of space
   */
  getTree: async (spaceId: number): Promise<TreeNode[]> => {
    const response = await apiClient.request<{ data: TreeNode[] }>(
      `/spaces/${spaceId}/tree`
    );
    return response.data;
  },
  
  /**
   * Execute batch operation
   */
  batch: async (spaceId: number, request: BatchRequest): Promise<BatchResult> => {
    const response = await apiClient.request<{ data: BatchResult }>(
      `/spaces/${spaceId}/batch`,
      {
        method: 'POST',
        body: JSON.stringify(request)
      }
    );
    return response.data;
  },
  
  /**
   * Create folder
   */
  createFolder: async (projectId: number, data: { 
    name: string; 
    icon?: string; 
    parent_folder_id?: number;
  }): Promise<Folder> => {
    const response = await apiClient.request<{ data: Folder }>(
      `/projects/${projectId}/folders`,
      {
        method: 'POST',
        body: JSON.stringify(data)
      }
    );
    return response.data;
  },
  
  /**
   * Update folder
   */
  updateFolder: async (folderId: number, data: Partial<Folder>): Promise<Folder> => {
    const response = await apiClient.request<{ data: Folder }>(
      `/folders/${folderId}`,
      {
        method: 'PUT',
        body: JSON.stringify(data)
      }
    );
    return response.data;
  },
  
  /**
   * Delete folder
   */
  deleteFolder: async (folderId: number, cascade = false): Promise<void> => {
    await apiClient.request(`/folders/${folderId}?cascade=${cascade}`, {
      method: 'DELETE'
    });
  },
  
  /**
   * Get folders for project
   */
  getFolders: async (projectId: number, flat = false): Promise<Folder[]> => {
    const response = await apiClient.request<{ data: Folder[] }>(
      `/projects/${projectId}/folders?flat=${flat}`
    );
    return response.data;
  }
};
