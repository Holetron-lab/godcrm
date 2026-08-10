/**
 * User Access Types for GOD CRM v0.003.001
 * Hierarchical access control system
 */

// Access levels in order of privilege (highest to lowest)
export type UserAccessLevel = 
  | 'owner_owner'  // Creator of space, cannot be demoted
  | 'owner'        // Can manage everyone except owner_owner
  | 'admin'        // Can edit + access column settings
  | 'editor'       // Can modify data
  | 'viewer'       // Read-only
  | 'denied';      // Cannot see entity

// Numeric values for comparison (higher = more privileges)
export const ACCESS_LEVEL_VALUES: Record<UserAccessLevel, number> = {
  owner_owner: 100,
  owner: 80,
  admin: 60,
  editor: 40,
  viewer: 20,
  denied: 0
};

// Entity type that permission applies to
export type PermissionEntityType = 'space' | 'project' | 'table' | 'column';

// Permission record as stored in database
export interface UserAccessPermission {
  id: number;
  user_id: number;
  space_id: number | null;
  project_id: number | null;
  table_id: number | null;
  column_id: number | null;
  access_level: UserAccessLevel;
  granted_by: number | null;
  created_at: string;
  updated_at: string;
}

// Permission with user info for display
export interface UserAccessPermissionWithUser extends UserAccessPermission {
  user_name: string;
  user_email: string;
  user_avatar?: string | null;
  granted_by_name?: string;
}

// Request to set user permission
export interface SetUserPermissionRequest {
  user_id: number;
  access_level: UserAccessLevel;
}

// Bulk permission update
export interface BulkPermissionUpdate {
  entity_type: PermissionEntityType;
  entity_id: number;
  permissions: SetUserPermissionRequest[];
}

// Access control configuration with user list
export interface UserAccessConfig {
  enabled: boolean;
  // List of users with their access levels
  users: {
    user_id: number;
    access_level: UserAccessLevel;
    inherited?: boolean;  // true if permission comes from parent
    inherited_from?: PermissionEntityType;
  }[];
}

// Labels for UI (without emojis)
export const ACCESS_LEVEL_LABELS: Record<UserAccessLevel, string> = {
  owner_owner: 'Владелец-создатель',
  owner: 'Владелец',
  admin: 'Администратор',
  editor: 'Редактор',
  viewer: 'Наблюдатель',
  denied: 'Заблокирован'
};

// English labels for UI
export const ACCESS_LEVEL_LABELS_EN: Record<UserAccessLevel, string> = {
  owner_owner: 'Owner Creator',
  owner: 'Owner',
  admin: 'Administrator',
  editor: 'Editor',
  viewer: 'Viewer',
  denied: 'Denied'
};

// Colors for UI
export const ACCESS_LEVEL_COLORS: Record<UserAccessLevel, string> = {
  owner_owner: '#FFD700', // Gold
  owner: '#F59E0B',       // Amber
  admin: '#8B5CF6',       // Purple
  editor: '#3B82F6',      // Blue
  viewer: '#6B7280',      // Gray
  denied: '#EF4444'       // Red
};

// Descriptions for UI tooltips
export const ACCESS_LEVEL_DESCRIPTIONS: Record<UserAccessLevel, string> = {
  owner_owner: 'Создатель пространства. Полный контроль, права не могут быть ограничены.',
  owner: 'Может управлять всеми пользователями кроме владельца-создателя.',
  admin: 'Может редактировать и открывать настройки колонок.',
  editor: 'Может изменять данные в таблицах.',
  viewer: 'Может только просматривать данные.',
  denied: 'Не видит эту сущность.'
};

// Helper to check if user can manage another user's access
export const canManageAccess = (
  managerLevel: UserAccessLevel,
  targetLevel: UserAccessLevel
): boolean => {
  // owner_owner cannot be managed by anyone
  if (targetLevel === 'owner_owner') return false;
  
  // owner_owner can manage everyone
  if (managerLevel === 'owner_owner') return true;
  
  // owner can manage everyone except owner_owner
  if (managerLevel === 'owner') return targetLevel !== ('owner_owner' as typeof targetLevel);
  
  // admin can manage editor, viewer, denied
  if (managerLevel === 'admin') {
    return ['editor', 'viewer', 'denied'].includes(targetLevel);
  }
  
  // editor and below cannot manage anyone
  return false;
};

// Helper to check if access level allows action
export const hasPermission = (
  userLevel: UserAccessLevel,
  requiredLevel: UserAccessLevel
): boolean => {
  return ACCESS_LEVEL_VALUES[userLevel] >= ACCESS_LEVEL_VALUES[requiredLevel];
};

// Permission check helpers
export const canView = (level: UserAccessLevel): boolean => 
  hasPermission(level, 'viewer');

export const canEdit = (level: UserAccessLevel): boolean => 
  hasPermission(level, 'editor');

export const canAdminister = (level: UserAccessLevel): boolean => 
  hasPermission(level, 'admin');

export const canOwn = (level: UserAccessLevel): boolean => 
  hasPermission(level, 'owner');

export const isOwnerOwner = (level: UserAccessLevel): boolean => 
  level === 'owner_owner';
