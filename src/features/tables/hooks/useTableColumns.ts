import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

interface ColumnResponse {
  success: boolean;
  data: Array<{
    id: number;
    table_id: number;
    name: string;
    display_name?: string;
    column_type: string;
    config?: string | null;
    is_required?: number;
    order_index?: number;
    is_visible?: number;
    created_at?: string;
    updated_at?: string;
  }>;
}

// System columns that are always present in tables but not in columns table
const SYSTEM_COLUMNS = [
  { id: '__sys_id', name: 'id', displayName: 'ID', type: 'number' as const, isSystem: true },
  { id: '__sys_base_id', name: 'base_id', displayName: 'Base ID', type: 'text' as const, isSystem: true },
];

export function useTableColumns(tableId: string | undefined, includeSystemColumns = false) {
  return useQuery({
    queryKey: ['table-columns', tableId, includeSystemColumns],
    queryFn: async () => {
      if (!tableId) return [];
      const response = await apiClient.request<ColumnResponse>(`/tables/${tableId}/columns`);
      const columns = response.data.map(col => ({
        id: String(col.id),
        tableId: String(col.table_id),
        name: col.name,
        displayName: col.display_name || col.name,
        type: col.column_type,
        config: col.config ? (typeof col.config === 'string' ? JSON.parse(col.config) : col.config) : {},
        isRequired: Boolean(col.is_required),
        isReadonly: false,
        orderIndex: col.order_index || 0,
        width: 160,
        isVisible: col.is_visible !== 0,
      }));
      
      // Prepend system columns if requested
      if (includeSystemColumns) {
        return [
          ...SYSTEM_COLUMNS.map(sc => ({
            ...sc,
            tableId: tableId,
            config: {},
            isRequired: false,
            isReadonly: true,
            orderIndex: -1,
            width: 80,
            isVisible: true,
          })),
          ...columns
        ];
      }
      
      return columns;
    },
    enabled: Boolean(tableId),
    staleTime: 30000,
  });
}
