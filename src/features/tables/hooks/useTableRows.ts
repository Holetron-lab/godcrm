import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

interface RowsResponse {
  success: boolean;
  data: {
    rows: Array<{
      id: number;
      table_id: number;
      data: string;
      created_at: string;
      updated_at: string;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  };
}

export function useTableRows(tableId: string | undefined) {
  return useQuery({
    queryKey: ['table-rows', tableId],
    queryFn: async () => {
      if (!tableId) return [];
      const response = await apiClient.request<RowsResponse>(`/tables/${tableId}/rows`);
      return response.data.rows.map(row => ({
        id: String(row.id),
        tableId: String(row.table_id),
        data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },
    enabled: Boolean(tableId),
    staleTime: 10000,
  });
}
