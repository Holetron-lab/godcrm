import { useQuery } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { dataSourcesApi } from '../api/dataSourcesApi';
import type { DataSourceTable, LinkedTable } from '../types/dataSource.types';

/**
 * Hook to fetch tables from an external data source (MySQL/PostgreSQL)
 * Returns raw table list from the external database
 */
export function useDataSourceTables(dataSourceId: string | null) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['data-source-tables', dataSourceId],
    queryFn: async () => {
      if (!dataSourceId) return [];
      
      logger.debug('[useDataSourceTables] Fetching tables for data source', { dataSourceId });
      
      const tables = await dataSourcesApi.listTables(dataSourceId);
      
      logger.debug('[useDataSourceTables] Response', { 
        dataSourceId, 
        tablesCount: tables.length,
        tables: tables.map(t => t.name)
      });
      
      return tables;
    },
    enabled: !!dataSourceId
  });

  return {
    tables: data || [],
    loading: isLoading,
    error,
    refetch
  };
}

/**
 * Hook to fetch CRM tables linked to a data source
 * Returns tables that have been imported into CRM from this data source
 */
export function useLinkedTables(dataSourceId: string | null) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['linked-tables', dataSourceId],
    queryFn: async () => {
      if (!dataSourceId) return { mainTable: null, linkedTables: [], total: 0 };
      
      logger.debug('[useLinkedTables] Fetching linked tables', { dataSourceId });
      
      // Fetch from tables API - filter by data_source_id
      const response = await fetch(`/api/v3/tables?data_source_id=${dataSourceId}`, {
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch linked tables');
      }
      
      const result = await response.json();
      const tables: LinkedTable[] = result.data || [];
      
      // Find main table (first one or marked as main)
      const mainTable = tables.find(t => t.is_main) || tables[0] || null;
      const linkedTables = tables.filter(t => t.id !== mainTable?.id);
      
      logger.debug('[useLinkedTables] Response', { 
        dataSourceId,
        mainTable: mainTable?.name,
        linkedTablesCount: linkedTables.length,
        total: tables.length
      });
      
      return {
        mainTable,
        linkedTables,
        total: tables.length
      };
    },
    enabled: !!dataSourceId
  });

  return {
    mainTable: data?.mainTable || null,
    linkedTables: data?.linkedTables || [],
    total: data?.total || 0,
    loading: isLoading,
    error,
    refetch
  };
}
