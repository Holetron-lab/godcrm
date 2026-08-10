import { apiClient } from '@/shared/utils/apiClient';

export interface ApiKey {
  id: number;
  key_prefix: string;
  name: string;
  scopes: string[];
  rate_limit: number;
  last_used_at: string | null;
  request_count: number;
  expires_at: string | null;
  is_active: number;
  created_at: string;
  project_id?: number;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes?: string[];
  expires_in_days?: number;
  rate_limit?: number;
  project_id?: number;
  agent_id?: number;
}

export interface CreateApiKeyResponse {
  id: number;
  key: string; // Full key, only shown once!
  key_prefix: string;
  name: string;
  scopes: string[];
  rate_limit: number;
  expires_at: string | null;
  created_at: string;
}

export const apiKeysApi = {
  /**
   * List all API keys for a project
   */
  list: async (projectId?: number): Promise<ApiKey[]> => {
    const params = projectId ? `?project_id=${projectId}` : '';
    const response = await apiClient.get<{ success: boolean; data: ApiKey[] }>(`/api-keys${params}`);
    return response.data || [];
  },

  /**
   * Create a new API key
   */
  create: async (data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> => {
    const response = await apiClient.post<{ success: boolean; data: CreateApiKeyResponse }>('/api-keys', data);
    return response.data;
  },

  /**
   * Update an API key
   */
  update: async (id: number, data: Partial<Pick<ApiKey, 'name' | 'scopes' | 'is_active' | 'rate_limit'>>): Promise<ApiKey> => {
    const response = await apiClient.patch<{ success: boolean; data: ApiKey }>(`/api-keys/${id}`, data);
    return response.data;
  },

  /**
   * Delete (revoke) an API key
   */
  delete: async (id: number, projectId?: number): Promise<void> => {
    const params = projectId ? `?project_id=${projectId}` : '';
    await apiClient.delete(`/api-keys/${id}${params}`);
  },

  /**
   * Regenerate an API key
   */
  regenerate: async (id: number, projectId?: number): Promise<CreateApiKeyResponse> => {
    const response = await apiClient.post<{ success: boolean; data: CreateApiKeyResponse }>(`/api-keys/${id}/regenerate`, { project_id: projectId });
    return response.data;
  },
};
