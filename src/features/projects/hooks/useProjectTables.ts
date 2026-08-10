import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

interface Table {
  id: string;
  project_id: number;
  name: string;
  displayName?: string;
  sourceName?: string; // Original table name (key) - sync_target for system tables, snake_case for internal
  icon?: string;
  description?: string;
  parent_table_id?: number | null;
  sync_target?: string | null;
  data_source_id?: number | null;
  data_source_name?: string | null;
  source_table_name?: string | null;
  show_in_nav?: number | null;
  display_name?: string;
}

// Convert display name to snake_case key
const toSnakeCase = (str: string): string => {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
};

export function useProjectTables(projectId: number | null) {
  return useQuery({
    queryKey: ['project-tables', projectId],
    queryFn: async () => {
      if (!projectId) {
        return [];
      }
      const response = await apiClient.request<{ data: Array<Table & { id: number; display_name?: string }> }>(
        `/projects/${projectId}/tables`
      );
      // Convert id to string for consistency
      // sourceName priority:
      // 1. sync_target (for system tables like users, projects)
      // 2. source_table_name (for external tables)
      // 3. snake_case of name (for internal user tables)
      return response.data.map(t => ({ 
        ...t, 
        id: String(t.id),
        displayName: t.display_name || t.name,
        sourceName: t.sync_target || t.source_table_name || toSnakeCase(t.name)
      }));
    },
    enabled: !!projectId,
    staleTime: 1000 * 30, // 30 seconds - refresh more often for new tables
  });
}
