import { useQuery } from '@tanstack/react-query';
import { dataSourcesApi } from '../api/dataSourcesApi';

export function useDataSource(id: string) {
  return useQuery({
    queryKey: ['dataSource', id],
    queryFn: () => dataSourcesApi.get(id),
    enabled: !!id
  });
}
