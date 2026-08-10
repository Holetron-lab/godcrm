// Spaces API - Uses /api/v3/spaces and /api/v3/projects endpoints
import { apiClient } from '@/shared/utils/apiClient';
import type {
  SpaceModel,
  CreateSpacePayload,
  UpdateSpacePayload,
  SpaceWithProjects,
  SpaceApiResponse,
  SpaceWithProjectsApiResponse,
  CreateSpaceApiResponse,
  SpaceProject,
  TicketsConfig,
  SpaceVisibilityData,
  SetSpaceVisibilityPayload,
  SetPublicPasswordPayload,
  SpaceInvitation,
  CreateInvitationPayload,
  InvitationDetails
} from '../types/space.types';

// Helper to parse JSON fields that might be strings
const parseJsonField = <T>(value: string | T | null | undefined): T | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value;
};

// Helper to transform API response to SpaceModel
const toSpaceModel = (space: SpaceApiResponse): SpaceModel => ({
  id: space.id,
  owner_id: space.owner_id,
  name: space.name,
  description: space.description || '',
  icon: space.icon || '📁',
  type: space.type as 'personal' | 'business' | 'admin',
  theme_primary: space.theme_primary || '#0ea5e9',
  theme_secondary: space.theme_secondary || '#8b5cf6',
  theme_tertiary: space.theme_tertiary || '#10b981',
  settings: parseJsonField(space.settings),
  access_control: parseJsonField(space.access_control),
  tickets_config: parseJsonField(space.tickets_config) as TicketsConfig | null,
  files_config: parseJsonField(space.files_config) as { tableId: number; tableName: string; tableIcon?: string; projectId: number } | null,
  favorites_config: parseJsonField(space.favorites_config) as Record<string, unknown> | null,
  projects_count: space.projects_count || 0,
  dashboards_count: space.dashboards_count || 0,
  users_count: space.users_count || 1,
  users_by_roles: space.users_by_roles || { owners: 1, admins: 0, editors: 0, viewers: 0 },
  created_at: space.created_at,
  updated_at: space.updated_at
});

/**
 * Spaces API для GOD CRM
 * 
 * ВАЖНО: Пока backend использует /projects как spaces
 * После миграции на v0.003.000 будет переведено на /spaces
 */
export const spacesApi = {
  /**
   * Получить все spaces via clean v3 API
   */
  list: async (): Promise<SpaceModel[]> => {
    const response = await apiClient.request<{ data: SpaceApiResponse[] }>('/spaces');
    const spaces = response.data;
    
    return spaces.map((space) => ({
      ...toSpaceModel(space),
      // Пробрасываем вычисленный уровень доступа с бэка, если есть
      user_access_level: space.user_access_level || null,
      // Списки для отображения в карточках и для member-фильтра
      projects: space.projects || [],
      users: space.users || [],
    }));
  },

  /**
   * Получить space по ID с вложенными проектами и дашбордом
   * Использует GET /api/v3/spaces/:id
   */
  getById: async (spaceId: number): Promise<SpaceWithProjects> => {
    const response = await apiClient.request<{ data: SpaceWithProjectsApiResponse }>(
      `/spaces/${spaceId}`
    );
    
    const { space, projects, dashboard } = response.data;
    
    return {
      ...toSpaceModel(space),
      user_access_level: space.user_access_level || null,
      projects: projects?.map((p: SpaceProject) => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        icon: p.icon || '📊'
      })) || [],
      dashboard: dashboard ? {
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description || null,
        icon: dashboard.icon || '📊',
        is_default: dashboard.is_default === true
      } : null
    };
  },

  /**
   * Создать новый space
   */
  create: async (payload: CreateSpacePayload): Promise<SpaceModel> => {
    const response = await apiClient.request<{ data: CreateSpaceApiResponse }>('/spaces', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        description: payload.description || null,
        icon: payload.icon || '📁',
        type: payload.type,
        theme_primary: payload.theme_primary || '#0ea5e9',
        theme_secondary: payload.theme_secondary || '#8b5cf6',
        theme_tertiary: payload.theme_tertiary || '#10b981',
        settings: payload.settings || null
      })
    });

    return toSpaceModel(response.data.space);
  },

  /**
   * Обновить space
   */
  update: async (spaceId: number, payload: UpdateSpacePayload): Promise<SpaceModel> => {
    const response = await apiClient.request<{ data: SpaceApiResponse }>(`/spaces/${spaceId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    return toSpaceModel(response.data);
  },

  /**
   * Удалить space
   */
  delete: async (spaceId: number): Promise<void> => {
    await apiClient.request<{ success: boolean }>(`/spaces/${spaceId}`, {
      method: 'DELETE'
    });
  },

  /**
   * Get or create "Источники данных" project for a space
   */
  getOrCreateDataSourcesProject: async (spaceId: number): Promise<{ project_id: number; status: 'existing' | 'created' }> => {
    const response = await apiClient.request<{ data: { project_id: number; status: 'existing' | 'created' } }>(
      `/spaces/${spaceId}/data-sources-project`,
      { method: 'POST' }
    );
    return response.data;
  },

  /**
   * Get or create Users table in "Источники данных" project
   */
  getOrCreateUsersTable: async (spaceId: number): Promise<{ table_id: number; project_id: number; status: 'existing' | 'created' }> => {
    const response = await apiClient.request<{ data: { table_id: number; project_id: number; status: 'existing' | 'created' } }>(
      `/spaces/${spaceId}/users-table`,
      { method: 'POST' }
    );
    return response.data;
  },

  /**
   * Get or create Roles table in "Источники данных" project
   */
  getOrCreateRolesTable: async (spaceId: number): Promise<{ table_id: number; project_id: number; status: 'existing' | 'created' }> => {
    const response = await apiClient.request<{ data: { table_id: number; project_id: number; status: 'existing' | 'created' } }>(
      `/spaces/${spaceId}/roles-table`,
      { method: 'POST' }
    );
    return response.data;
  },

  // ─── ADR-105: Visibility & Public Access ───────────────────────────

  /**
   * Get space visibility settings
   */
  getVisibility: async (spaceId: number): Promise<SpaceVisibilityData> => {
    const response = await apiClient.get<{ data: SpaceVisibilityData }>(
      `/spaces/${spaceId}/visibility`
    );
    return response.data;
  },

  /**
   * Set space visibility level
   */
  setVisibility: async (spaceId: number, payload: SetSpaceVisibilityPayload): Promise<SpaceVisibilityData> => {
    const response = await apiClient.put<{ data: SpaceVisibilityData }>(
      `/spaces/${spaceId}/visibility`,
      payload
    );
    return response.data;
  },

  /**
   * Set password for external (public) access
   */
  setPublicPassword: async (spaceId: number, payload: SetPublicPasswordPayload): Promise<{ success: boolean }> => {
    const response = await apiClient.put<{ success: boolean }>(
      `/spaces/${spaceId}/public-password`,
      payload
    );
    return response;
  },

  /**
   * Remove password for external (public) access
   */
  removePublicPassword: async (spaceId: number): Promise<{ success: boolean }> => {
    const response = await apiClient.delete<{ success: boolean }>(
      `/spaces/${spaceId}/public-password`
    );
    return response;
  },

  /**
   * Update owner-managed public sidebar preferences.
   * Persists into spaces.settings.public_sidebar JSON.
   */
  setPublicSidebarPrefs: async (
    spaceId: number,
    prefs: Partial<{ default_open: boolean; hidden: boolean }>
  ): Promise<{ public_sidebar: { default_open: boolean; hidden: boolean } }> => {
    const response = await apiClient.patch<{ data: { public_sidebar: { default_open: boolean; hidden: boolean } } }>(
      `/spaces/${spaceId}/public-sidebar`,
      prefs
    );
    return response.data;
  },

  // ─── ADR-105: Invitations ──────────────────────────────────────────

  /**
   * Get all invitations for a space
   */
  getInvitations: async (spaceId: number): Promise<SpaceInvitation[]> => {
    const response = await apiClient.get<{ data: SpaceInvitation[] }>(
      `/spaces/${spaceId}/invitations`
    );
    return response.data;
  },

  /**
   * Create a new invitation
   */
  createInvitation: async (spaceId: number, payload: CreateInvitationPayload): Promise<SpaceInvitation> => {
    const response = await apiClient.post<{ data: SpaceInvitation }>(
      `/spaces/${spaceId}/invitations`,
      payload
    );
    return response.data;
  },

  /**
   * Revoke (delete) an invitation
   */
  revokeInvitation: async (spaceId: number, invitationId: number): Promise<{ success: boolean }> => {
    const response = await apiClient.delete<{ success: boolean }>(
      `/spaces/${spaceId}/invitations/${invitationId}`
    );
    return response;
  },

  /**
   * Resend an invitation email
   */
  resendInvitation: async (spaceId: number, invitationId: number): Promise<{ success: boolean }> => {
    const response = await apiClient.post<{ success: boolean }>(
      `/spaces/${spaceId}/invitations/${invitationId}/resend`
    );
    return response;
  },

  // ─── ADR-105: Token-based Invitation (public) ─────────────────────

  /**
   * Get invitation details by token (semi-public, no auth required for viewing)
   */
  getInvitationByToken: async (token: string): Promise<InvitationDetails> => {
    const response = await apiClient.get<{ data: InvitationDetails }>(
      `/spaces/invitations/${token}`,
      { skipAuth: false }
    );
    return response.data;
  },

  /**
   * Accept an invitation by token (requires auth)
   */
  acceptInvitation: async (token: string): Promise<{ success: boolean; space_id: number }> => {
    const response = await apiClient.post<{ data: { success: boolean; space_id: number } }>(
      `/spaces/invitations/${token}/accept`
    );
    return response.data;
  }
};
