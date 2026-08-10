import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { dataSourcesApi } from '../api/dataSourcesApi';
import { CreateDataSourceDto } from '../types/dataSource.types';
import toast from 'react-hot-toast';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const QUERY_KEY = 'data-sources';

/**
 * Hook to fetch all data sources for a workspace
 */
export function useDataSources(workspaceId: string) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [QUERY_KEY, workspaceId],
    queryFn: () => dataSourcesApi.list(workspaceId),
    enabled: !!workspaceId
  });

  return {
    dataSources: data || [],
    loading: isLoading,
    error,
    refetch
  };
}

/**
 * Hook to fetch a single data source
 */
export function useDataSource(id: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: [QUERY_KEY, id],
    queryFn: () => dataSourcesApi.get(id),
    enabled: !!id
  });

  return {
    dataSource: data,
    loading: isLoading,
    error
  };
}

/**
 * Hook to create a new data source
 */
export function useCreateDataSource() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  return useMutation({
    mutationFn: (data: CreateDataSourceDto) => {
      logger.debug('[useCreateDataSource] Creating data source:', data);
      return dataSourcesApi.create(data);
    },
    onSuccess: (result, variables) => {
      logger.debug('[useCreateDataSource] Success:', result);
      // Invalidate data sources list
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, variables.workspace_id] });
      // Invalidate project tables to show newly imported tables in sidebar
      queryClient.invalidateQueries({ queryKey: ['project-tables', variables.workspace_id] });
      // Also invalidate with string version of workspace_id
      queryClient.invalidateQueries({ queryKey: ['project-tables'] });
      toast.success(t('dataSources.messages.createSuccess'));
    },
    onError: (error: Error) => {
      logger.error('[useCreateDataSource] Error:', error);
      toast.error(error.message);
    }
  });
}

/**
 * Hook to update a data source
 */
export function useUpdateDataSource() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateDataSourceDto> }) =>
      dataSourcesApi.update(id, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, result.workspace_id] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, result.id] });
      toast.success(t('dataSources.messages.updateSuccess'));
    },
    onError: (error: Error) => {
      toast.error(error.message);
    }
  });
}

/**
 * Hook to delete a data source
 */
export function useDeleteDataSource() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  return useMutation({
    mutationFn: ({ id, workspaceId }: { id: string; workspaceId: string }) =>
      dataSourcesApi.delete(id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, variables.workspaceId] });
      toast.success(t('dataSources.messages.deleteSuccess'));
    },
    onError: (error: Error) => {
      toast.error(error.message);
    }
  });
}

/**
 * Hook to test connection to a data source
 */
export function useTestConnection() {
  const { t } = useLanguage();

  return useMutation({
    mutationFn: (id: string) => dataSourcesApi.test(id),
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t('dataSources.messages.testSuccess'));
      } else {
        toast.error(result.message || t('dataSources.messages.testFailed'));
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    }
  });
}
