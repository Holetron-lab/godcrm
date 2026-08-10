import { apiClient } from '@/shared/utils/apiClient';

export interface ProjectModel {
  id: number;
  space_id: number;
  name: string;
  description?: string;
  icon?: string;
  primary_table_id?: number | null;
  type?: string;
  owner_id: number;
  theme_primary?: string;
  theme_secondary?: string;
  theme_tertiary?: string;
  settings?: Record<string, unknown>;
  is_public?: boolean;
  created_at: string;
  updated_at: string;
  
  // Legacy fields (v2 API)
  business_id?: number;
  status?: string;
  priority?: string;
  client_name?: string;
  assigned_to?: number | null;
  assigned_name?: string | null;
  business_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  tags?: string | null;
  notes?: string | null;
  logo?: string | null;
}

const unwrap = async <T>(promise: Promise<{ data: T }>) => {
  const response = await promise;
  return response.data;
};

export const projectsApi = {
  list: () => unwrap<ProjectModel[]>(apiClient.request<{ data: ProjectModel[] }>('/projects')),
  create: async (payload: { name: string; description?: string | null; logo?: string | null; space_id?: number }) => {
    const response = await apiClient.request<{ data: ProjectModel }>('/projects', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const unwrapped = await unwrap<ProjectModel>(Promise.resolve(response));
    return unwrapped;
  },
  update: (id: number, payload: { name?: string; description?: string | null; icon?: string | null; access_control?: object | null; theme_primary?: string; theme_secondary?: string; theme_tertiary?: string; is_public?: boolean }) =>
    unwrap<ProjectModel>(
      apiClient.request<{ data: ProjectModel }>(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      })
    ),
  delete: (id: number) =>
    apiClient.request<{ success: boolean }>(`/projects/${id}`, {
      method: 'DELETE'
    })
};
