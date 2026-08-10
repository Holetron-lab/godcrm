import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnMapping, ColumnMappingDefaults } from '../types/columnMapping.types';

export const columnMappingService = {
  async getDefaults(): Promise<ColumnMappingDefaults> {
    const response = await apiClient.get<{ data: ColumnMappingDefaults }>('/column-mapping/defaults');
    return response.data;
  },

  async getMapping(tableId: number): Promise<ColumnMapping> {
    const response = await apiClient.get<{ data: ColumnMapping }>(`/column-mapping/${tableId}`);
    return response.data;
  },

  async saveMapping(tableId: number, mappings: Record<string, string>): Promise<ColumnMapping> {
    const response = await apiClient.post<{ data: ColumnMapping }>(`/column-mapping/${tableId}`, { mappings });
    return response.data;
  },
};
