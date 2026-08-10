import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

export interface Webhook {
  id: number;
  project_id: number;
  table_id: number | null;
  name: string;
  description?: string;
  token: string;
  is_active: boolean;
  auto_create_columns: boolean;
  flatten_payload: boolean;
  created_by: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  table_name?: string;
  table_display_name?: string;
  // Computed
  url?: string;
  totalCalls?: number;
  lastTriggered?: string;
  recentLogs?: WebhookLog[];
}

export interface WebhookLog {
  id: number;
  webhook_id: number;
  payload: string;
  source_ip: string;
  headers?: string;
  status: 'received' | 'processed' | 'error';
  error_message?: string;
  row_id?: number;
  created_at: string;
  processed_at?: string;
}

export interface CreateWebhookDto {
  name: string;
  tableId?: number;
  createNewTable?: boolean;
  newTableName?: string;
  description?: string;
}

// ============================================================================
// Hooks
// ============================================================================

export function useWebhooks(projectId: number) {
  return useQuery({
    queryKey: ['webhooks', projectId],
    queryFn: async () => {
      const response = await apiClient.get(`/api/v3/projects/${projectId}/webhooks`);
      return response.data as Webhook[];
    },
    enabled: !!projectId,
    refetchInterval: 30000, // Refetch every 30s to show new logs
  });
}

export function useWebhookLogs(webhookId: number, limit = 50) {
  return useQuery({
    queryKey: ['webhook-logs', webhookId, limit],
    queryFn: async () => {
      const response = await apiClient.get(`/api/v3/webhooks/${webhookId}/logs?limit=${limit}`);
      return response.data as WebhookLog[];
    },
    enabled: !!webhookId,
    refetchInterval: 10000, // Refetch every 10s
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ projectId, data }: { projectId: number; data: CreateWebhookDto }) => {
      const response = await apiClient.post(`/api/v3/projects/${projectId}/webhooks`, data);
      return response.data as Webhook;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-tables', variables.projectId] });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Webhook> }) => {
      const response = await apiClient.patch(`/api/v3/webhooks/${id}`, data);
      return response.data as Webhook;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/api/v3/webhooks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}
