import { apiClient } from '@/shared/utils/apiClient';

export interface WorkspaceUser {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

const unwrap = async <T>(promise: Promise<{ data: T }>) => {
  const response = await promise;
  return response.data;
};

export const usersApi = {
  list: () => unwrap<WorkspaceUser[]>(apiClient.request<{ data: WorkspaceUser[] }>('/users'))
};
