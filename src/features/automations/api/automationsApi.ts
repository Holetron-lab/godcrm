import { apiClient } from '@/shared/utils/apiClient';

export interface Automation {
  id: string;
  name: string;
  description?: string;
  table_id: number;
  is_active: boolean;
  trigger_type: 'column_change' | 'row_create' | 'row_delete' | 'button_click' | 'schedule';
  trigger_config: Record<string, unknown>;
  action_type: 'webhook' | 'api_sync' | 'update_field' | 'create_row' | 'delete_row' | 'notification' | 'n8n';
  action_config: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  table_name?: string;
}

export interface CreateAutomationPayload {
  name: string;
  description?: string;
  table_id: number;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UpdateAutomationPayload {
  name?: string;
  description?: string;
  trigger_type?: string;
  trigger_config?: Record<string, unknown>;
  action_type?: string;
  action_config?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  is_active?: boolean;
}

export interface AutomationLog {
  id: string;
  automation_id: string;
  status: 'success' | 'error' | 'running';
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  error_message?: string;
}

const unwrap = async <T>(promise: Promise<{ data: T }>) => {
  const response = await promise;
  return response.data;
};

export const automationsApi = {
  // Get automations for a table
  getByTable: async (tableId: number): Promise<Automation[]> => {
    const response = await apiClient.get<{ success: boolean; data: Automation[] }>(
      `/v3/automations/table/${tableId}`
    );
    return response.data;
  },

  // Get automations for a project
  getByProject: async (projectId: number): Promise<Automation[]> => {
    const response = await apiClient.get<{ success: boolean; data: Automation[] }>(
      `/v3/automations/project/${projectId}`
    );
    return response.data;
  },

  // Get single automation
  get: async (id: string, projectId: number): Promise<Automation> => {
    const response = await apiClient.get<{ success: boolean; data: Automation }>(`/v3/automations/${id}?project_id=${projectId}`);
    return response.data;
  },

  // Create automation
  create: async (data: CreateAutomationPayload): Promise<Automation> => {
    const response = await apiClient.post<{ success: boolean; data: Automation }>('/v3/automations', data);
    return response.data;
  },

  // Update automation
  update: async (id: string, data: UpdateAutomationPayload, projectId: number): Promise<Automation> => {
    const response = await apiClient.patch<{ success: boolean; data: Automation }>(`/v3/automations/${id}?project_id=${projectId}`, data);
    return response.data;
  },

  // Delete automation
  delete: async (id: string, projectId: number): Promise<void> => {
    await apiClient.delete(`/v3/automations/${id}?project_id=${projectId}`);
  },

  // Toggle automation active state
  toggle: async (id: string, isActive: boolean, projectId: number): Promise<Automation> => {
    const response = await apiClient.patch<{ success: boolean; data: Automation }>(`/v3/automations/${id}?project_id=${projectId}`, { is_active: isActive });
    return response.data;
  },

  // Execute automation manually
  execute: async (id: string, projectId: number, rowData?: Record<string, unknown>): Promise<AutomationLog> => {
    const response = await apiClient.post<{ success: boolean; data: AutomationLog }>(`/v3/automations/${id}/execute`, { project_id: projectId, rowData });
    return response.data;
  },

  // Get automation logs
  getLogs: async (automationId: string, projectId: number): Promise<AutomationLog[]> => {
    const response = await apiClient.get<{ success: boolean; data: AutomationLog[] }>(
      `/v3/automations/${automationId}/logs?project_id=${projectId}`
    );
    return response.data;
  }
};
