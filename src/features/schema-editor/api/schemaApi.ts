import { apiClient } from '@/shared/utils/apiClient';
import type {
  SchemaResponse,
  SaveLayoutRequest,
  CreateTableRequest,
  CreateRelationRequest,
  AccessibleTablesResponse,
} from '../types/schema-editor.types';

export const schemaApi = {
  /**
   * Get complete schema for a space
   * Returns all tables, columns, and saved layout positions
   */
  getSpaceSchema: async (spaceId: number): Promise<SchemaResponse> => {
    const response = await apiClient.get<{ data: SchemaResponse }>(
      `/spaces/${spaceId}/schema`
    );
    return response.data;
  },

  /**
   * Save node positions (layout)
   */
  saveLayout: async (spaceId: number, layout: SaveLayoutRequest): Promise<void> => {
    await apiClient.put(`/spaces/${spaceId}/schema/layout`, layout);
  },

  /**
   * Create table from schema editor
   */
  createTable: async (
    spaceId: number,
    data: CreateTableRequest
  ): Promise<{ id: number }> => {
    const response = await apiClient.post<{ data: { id: number } }>(
      `/spaces/${spaceId}/schema/tables`,
      data
    );
    return response.data;
  },

  /**
   * Create relation between tables
   */
  createRelation: async (data: CreateRelationRequest): Promise<{ id: number }> => {
    const response = await apiClient.post<{ data: { id: number } }>(
      `/schema/relations`,
      data
    );
    return response.data;
  },

  /**
   * Get tables from other spaces (for external tables feature)
   */
  getAccessibleTables: async (): Promise<AccessibleTablesResponse[]> => {
    const response = await apiClient.get<{ data: AccessibleTablesResponse[] }>(
      '/users/me/accessible-tables'
    );
    return response.data;
  },
};
