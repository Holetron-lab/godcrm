// Space Types for GOD CRM v0.003.000

export type SpaceType = 'business' | 'personal' | 'admin' | 'team';

// ADR-105: Space visibility levels
export type SpaceVisibility = 'internal' | 'open' | 'external';

// Owner-managed public-viewer sidebar preferences (per-space).
export interface PublicSidebarPrefs {
  default_open: boolean;
  hidden: boolean;
}

// Response from GET /api/v3/spaces/:id/visibility
export interface SpaceVisibilityData {
  visibility: SpaceVisibility;
  public_slug: string | null;
  has_password: boolean;
  public_sidebar: PublicSidebarPrefs;
}

// Payload for PUT /api/v3/spaces/:id/visibility
export interface SetSpaceVisibilityPayload {
  visibility: SpaceVisibility;
  custom_slug?: string;
}

// Payload for PUT /api/v3/spaces/:id/public-password
export interface SetPublicPasswordPayload {
  password: string;
}

// Invitation record
export interface SpaceInvitation {
  id: number;
  space_id: number;
  email: string;
  role: 'viewer' | 'editor' | 'admin';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invited_by: number;
  invited_by_name?: string;
  created_at: string;
  expires_at: string;
}

// Payload for POST /api/v3/spaces/:id/invitations
export interface CreateInvitationPayload {
  email: string;
  role: 'viewer' | 'editor' | 'admin';
}

// Response for GET /api/v3/spaces/invitations/:token (public invitation details)
export interface InvitationDetails {
  id: number;
  space_id: number;
  space_name: string;
  email: string;
  role: 'viewer' | 'editor' | 'admin';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invited_by_name: string;
  expires_at: string;
}

export interface AccessControlConfig {
  enabled: boolean;
  mode: 'roles' | 'users';
  usersTableId: number | null;
  userIdColumn: string;
  userNameColumn: string;
  roleColumn: string;
  roleMapping: {
    owner: string[];
    admin: string[];
    editor: string[];
    viewer: string[];
    denied: string[];
  };
}

export interface UsersByRoles {
  owners: number;
  admins: number;
  editors: number;
  viewers: number;
}

// Tickets configuration stored per space
export interface TicketsConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
}

export interface SpaceModel {
  id: number;
  owner_id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  type: SpaceType;
  theme_primary?: string | null;
  theme_secondary?: string | null;
  theme_tertiary?: string | null;
  settings?: Record<string, unknown> | null;
  access_control?: AccessControlConfig | null;
  tickets_config?: TicketsConfig | null;
  files_config?: { tableId: number; tableName: string; tableIcon?: string; projectId: number } | null;
  favorites_config?: Record<string, unknown> | null;
  // ADR-105: Visibility fields
  visibility?: SpaceVisibility;
  public_slug?: string | null;
  has_password?: boolean;
  created_at: string;
  updated_at: string;
  // Computed fields from JOIN
  projects_count?: number;
  dashboards_count?: number;
  users_count?: number;
  users_by_roles?: UsersByRoles;
  users?: SpaceUser[];
  user_access_level?: string | null;
}

export interface CreateSpacePayload {
  name: string;
  description?: string;
  icon?: string;
  type: SpaceType;
  theme_primary?: string;
  theme_secondary?: string;
  theme_tertiary?: string;
  settings?: Record<string, unknown>;
  access_control?: AccessControlConfig;
}

export interface UpdateSpacePayload {
  name?: string;
  description?: string | null;
  icon?: string;
  theme_primary?: string;
  theme_secondary?: string;
  theme_tertiary?: string;
  settings?: Record<string, unknown>;
  access_control?: AccessControlConfig;
  tickets_config?: TicketsConfig | null;
  files_config?: { tableId: number; tableName: string; tableIcon?: string; projectId: number } | null;
}

export interface SpaceProject {
  id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
}

export interface SpaceDashboard {
  id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  is_default: boolean;
}

export interface SpaceUser {
  id: number;
  name: string;
  email?: string;
  avatar_url?: string;
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  system_user_id?: number | null;
}

export interface SpaceWithProjects extends SpaceModel {
  projects: SpaceProject[];
  dashboard?: SpaceDashboard | null;
}

// API Response types for typed requests
export interface SpaceApiResponse {
  id: number;
  owner_id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  type: string;
  theme_primary?: string | null;
  theme_secondary?: string | null;
  theme_tertiary?: string | null;
  settings?: string | Record<string, unknown> | null;
  access_control?: string | AccessControlConfig | null;
  tickets_config?: string | TicketsConfig | null;
  files_config?: string | { tableId: number; tableName: string; tableIcon?: string; projectId: number } | null;
  favorites_config?: string | Record<string, unknown> | null;
  projects_count?: number;
  dashboards_count?: number;
  users_count?: number;
  users_by_roles?: UsersByRoles;
  created_at: string;
  updated_at: string;
  user_access_level?: string | null;
  projects?: SpaceProject[];
  users?: SpaceUser[];
}

export interface SpaceWithProjectsApiResponse {
  space: SpaceApiResponse;
  projects: SpaceProject[];
  dashboard: SpaceDashboard | null;
}

export interface CreateSpaceApiResponse {
  space: SpaceApiResponse;
  default_dashboard: SpaceDashboard | null;
}
