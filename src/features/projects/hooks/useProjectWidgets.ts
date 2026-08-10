import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

interface Widget {
  id: number;
  dashboard_id: number;
  title: string;
  icon: string;
  widget_type: 'preset' | 'custom';
  preset_name?: string;
  is_module?: boolean;
  // ADR-065: Module metadata from LEFT JOIN
  module_id?: number | null;
  sidebar_order?: number | null;
  sidebar_icon?: string | null;
  access_level?: 'admin' | 'member' | 'viewer' | null;
  is_pinned?: boolean | null;
  config?: {
    tableId?: string;
    table_id?: string;
    [key: string]: unknown;
  };
}

export function useProjectWidgets(
  projectId: number | null,
  options?: { enabled?: boolean },
) {
  const callerEnabled = options?.enabled ?? true;
  return useQuery({
    queryKey: ['project-widgets', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const response = await apiClient.request<{ data: Widget[] }>(
        `/projects/${projectId}/widgets`
      );
      return response.data;
    },
    enabled: !!projectId && callerEnabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
