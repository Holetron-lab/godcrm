import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { DataSource, CreateDataSourceDto, UpdateDataSourceDto, TestConnectionResult } from '../types/dataSource.types';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export const dataSourcesApi = {
  list: async (workspaceId: string): Promise<DataSource[]> => {
    const result = await apiClient.request<ApiResponse<DataSource[]>>(
      `/data-sources?workspace_id=${workspaceId}`
    );
    return result.data || [];
  },

  get: async (id: string): Promise<DataSource> => {
    const result = await apiClient.request<ApiResponse<DataSource>>(
      `/data-sources/${id}`
    );
    if (!result.data) {
      throw new Error('Data source not found');
    }
    return result.data;
  },

  create: async (data: CreateDataSourceDto): Promise<DataSource> => {
    logger.debug('[dataSourcesApi.create] Sending request:', data);
    const result = await apiClient.request<ApiResponse<DataSource>>(
      '/data-sources',
      {
        method: 'POST',
        body: JSON.stringify(data)
      }
    );
    logger.debug('[dataSourcesApi.create] Response:', result);
    if (!result.data) {
      throw new Error('Failed to create data source - no data in response');
    }
    return result.data;
  },

  update: async (id: string, data: Partial<CreateDataSourceDto>): Promise<DataSource> => {
    const result = await apiClient.request<ApiResponse<DataSource>>(
      `/data-sources/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(data)
      }
    );
    if (!result.data) {
      throw new Error('Failed to update data source');
    }
    return result.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.request<void>(
      `/data-sources/${id}`,
      { method: 'DELETE' }
    );
  },

  test: async (id: string): Promise<TestConnectionResult> => {
    try {
      const result = await apiClient.request<ApiResponse<TestConnectionResult>>(
        `/data-sources/${id}/test`,
        { method: 'POST' }
      );
      return result.data || { success: false, message: 'Unknown error' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  },

  listTables: async (id: string): Promise<Array<{ name: string; type: string }>> => {
    const result = await apiClient.request<ApiResponse<Array<{ name: string; type: string }>>>(
      `/data-sources/${id}/tables`
    );
    return result.data || [];
  },

  listTableColumns: async (id: string, tableName: string): Promise<Array<{ name: string; type: string }>> => {
    const result = await apiClient.request<ApiResponse<Array<{ name: string; type: string }>>>(
      `/data-sources/${id}/tables/${encodeURIComponent(tableName)}/columns`
    );
    return result.data || [];
  }
};
