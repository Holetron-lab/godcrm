import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

interface TableResponse {
  success: boolean;
  data: {
    id: number;
    project_id: number;
    name: string;
    icon?: string;
    description?: string;
    is_system?: number;
    created_at: string;
    updated_at: string;
  };
}

export function useTableById(tableId: string | undefined) {
  return useQuery({
    queryKey: ['table', tableId],
    queryFn: async () => {
      if (!tableId) return null;
      const response = await apiClient.request<TableResponse>(`/tables/${tableId}`);
      return response.data;
    },
    enabled: Boolean(tableId),
    staleTime: 30000,
  });
}
